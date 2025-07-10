import _ from "lodash";
import { D2Api, PostOptions } from "../types/d2-api";
import { Async } from "domain/entities/Async";
import { Id, Ref } from "domain/entities/Base";
import { MetadataRepository, SaveMetadataOptions } from "domain/repositories/MetadataRepository";
import { getErrorMessagesFromReports, getInChunks, getPluralModel, promiseMap } from "./dhis2-utils";
import {
    getMetadataModelFromString,
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
import { D2TrackerEvent } from "@eyeseetea/d2-api/api/trackerEvents";

export class MetadataD2Repository implements MetadataRepository {
    private api: D2Api;
    private excludeModels: MetadataModel[] = ["documents"];

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

        const metadataModels = metadataObjects.filter(object => !this.excludeModels.includes(object.model));

        const metadataToSave = _(metadataModels)
            .groupBy(obj => obj.model)
            .mapValues(objects => objects.map(obj => obj.additionalFields))
            .value();

        try {
            const response = await this.api.metadata
                .postAsync(metadataToSave, {
                    importMode: this.getImportMode(persist),
                    importStrategy: this.getStrategyFromAction(action),
                })
                .getData();

            const results = await this.api.system.waitFor("METADATA_IMPORT", response.response.id).getData();

            return this.buildStatsFromResponse(results?.typeReports ?? []);
        } catch (error) {
            return this.buildStatsFromError(error);
        }
    }

    async delete(metadataObjects: MetadataObjectWithType[], options: SaveMetadataOptions): Async<Stats[]> {
        const { persist } = options;
        const metadataObjectsByModel = _(metadataObjects)
            .groupBy(obj => obj.model)
            .mapValues(objects => objects.map(obj => ({ id: obj.id })))
            .value();

        if (options.action === "DELETE_WITH_DATA") {
            const dataElementsWithDomain = await this.getDataElementByIds(metadataObjects);
            await this.deleteDataValuesFromDataElements(
                dataElementsWithDomain.filter(dataElement => dataElement.domainType === "AGGREGATE"),
                !options.persist
            );
            await this.deleteTrackerEventsFromDataElements(
                dataElementsWithDomain.filter(dataElement => dataElement.domainType === "TRACKER"),
                persist
            );
        }

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

    private async deleteDataValuesFromDataElements(
        dataElements: D2ApiDataElement[],
        dryRun: boolean
    ): Promise<void> {
        const d2OrgUnitResponse = await this.getRootOrgUnit();

        await promiseMap(dataElements, async dataElement => {
            console.debug(`Fetching data values for dataElement ${dataElement.id}`);
            const { dataValues } = await this.api.dataValues
                .getSet({
                    dataElement: [dataElement.id],
                    orgUnit: [d2OrgUnitResponse.id],
                    startDate: "1950",
                    endDate: "2100",
                    children: true,
                    dataSet: [],
                })
                .getData();

            if (dataValues.length === 0) {
                console.warn(`No data values found for data element ${dataElement.id}`);
                return [];
            }

            console.debug(`Deleting ${dataValues.length} dataValues for dataElement ${dataElement.id}`);

            const jobResponse = await this.api.dataValues
                .postSetAsync({ importStrategy: "DELETE", dryRun: dryRun }, { dataValues: dataValues })
                .getData();

            const dvResponse = await this.api.system
                .waitFor(jobResponse.response.jobType, jobResponse.response.id)
                .getData();

            console.debug(
                `Data values response for ${dataElement.id}:`,
                JSON.stringify(dvResponse?.importCount, null, 2)
            );
        });

        console.debug("Finished deleting data values for data elements.");
    }

    private getDataElementByIds(models: MetadataObjectWithType[]): Promise<D2ApiDataElement[]> {
        const dataElements = models.filter(model => model.model === "dataElements");
        if (dataElements.length === 0) return Promise.resolve([]);

        return getInChunks(dataElements, dataElements => {
            return this.api.models.dataElements
                .get({
                    fields: { id: true, domainType: true },
                    filter: { id: { in: dataElements.map(de => de.id) } },
                    paging: false,
                    pageSize: 300,
                })
                .getData()
                .then(response => response.objects);
        });
    }

    private async deleteTrackerEventsFromDataElements(
        dataElements: D2ApiDataElement[],
        persist: boolean
    ): Promise<void> {
        if (dataElements.length === 0) return;

        await promiseMap(dataElements, async dataElement => {
            const trackerEvents = await this.getAllEvents({
                dataElementId: dataElement.id,
                initialPage: 1,
                events: [],
            });

            const eventsToUpdate = trackerEvents.filter(event => {
                return event.dataValues.some(dv => dv.dataElement === dataElement.id);
            });

            if (eventsToUpdate.length === 0) {
                console.warn(`No tracker events found for data element ${dataElement.id}`);
                return [];
            }

            console.debug(
                `Updating ${eventsToUpdate.length} tracker events for dataElement ${dataElement.id}`
            );

            const jobResponse = await this.api.tracker
                .postAsync(
                    { importMode: this.getImportMode(persist), importStrategy: "UPDATE" },
                    { events: eventsToUpdate }
                )
                .getData();

            const trackerResponse = await this.api.system
                .waitFor(jobResponse.response.jobType, jobResponse.response.id)
                .getData();

            console.debug(
                `Tracker response for ${dataElement.id}:`,
                JSON.stringify(trackerResponse?.stats, null, 2)
            );
        });

        console.debug("Finished updating tracker events for data elements.");
    }

    private async getAllEvents(options: {
        dataElementId: Id;
        initialPage: number;
        events: D2TrackerEvent[];
    }): Promise<D2TrackerEvent[]> {
        const { dataElementId, initialPage, events } = options;
        console.debug(`Fetching tracker events for dataElement ${dataElementId} on page ${initialPage}`);
        const { instances, page, pageCount } = await this.getEventsByDataElement({
            dataElementId,
            page: initialPage,
        });

        const acumInstances = [...events, ...instances];

        if (page >= (pageCount ?? 0)) {
            return acumInstances;
        } else {
            return this.getAllEvents({ dataElementId, initialPage: initialPage + 1, events: acumInstances });
        }
    }

    private async getEventsByDataElement(options: { dataElementId: Id; page: number }) {
        const { dataElementId, page } = options;
        return this.api.tracker.events
            .get({
                // from 2.41 documentation https://docs.dhis2.org/en/develop/using-the-api/dhis-core-version-241/tracker.html#events-get-apitrackerevents
                // "A filter like filter=fazCI2ygYkq returns all events where the given data element has a value."
                // this is not supported in previous versions so using a weird value to avoid going through all events
                filter: `${dataElementId}:ne:_____UNEXISTING_VALUE____`,
                // using $all here because $owner returns an empty object
                fields: { $all: true },
                page: page,
                pageSize: 100_000,
                totalPages: true,
            })
            .getData();
    }

    private async getRootOrgUnit(): Promise<Ref> {
        const d2OrgUnitResponse = await this.api.models.organisationUnits
            .get({ fields: { id: true }, filter: { level: { eq: "1" } }, paging: false })
            .getData();

        const globalOrgUnitId = d2OrgUnitResponse.objects[0]?.id;

        if (!globalOrgUnitId) {
            throw new Error("No global organisation unit found");
        }

        return { id: globalOrgUnitId };
    }

    private getStrategyFromAction(action: SaveMetadataOptions["action"]): PostOptions["importStrategy"] {
        switch (action) {
            case "CREATE":
                return "CREATE";
            case "CREATE_AND_UPDATE":
                return "CREATE_AND_UPDATE";
            case "DELETE":
                return "DELETE";
            case "DELETE_WITH_DATA":
                return "DELETE";
            default:
                throw new Error(`Unknown action: ${action}`);
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
                    const modelName = _(report.klass).split(".").last() ?? "";
                    const model = getMetadataModelFromString(modelName);
                    return new Stats({
                        ...report.stats,
                        errorMessages: getErrorMessagesFromReports([report]),
                        model: model,
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

type D2ApiDataElement = { id: Id; domainType: "TRACKER" | "AGGREGATE" };
