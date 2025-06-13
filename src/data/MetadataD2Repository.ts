import _ from "lodash";
import { D2Api } from "../types/d2-api";
import { Async } from "domain/entities/Async";
import { Id } from "domain/entities/Base";
import { MetadataRepository } from "domain/repositories/MetadataRepository";
import { getPluralModel } from "./dhis2-utils";
import {
    MetadataModel,
    MetadataObject,
    MetadataObjectWithType,
    UserMetadataObject,
} from "domain/entities/MetadataObject";
import { Maybe } from "utils/ts-utils";
import { Pager } from "domain/entities/Pager";
import { Paginated } from "domain/entities/Pagination";

export class MetadataD2Repository implements MetadataRepository {
    constructor(private api: D2Api) {}

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
