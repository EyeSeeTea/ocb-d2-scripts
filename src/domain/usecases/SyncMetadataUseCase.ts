import _ from "lodash";

import { Maybe } from "utils/ts-utils";
import { Async } from "domain/entities/Async";
import {
    ComparableMetadataObject,
    getComparisonIdentifier,
    MetadataModel,
    MetadataObjectWithType,
} from "domain/entities/MetadataObject";
import { MetadataRepository } from "domain/repositories/MetadataRepository";
import { MetadataModelSchema } from "domain/entities/MetadataSchema";
import { getDifferingFields } from "domain/entities/MetadataComparison";
import {
    ExclusiveMetadataItem,
    MetadataValidationResult,
    DiscrepancyMetadata,
    DiscrepancyValidationResult,
    SkippedMetadataItem,
    SkippedValidationResult,
    Source,
    getSourceName,
} from "domain/entities/MetadataValidationResult";
import logger from "utils/log";
import { promiseMap } from "utils/promises";
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

            const schema = await this.metadataRepositoryMain.getModelSchema(model);

            const main = this.partitionByIdentity(model, mainObjects, { type: "main" });
            const replicas = replicaObjects.map((objects, index) =>
                this.partitionByIdentity(model, objects, { type: "replica", index: index })
            );
            const comparableReplicas = replicas.map(replica => replica.comparable);

            const exclusiveMetadata = this.findExclusiveMetadataWithSource(
                main.comparable,
                comparableReplicas,
                totalReplicas
            );

            const metadataWithCodeDiscrepancies = this.findCodeDiscrepanciesForModel(
                model,
                main.comparable,
                comparableReplicas
            );

            const metadataWithPropertiesDiscrepancies = this.findFieldDiscrepanciesForModel(
                schema,
                main.comparable,
                comparableReplicas
            );

            return {
                model,
                exclusiveMetadata,
                metadataWithCodeDiscrepancies,
                metadataWithPropertiesDiscrepancies,
                skippedMetadata: [...main.skipped, ...replicas.flatMap(replica => replica.skipped)],
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
            skippedMetadata: resultByModel.map(result => ({
                model: result.model,
                items: result.skippedMetadata,
            })),
        };
    }

    /*
      Split the objects of a server between the ones that can be compared and the ones that cannot,
      because their comparison identifier is missing (users without an OIDC identifier). Comparing
      the latter would match unrelated objects, so they are excluded and reported apart.
    */
    private partitionByIdentity(
        model: MetadataModel,
        objects: MetadataObjectWithType[],
        source: Source
    ): PartitionedMetadata {
        const objectsWithIdentifier = objects.map(object => ({
            object: object,
            identifier: getComparisonIdentifier(object),
        }));

        const comparable = _(objectsWithIdentifier)
            .map(
                ({ object, identifier }): Maybe<ComparableMetadataObject> =>
                    identifier ? { object: object, identifier: identifier } : undefined
            )
            .compact()
            .value();

        const skipped = _(objectsWithIdentifier)
            .filter(({ identifier }) => !identifier)
            .map(({ object }): SkippedMetadataItem => {
                return { object: object, source: source, reason: "missing-identifier" };
            })
            .value();

        if (skipped.length > 0) {
            logger.warn(
                `[${getSourceName(source)}]: ${skipped.length} ${model} skipped, ` +
                    `their identifier could not be resolved`
            );
        }

        return { comparable: comparable, skipped: skipped };
    }

    /*
      Metadata objects that exist only in one of the instances (based on their identifiers).
    */
    private findExclusiveMetadataWithSource(
        main: ComparableMetadataObject[],
        replicas: ComparableMetadataObject[][],
        totalReplicas: number
    ): ExclusiveMetadataItem[] {
        const metadataWithSource = [
            ...main.map(
                (comparable): IdentifiedExclusiveItem => ({
                    identifier: comparable.identifier,
                    item: { object: comparable.object, source: { type: "main" } },
                })
            ),
            ...replicas.flatMap((list, replicaIndex) =>
                list.map(
                    (comparable): IdentifiedExclusiveItem => ({
                        identifier: comparable.identifier,
                        item: {
                            object: comparable.object,
                            source: { type: "replica", index: replicaIndex },
                        },
                    })
                )
            ),
        ];

        const metadataGroupedById = _.groupBy(metadataWithSource, entry => entry.identifier);
        const exclusiveMetadata = _.pickBy(metadataGroupedById, group => group.length !== totalReplicas + 1);

        return _(exclusiveMetadata)
            .map(group => group[0]?.item)
            .compact()
            .value();
    }

    private findCodeDiscrepanciesAgainstMain(
        model: MetadataModel,
        mainList: ComparableMetadataObject[],
        replicaList: ComparableMetadataObject[],
        replicaIdx: number
    ): DiscrepancyMetadata[] {
        const mainByIdentifier = _.keyBy(mainList, comparable => comparable.identifier);

        return _(replicaList)
            .map((replica): Maybe<DiscrepancyMetadata> => {
                const mainObject = mainByIdentifier[replica.identifier]?.object;
                if (!mainObject) return undefined;

                const codeMain = mainObject.code ?? "";
                const codeReplica = replica.object.code ?? "";
                if (codeMain === codeReplica) return undefined;

                return {
                    model: model,
                    id: replica.identifier,
                    mainObject: mainObject,
                    replicaObject: replica.object,
                    replicaIndex: replicaIdx,
                    differingFields: ["code"],
                };
            })
            .compact()
            .value();
    }

    /* 
        Detect objects with the same identifier but different codes to flag discrepancies.
     */
    private findCodeDiscrepanciesForModel(
        model: MetadataModel,
        mainList: ComparableMetadataObject[],
        replicaLists: ComparableMetadataObject[][]
    ): DiscrepancyMetadata[] {
        return replicaLists.flatMap((replicaList, idx) =>
            this.findCodeDiscrepanciesAgainstMain(model, mainList, replicaList, idx)
        );
    }

    /* 
        Detect objects with the same identifier but different in certain fields
     */
    private findFieldDiscrepanciesAgainstMain(
        schema: MetadataModelSchema,
        mainList: ComparableMetadataObject[],
        replicaList: ComparableMetadataObject[],
        replicaIdx: number
    ): DiscrepancyMetadata[] {
        const mainByIdentifier = _.keyBy(mainList, comparable => comparable.identifier);

        return _(replicaList)
            .map((replica): Maybe<DiscrepancyMetadata> => {
                const mainObject = mainByIdentifier[replica.identifier]?.object;
                if (!mainObject) return undefined;

                const differingFields = getDifferingFields(mainObject, replica.object, schema);
                if (differingFields.length === 0) return undefined;

                return {
                    model: schema.model,
                    id: replica.identifier,
                    mainObject: mainObject,
                    replicaObject: replica.object,
                    replicaIndex: replicaIdx,
                    differingFields: differingFields,
                };
            })
            .compact()
            .value();
    }

    private findFieldDiscrepanciesForModel(
        schema: MetadataModelSchema,
        mainList: ComparableMetadataObject[],
        replicaLists: ComparableMetadataObject[][]
    ): DiscrepancyMetadata[] {
        return replicaLists.flatMap((replicaList, idx) =>
            this.findFieldDiscrepanciesAgainstMain(schema, mainList, replicaList, idx)
        );
    }

    private async getObjects(options: {
        model: MetadataModel;
        server: MetadataRepository;
        page?: number;
    }): Async<MetadataObjectWithType[]> {
        const { model, server, page = 1 } = options;
        const { objects, pager } = await server.getPaginated({ model: model, page: page });
        if (pager.page >= pager.pageCount) return objects;

        const nextObjects = await this.getObjects({ model: model, server: server, page: page + 1 });
        return [...objects, ...nextObjects];
    }
}

type PartitionedMetadata = Readonly<{
    comparable: ComparableMetadataObject[];
    skipped: SkippedMetadataItem[];
}>;

type IdentifiedExclusiveItem = Readonly<{
    identifier: string;
    item: ExclusiveMetadataItem;
}>;

type UseCaseOptions = {
    modelsToCheck: MetadataModel[];
    action: Maybe<MetadataActionType>;
    persist: boolean;
};

export type SyncMetadataReport = {
    exclusiveMetadata: MetadataValidationResult[];
    metadataWithCodeDiscrepancies: DiscrepancyValidationResult[];
    metadataWithPropertiesDiscrepancies: DiscrepancyValidationResult[];
    skippedMetadata: SkippedValidationResult[];
};

export type StatsWithReplica = Stats & { replicaIndex: number };

export type StatsReport = {
    deleteStats: StatsWithReplica[];
    saveStats: StatsWithReplica[];
};

export type SyncResult = { statsReport: StatsReport; syncMetadataReport: SyncMetadataReport };

export const metadataActions = ["CREATE", "CREATE_AND_UPDATE", "DELETE", "DELETE_WITH_DATA"] as const;
export type MetadataActionType = typeof metadataActions[number];
