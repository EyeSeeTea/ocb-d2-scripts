import _ from "lodash";

import { Maybe } from "utils/ts-utils";
import { Async } from "domain/entities/Async";
import { MetadataModel, MetadataObjectWithType } from "domain/entities/MetadataObject";
import { MetadataRepository } from "domain/repositories/MetadataRepository";
import {
    ExclusiveMetadataItem,
    MetadataValidationResult,
    DiscrepancyMetadata,
    DiscrepancyValidationResult,
    METADATA_PROPERTIES_TO_IGNORE,
} from "domain/entities/MetadataValidationResult";
import logger from "utils/log";
import { promiseMap } from "data/dhis2-utils";

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
        const resultByModel = await promiseMap(modelsToCheck, async model => {
            logger.info(`[Main Server]: Fetching metadata for model: ${model}`);
            const mainObjects = await this.getObjects({ model, server: this.metadataRepositoryMain });

            logger.info(`[Replica Servers]: Fetching metadata for model: ${model}`);
            const replicaObjects = await Promise.all(
                this.metadataReplicaRepositories.map(replicaServer =>
                    this.getObjects({ model, server: replicaServer })
                )
            );

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
            return {
                model,
                exclusiveMetadata,
                metadataWithCodeDiscrepancies,
                metadataWithPropertiesDiscrepancies,
            };
        });

        return {
            exclusiveMetadata: resultByModel.map(result => ({
                model: result.model,
                exclusive: result.exclusiveMetadata,
            })),
            metadataWithCodeDiscrepancies: resultByModel.map(result => ({
                model: result.model,
                items: result.metadataWithCodeDiscrepancies,
            })),
            metadataWithPropertiesDiscrepancies: resultByModel.map(result => ({
                model: result.model,
                items: result.metadataWithPropertiesDiscrepancies,
            })),
        };
    }

    /*
      Metadata objects that exist only in one of the instances (based on IDs).
    */
    private findExclusiveMetadataWithSource(
        main: MetadataObjectWithType[],
        replicas: MetadataObjectWithType[][]
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
            this.getIdByMetadataType(item.object)
        );
        const exclusiveMetadata = _.pickBy(metadataGroupedById, group => group.length === 1);

        return _(exclusiveMetadata)
            .map(group => group[0])
            .compact()
            .value();
    }

    private findCodeDiscrepanciesAgainstMain(
        model: MetadataModel,
        mainList: MetadataObjectWithType[],
        replicaList: MetadataObjectWithType[],
        replicaIdx: number
    ): DiscrepancyMetadata[] {
        const mainById = _(mainList)
            .filter(mainObj => mainObj.model === model)
            .keyBy(metadataObject => this.getIdByMetadataType(metadataObject))
            .value();

        return _(replicaList)
            .filter(replicaObj => replicaObj.model === model)
            .filter(replicaObj => {
                const replicaId = this.getIdByMetadataType(replicaObj);
                const mainObj = mainById[replicaId];
                if (!mainObj) return false;

                const codeMain = mainObj.code ?? "";
                const codeReplica = replicaObj.code ?? "";
                return codeMain !== codeReplica;
            })
            .map(replicaObj => {
                const replicaId = this.getIdByMetadataType(replicaObj);
                const mainObj = mainById[replicaId];
                if (!mainObj) return undefined;
                return {
                    model,
                    id: replicaId,
                    mainObject: mainObj,
                    replicaObject: replicaObj,
                    replicaIndex: replicaIdx,
                    differingFields: ["code"],
                };
            })
            .compact()
            .value();
    }

    /* 
        Detect objects with the same ID but different codes to flag discrepancies.
     */
    private findCodeDiscrepanciesForModel(
        model: MetadataModel,
        mainList: MetadataObjectWithType[],
        replicaLists: MetadataObjectWithType[][]
    ): DiscrepancyMetadata[] {
        return replicaLists.flatMap((replicaList, idx) =>
            this.findCodeDiscrepanciesAgainstMain(model, mainList, replicaList, idx)
        );
    }

    private compareFields(mainObj: MetadataObjectWithType, replicaObj: MetadataObjectWithType): string[] {
        const mainAdd = mainObj.additionalFields ?? {};
        const replicaAdd = replicaObj.additionalFields ?? {};

        const allKeys = new Set([...Object.keys(mainAdd), ...Object.keys(replicaAdd)]);

        return _(Array.from(allKeys))
            .map(key => {
                if (METADATA_PROPERTIES_TO_IGNORE.includes(key)) return undefined;

                const mainVal = mainAdd[key];
                const replicaVal = replicaAdd[key];
                return !_.isEqual(mainVal, replicaVal) ? key : undefined;
            })
            .compact()
            .value();
    }

    /* 
        Detect objects with the same ID but different in certain fields
     */
    private findFieldDiscrepanciesAgainstMain(
        model: MetadataModel,
        mainList: MetadataObjectWithType[],
        replicaList: MetadataObjectWithType[],
        replicaIdx: number
    ): DiscrepancyMetadata[] {
        const mainById = _.keyBy(mainList, object => this.getIdByMetadataType(object));

        return _(replicaList)
            .map((replicaObj): Maybe<DiscrepancyMetadata> => {
                const replicaId = this.getIdByMetadataType(replicaObj);
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
        mainList: MetadataObjectWithType[],
        replicaLists: MetadataObjectWithType[][]
    ): DiscrepancyMetadata[] {
        return replicaLists.flatMap((replicaList, idx) =>
            this.findFieldDiscrepanciesAgainstMain(model, mainList, replicaList, idx)
        );
    }

    private async getObjects(options: {
        model: MetadataModel;
        server: MetadataRepository;
    }): Async<MetadataObjectWithType[]> {
        const { model, server } = options;
        const allObjects: MetadataObjectWithType[] = [];

        for (let page = 1; ; page++) {
            const { objects, pager } = await server.getPaginated({
                model: model,
                page: page,
            });
            allObjects.push(...objects);

            if (pager.page >= pager.pageCount) break;
        }

        return allObjects;
    }

    private getIdByMetadataType(metadataObject: MetadataObjectWithType): string {
        return metadataObject.type === "user" ? metadataObject.openId : metadataObject.id;
    }
}

type UseCaseOptions = { modelsToCheck: string[] };

export type SyncMetadataReport = {
    exclusiveMetadata: MetadataValidationResult[];
    metadataWithCodeDiscrepancies: DiscrepancyValidationResult[];
    metadataWithPropertiesDiscrepancies: DiscrepancyValidationResult[];
};
