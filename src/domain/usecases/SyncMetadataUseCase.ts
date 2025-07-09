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
import { Stats } from "domain/entities/Stats";

export class SyncMetadataUseCase {
    constructor(
        private metadataRepositoryMain: MetadataRepository,
        private metadataReplicaRepositories: MetadataRepository[]
    ) {}

    async execute(options: UseCaseOptions): Async<SyncResult> {
        const { modelsToCheck } = options;
        const syncReport = await this.validateMetadataByModel(modelsToCheck);

        const deleteStats = await this.removeOrphanMetadataInReplicas(syncReport.exclusiveMetadata, options);
        const createStats = await this.saveMissingMetadataInReplicas(syncReport.exclusiveMetadata, options);

        return {
            syncMetadataReport: syncReport,
            statsReport: { saveStats: createStats, deleteStats: deleteStats },
        };
    }

    private async saveMissingMetadataInReplicas(
        exclusiveMetadata: MetadataValidationResult[],
        options: UseCaseOptions
    ): Async<StatsWithReplica[]> {
        const { action, persist } = options;
        if (action !== "CREATE" && action !== "CREATE_AND_UPDATE") return [];

        const onlyMetadataData = exclusiveMetadata.map(result => {
            return result.exclusive.filter(item => item.source.type === "main");
        });

        const allStats = await promiseMap(this.metadataReplicaRepositories, async replicaRepository => {
            const replicaIndex = this.metadataReplicaRepositories.indexOf(replicaRepository);
            logger.info(`[Replica Server ${replicaIndex + 1}]: Create missing metadata...`);
            const metadataToSave = onlyMetadataData.flatMap(item => {
                return item.map(item => item.object);
            });

            if (metadataToSave.length === 0) return [];

            const stats = await replicaRepository.save(metadataToSave, {
                action: action,
                persist: persist,
            });
            logger.info("[Replica Server]: Create process finished");
            return stats.map(stat => ({ ...stat, replicaIndex: replicaIndex }));
        });

        return allStats.flat();
    }

    private async removeOrphanMetadataInReplicas(
        exclusiveMetadata: MetadataValidationResult[],
        options: UseCaseOptions
    ): Async<StatsWithReplica[]> {
        const { action, persist } = options;
        if (action !== "DELETE" && action !== "DELETE_WITH_DATA") return [];

        const onlyReplicaMetadata = exclusiveMetadata.map(result => {
            return result.exclusive.filter(item => item.source.type === "replica");
        });

        const allStats = await promiseMap(this.metadataReplicaRepositories, async replicaRepository => {
            const index = this.metadataReplicaRepositories.indexOf(replicaRepository);
            logger.info(`[Replica Server ${index + 1}]: Deleting orphan metadata...`);
            const metadataToRemove = onlyReplicaMetadata.flatMap(item => {
                return item
                    .filter(item => item.source.type === "replica" && index === item.source.index)
                    .map(item => item.object);
            });

            if (metadataToRemove.length === 0) return [];

            const stats = await replicaRepository.delete(metadataToRemove, {
                action: action,
                persist: persist,
            });
            logger.info("[Replica Server]: Delete process finished");
            return stats.map(stat => ({ ...stat, replicaIndex: index }));
        });

        return allStats.flat();
    }

    private async validateMetadataByModel(modelsToCheck: MetadataModel[]): Async<SyncMetadataReport> {
        const totalReplicas = this.metadataReplicaRepositories.length;
        const resultByModel = await promiseMap(modelsToCheck, async model => {
            logger.info(`[Main Server]: Fetching metadata for model: ${model}`);
            const mainObjects = await this.getObjects({ model, server: this.metadataRepositoryMain });

            logger.info(`[Replica Servers]: Fetching metadata for model: ${model}`);
            const replicaObjects = await Promise.all(
                this.metadataReplicaRepositories.map(replicaServer =>
                    this.getObjects({ model, server: replicaServer })
                )
            );

            const exclusiveMetadata = this.findExclusiveMetadataWithSource(
                mainObjects,
                replicaObjects,
                totalReplicas
            );

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
        replicas: MetadataObjectWithType[][],
        totalReplicas: number
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
        const exclusiveMetadata = _.pickBy(metadataGroupedById, group => group.length !== totalReplicas + 1);

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

type UseCaseOptions = {
    modelsToCheck: MetadataModel[];
    action: Maybe<MetadataActionType>;
    persist: boolean;
};

export type SyncMetadataReport = {
    exclusiveMetadata: MetadataValidationResult[];
    metadataWithCodeDiscrepancies: DiscrepancyValidationResult[];
    metadataWithPropertiesDiscrepancies: DiscrepancyValidationResult[];
};

export type StatsWithReplica = Stats & { replicaIndex: number };

export type StatsReport = {
    deleteStats: StatsWithReplica[];
    saveStats: StatsWithReplica[];
};

export type SyncResult = { statsReport: StatsReport; syncMetadataReport: SyncMetadataReport };

export const metadataActions = ["CREATE", "CREATE_AND_UPDATE", "DELETE", "DELETE_WITH_DATA"] as const;
export type MetadataActionType = typeof metadataActions[number];
