import _ from "lodash";
import { D2Api, PostOptions } from "../types/d2-api";
import { Async } from "domain/entities/Async";
import { Id } from "domain/entities/Base";
import { MetadataRepository, SaveMetadataOptions } from "domain/repositories/MetadataRepository";
import { getErrorMessagesFromReports, getPluralModel } from "./dhis2-utils";
import {
    MetadataModel,
    MetadataObject,
    MetadataObjectWithType,
    UserMetadataObject,
} from "domain/entities/MetadataObject";
import { Maybe } from "utils/ts-utils";
import { Pager } from "domain/entities/Pager";
import { Paginated } from "domain/entities/Pagination";
import { Stats } from "domain/entities/Stats";
import { ErrorResponseCodec, TypeReport } from "./ErrorMetadata";
import { Instance } from "domain/entities/Instance";
import { buildAuthFromString, buildD2Api } from "scripts/common";

export class MetadataD2Repository implements MetadataRepository {
    private api: D2Api;

    constructor(private instance: Instance) {
        this.api = buildD2Api({
            useProxy: this.instance.useProxy,
            backend: "xhr",
            baseUrl: this.instance.url,
            auth: this.instance.auth
                ? buildAuthFromString(this.instance.auth)
                : { type: "personalToken", token: this.instance.personalToken },
        });
    }

    async getPaginated(options: {
        model: MetadataModel;
        page: number;
    }): Async<Paginated<MetadataObjectWithType>> {
        // endpoint users pager has a for older DHIS2 (page > 1 return only one object),
        // don't page in this case.
        if (options.model === "users") {
            const pageSize = 100_000;

            const res$ = this.api.get<{ pager: Pager } & { [K in string]: D2User[] }>(`/${options.model}`, {
                fields: "id,name,userCredentials[username],openId,*",
                pageSize: pageSize,
                page: options.page,
            });
            const res = await res$.getData();

            const objects = _(res[options.model])
                .map(
                    (user): UserMetadataObject => ({
                        ...user,
                        model: options.model,
                        code: user.userCredentials.username,
                        additionalFields: { ...user },
                        openId: user.openId,
                        type: "user",
                    })
                )
                .value();

            return { objects: objects, pager: res.pager };
        } else {
            const pageSize = 1_000;

            const res$ = this.api.get<{ pager: Pager } & { [K in string]: BasicD2Object[] }>(
                `/${getPluralModel(options.model)}`,
                {
                    fields: "id,name,code,*",
                    pageSize: pageSize,
                    page: options.page,
                }
            );
            const res = await res$.getData();

            const objects = _(res[options.model])
                .map(
                    (obj): MetadataObject => ({
                        ...obj,
                        model: options.model,
                        additionalFields: { ...obj },
                        type: "common",
                    })
                )
                .value();

            return { objects: objects, pager: res.pager };
        }
    }

    async save(metadataObjects: MetadataObjectWithType[], options: SaveMetadataOptions): Async<Stats[]> {
        const { action, persist } = options;
        if (metadataObjects.length === 0) return Promise.resolve([]);

        const excludeModels = ["documents"];

        const metadataModels = metadataObjects.filter(object => !excludeModels.includes(object.model));

        const metadataToSave = _(metadataModels)
            .groupBy(obj => obj.model)
            .mapValues(objects => objects.map(obj => ({ ...obj.additionalFields })))
            .value();

        try {
            const response = await this.api.metadata
                .postAsync(metadataToSave, {
                    importMode: this.getImportMode(persist),
                    importStrategy: action,
                })
                .getData();

            const results = await this.api.system.waitFor("METADATA_IMPORT", response.response.id).getData();

            return this.buildStatsFromResponse(results?.typeReports ?? []);
        } catch (error) {
            return this.buildStatsFromError(error);
        }
    }

    async remove(metadataObjects: MetadataObjectWithType[], options: SaveMetadataOptions): Async<Stats[]> {
        const { persist } = options;
        const metadataObjectsByModel = _(metadataObjects)
            .groupBy(obj => obj.model)
            .mapValues(objects => objects.map(obj => ({ id: obj.id })))
            .value();

        try {
            const response = await this.api.metadata
                .postAsync(metadataObjectsByModel, {
                    importMode: this.getImportMode(persist),
                    importStrategy: "DELETE",
                })
                .getData();

            const results = await this.api.system.waitFor("METADATA_IMPORT", response.response.id).getData();

            return this.buildStatsFromResponse(results?.typeReports ?? []);
        } catch (error) {
            return this.buildStatsFromError(error);
        }
    }

    private buildStatsFromError(error: unknown): Stats[] {
        const decodeResult = ErrorResponseCodec.decode(error);
        return decodeResult.caseOf({
            Left: () => {
                console.error("Error decoding response", error);
                return [];
            },
            Right: codecResponse => {
                const metadataResponse = codecResponse.response.data.response;
                return this.buildStatsFromResponse(metadataResponse.typeReports);
            },
        });
    }

    private buildStatsFromResponse(reports: TypeReport[]): Stats[] {
        return _(reports)
            .groupBy(report => report.klass)
            .flatMap(reports => {
                return reports.map(report => {
                    return new Stats({
                        ...report.stats,
                        errorMessages: getErrorMessagesFromReports([report]),
                        model: _(report.klass).split(".").last(),
                    });
                });
            })
            .value();
    }

    private getImportMode(persist: boolean): PostOptions["importMode"] {
        return persist ? "COMMIT" : "VALIDATE";
    }
}

interface BasicD2Object {
    id: Id;
    name: string;
    code: Maybe<string>;
}

interface D2User {
    id: Id;
    name: string;
    openId: string;
    userCredentials: { username: string };
}
