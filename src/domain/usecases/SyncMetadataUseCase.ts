import _ from "lodash";

import { Maybe } from "utils/ts-utils";
import { Async } from "domain/entities/Async";
import { isUserModel, MetadataModel, MetadataObject } from "domain/entities/MetadataObject";
import { MetadataRepository } from "domain/repositories/MetadataRepository";
import {
    ExclusiveMetadataItem,
    MetadataValidationResult,
    DiscrepancyMetadata,
    DiscrepancyValidationResult,
    METADATA_PROPERTIES_TO_IGNORE,
} from "domain/entities/MetadataValidationResult";
import logger from "utils/log";

export class SyncMetadataUseCase {
    constructor(
        private metadataRepositoryMain: MetadataRepository,
        private metadataReplicaRepositories: MetadataRepository[]
    ) {}

    async execute(options: UseCaseOptions): Async<SyncMetadataReport> {
        const { modelsToCheck } = options;
        return this.validateMetadataByModel(modelsToCheck);
    }

    private async validateMetadataByModel(modelsToCheck: MetadataModel[]): Async<SyncMetadataReport> {
        const metadataReport: SyncMetadataReport = {
            exclusiveMetadata: [],
            metadataWithCodeDiscrepancies: [],
            metadataWithPropertiesDiscrepancies: [],
        };
        for (const model of modelsToCheck) {
            logger.info(`[Main Server]: Fetching metadata for model: ${model}`);
            const mainObjects = await this.getObjects({ model, server: this.metadataRepositoryMain });

            logger.info(`[Replica Servers]: Fetching metadata for model: ${model}`);
            const replicaObjects = await Promise.all(
                this.metadataReplicaRepositories.map(replicaServer =>
                    this.getObjects({ model, server: replicaServer })
                )
            );
            // const replicaObjects: MetadataObject[][] = [];
            // for (const replicaServer of this.metadataReplicaRepositories) {
            //     const result = await this.getObjects({ model, server: replicaServer });
            //     replicaObjects.push(result);
            // }

            const exclusiveMetadata = this.findExclusiveMetadataWithSource(mainObjects, replicaObjects);

            const metadataWithCodeDiscrepancies = this.findCodeDiscrepanciesForModel(
                model,
                mainObjects,
                replicaObjects
            );

            const metadataWithPropertiesDiscrepancies = this.findFieldDiscrepanciesForModel(
                model,
                mainObjects,
                replicaObjects
            );

            metadataReport.exclusiveMetadata.push({
                model,
                exclusive: exclusiveMetadata,
            });
            metadataReport.metadataWithCodeDiscrepancies.push({
                model,
                items: metadataWithCodeDiscrepancies,
            });
            metadataReport.metadataWithPropertiesDiscrepancies.push({
                model,
                items: metadataWithPropertiesDiscrepancies,
            });
        }

        return metadataReport;
    }

    /*
      Metadata objects that exist only in one of the instances (based on IDs).
    */
    private findExclusiveMetadataWithSource(
        main: MetadataObject[],
        replicas: MetadataObject[][]
    ): ExclusiveMetadataItem[] {
        const metadataWithSource = [
            ...main.map(
                (metadataObject): ExclusiveMetadataItem => ({
                    object: metadataObject,
                    source: { type: "main" },
                })
            ),
            ...replicas.flatMap((list, replicaIndex) =>
                list.map(
                    (metadataObject): ExclusiveMetadataItem => ({
                        object: metadataObject,
                        source: { type: "replica", index: replicaIndex },
                    })
                )
            ),
        ];

        const metadataGroupedById = _.groupBy(metadataWithSource, item =>
            isUserModel(item.object) ? item.object.openId : item.object.id
        );
        const exclusiveMetadata = _.pickBy(metadataGroupedById, group => group.length === 1);

        return _(exclusiveMetadata)
            .map(group => group[0])
            .compact()
            .value();
    }

    private findCodeDiscrepanciesAgainstMain(
        model: MetadataModel,
        mainList: MetadataObject[],
        replicaList: MetadataObject[],
        replicaIdx: number
    ): DiscrepancyMetadata[] {
        const mainById = _(mainList)
            .filter(mainObj => mainObj.model === model)
            .keyBy(metadataObject =>
                isUserModel(metadataObject) ? metadataObject.openId : metadataObject.id
            )
            .value();

        return replicaList
            .filter(replicaObj => replicaObj.model === model)
            .filter(replicaObj => {
                const replicaId = isUserModel(replicaObj) ? replicaObj.openId : replicaObj.id;
                const mainObj = mainById[replicaId];
                if (!mainObj) return false;

                const codeMain = mainObj.code ?? "";
                const codeReplica = replicaObj.code ?? "";
                return codeMain !== codeReplica;
            })
            .map(replicaObj => {
                const replicaId = isUserModel(replicaObj) ? replicaObj.openId : replicaObj.id;
                const mainObj = mainById[replicaId]!;
                return {
                    model,
                    id: replicaId,
                    mainObject: mainObj,
                    replicaObject: replicaObj,
                    replicaIndex: replicaIdx,
                    differingFields: ["code"],
                };
            });
    }

    /* 
        Detect objects with the same ID but different codes to flag discrepancies.
     */
    private findCodeDiscrepanciesForModel(
        model: MetadataModel,
        mainList: MetadataObject[],
        replicaLists: MetadataObject[][]
    ): DiscrepancyMetadata[] {
        return replicaLists.flatMap((replicaList, idx) =>
            this.findCodeDiscrepanciesAgainstMain(model, mainList, replicaList, idx)
        );
    }

    private compareFields(mainObj: MetadataObject, replicaObj: MetadataObject): string[] {
        const diffs: string[] = [];

        const mainAdd = mainObj.additionalFields ?? {};
        const replicaAdd = replicaObj.additionalFields ?? {};

        const allKeys = new Set([...Object.keys(mainAdd), ...Object.keys(replicaAdd)]);

        for (const key of allKeys) {
            if (METADATA_PROPERTIES_TO_IGNORE.includes(key)) {
                continue;
            }
            const mainVal = mainAdd[key];
            const replicaVal = replicaAdd[key];
            if (!_.isEqual(mainVal, replicaVal)) {
                diffs.push(key);
            }
        }
        return diffs;
    }

    /* 
        Detect objects with the same ID but different in certain fields
     */
    private findFieldDiscrepanciesAgainstMain(
        model: MetadataModel,
        mainList: MetadataObject[],
        replicaList: MetadataObject[],
        replicaIdx: number
    ): DiscrepancyMetadata[] {
        const mainById = _.keyBy(mainList, object => (isUserModel(object) ? object.openId : object.id));

        return _(replicaList)
            .map((replicaObj): Maybe<DiscrepancyMetadata> => {
                const replicaId = isUserModel(replicaObj) ? replicaObj.openId : replicaObj.id;
                const mainObj = mainById[replicaId];
                if (!mainObj) return undefined;

                const differingFields = this.compareFields(mainObj, replicaObj);
                if (differingFields.length === 0) return undefined;

                return {
                    model,
                    id: replicaId,
                    mainObject: mainObj,
                    replicaObject: replicaObj,
                    replicaIndex: replicaIdx,
                    differingFields,
                };
            })
            .compact()
            .value();
    }

    private findFieldDiscrepanciesForModel(
        model: MetadataModel,
        mainList: MetadataObject[],
        replicaLists: MetadataObject[][]
    ): DiscrepancyMetadata[] {
        return replicaLists.flatMap((replicaList, idx) =>
            this.findFieldDiscrepanciesAgainstMain(model, mainList, replicaList, idx)
        );
    }

    private async getObjects(options: {
        model: MetadataModel;
        server: MetadataRepository;
    }): Async<MetadataObject[]> {
        const { model, server } = options;
        const allObjects: MetadataObject[] = [];

        let page = 1;
        while (true) {
            const { objects, pager } = await server.getPaginated({
                model: model,
                page: page,
            });
            allObjects.push(...objects.filter(obj => (isUserModel(obj) ? obj.openId : obj.id)));

            if (pager.page >= pager.pageCount) break;
            page++;
        }

        return allObjects;
    }
}

type UseCaseOptions = { modelsToCheck: string[] };

export type SyncMetadataReport = {
    exclusiveMetadata: MetadataValidationResult[];
    metadataWithCodeDiscrepancies: DiscrepancyValidationResult[];
    metadataWithPropertiesDiscrepancies: DiscrepancyValidationResult[];
};
