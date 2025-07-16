import _ from "lodash";
import { StatsWithReplica, SyncMetadataReport, SyncResult } from "domain/usecases/SyncMetadataUseCase";
import { createArrayCsvStringifier } from "csv-writer";
import { mkdirSync, writeFileSync } from "fs";
import logger from "utils/log";
import path from "path";
import { MetadataValidationResult } from "domain/entities/MetadataValidationResult";

export class SyncReport {
    public generateReports(syncResult: SyncResult): void {
        try {
            const { rootFolderPath, removeFolderPath, importFolderPath } = this.createFolderForReports();

            this.generateCsvReports({
                syncReport: syncResult.syncMetadataReport,
                rootFolderPath,
            });
            this.generateJsonReport({ syncResult, rootFolderPath, removeFolderPath, importFolderPath });
        } catch (error) {
            logger.error("Error generating report:");
            logger.error(JSON.stringify(error, null, 2));
        }
    }

    public generateCsvReports(options: { syncReport: SyncMetadataReport; rootFolderPath: string }): void {
        const { syncReport, rootFolderPath } = options;

        const metadataExclusiveCsvContent = this.generateExclusiveMetadataCsv(syncReport);
        this.generateCsvFileAndLog(
            metadataExclusiveCsvContent,
            path.join(rootFolderPath, "exclusive_metadata.csv"),
            "Exclusive metadata CSV report"
        );

        const metadataDiscrepanciesCsvContent = this.generateDiscrepanciesMetadataCsv(syncReport);

        this.generateCsvFileAndLog(
            metadataDiscrepanciesCsvContent,
            path.join(rootFolderPath, "discrepancies_metadata.csv"),
            "Discrepancies metadata CSV report"
        );

        const metadataPropertiesDiscrepanciesCsvContent =
            this.generatePropertiesDiscrepanciesMetadataCsv(syncReport);

        this.generateCsvFileAndLog(
            metadataPropertiesDiscrepanciesCsvContent,
            path.join(rootFolderPath, "properties_discrepancies_metadata.csv"),
            "Properties discrepancies metadata CSV report"
        );
    }

    public generateJsonReport(options: {
        syncResult: SyncResult;
        rootFolderPath: string;
        removeFolderPath: string;
        importFolderPath: string;
    }): void {
        const { syncResult, rootFolderPath, removeFolderPath, importFolderPath } = options;
        const { exclusiveMetadata } = syncResult.syncMetadataReport;

        // REMOVE metadata
        this.generateDeleteMetadataInDisk(
            exclusiveMetadata,
            removeFolderPath,
            syncResult.statsReport.deleteStats
        );

        // CREATE_UPDATE metadata
        this.generateImportMetadataInDisk(
            exclusiveMetadata,
            importFolderPath,
            syncResult.statsReport.saveStats
        );

        this.writeJsonFile({
            path: `${rootFolderPath}/metadata_stats.json`,
            content: syncResult.statsReport,
        });
    }

    private generateImportMetadataInDisk(
        exclusiveMetadata: MetadataValidationResult[],
        importFolderPath: string,
        stats: StatsWithReplica[]
    ) {
        const onlyMetadataData = exclusiveMetadata
            .map(result => {
                return result.exclusive.filter(item => item.source.type === "main");
            })
            .flatMap(item => item.map(item => item.object));

        const metadataObjectsByModelImport = _(onlyMetadataData)
            .groupBy(obj => obj.model)
            .value();

        _(metadataObjectsByModelImport).forEach((objects, model) => {
            const fileName = `${importFolderPath}/${model}.json`;
            this.writeJsonFile({
                path: fileName,
                content: { [model]: objects.map(object => object.additionalFields) },
            });
        });

        this.writeJsonFile({ path: `${importFolderPath}/_import_stats.json`, content: stats });
    }

    private generateDeleteMetadataInDisk(
        exclusiveMetadata: MetadataValidationResult[],
        removeFolderPath: string,
        stats: StatsWithReplica[]
    ) {
        const onlyReplicaMetadata = exclusiveMetadata.map(result => {
            return _(result.exclusive)
                .filter(item => item.source.type === "replica")
                .sortBy(item => {
                    return item.source.type === "replica" ? item.source.index : undefined;
                })
                .value();
        });

        const metadataToRemove = _(onlyReplicaMetadata)
            .flatMap(item => {
                return item.filter(item => item.source.type === "replica").map(item => item.object);
            })
            .value();

        const metadataObjectsByModel = _(metadataToRemove)
            .groupBy(obj => obj.model)
            .value();

        _(metadataObjectsByModel).forEach((objects, model) => {
            const fileName = `${removeFolderPath}/${model}.json`;
            this.writeJsonFile({
                path: fileName,
                content: { [model]: objects.map(object => ({ id: object.id })) },
            });
        });

        this.writeJsonFile({ path: `${removeFolderPath}/_delete_stats.json`, content: stats });
    }

    private generatePropertiesDiscrepanciesMetadataCsv(syncReport: SyncMetadataReport): string {
        const propertiesDiscrepanciesCsvStringifier = createArrayCsvStringifier({
            header: [
                "model",
                "id",
                "Code in Metadata Server",
                "Code in Replica Server",
                "Replica Server Number",
                "Diff Fields",
            ],
        });
        const header = propertiesDiscrepanciesCsvStringifier.getHeaderString();
        const rows = syncReport.metadataWithPropertiesDiscrepancies.flatMap(result =>
            result.items
                .map(item =>
                    propertiesDiscrepanciesCsvStringifier.stringifyRecords([
                        [
                            item.model,
                            item.id,
                            item.mainObject.code,
                            item.replicaObject.code ?? "",
                            item.replicaIndex + 1,
                            item.differingFields.join("-"),
                        ],
                    ])
                )
                .join("")
        );
        return [header, ...rows].join("");
    }

    private generateCsvFileAndLog(csvContent: string, fileName: string, message: string): void {
        if (csvContent) {
            writeFileSync(fileName, csvContent, { encoding: "utf8" });
        }
        logger.info(`${message} generated: ${fileName}`);
    }

    private generateDiscrepanciesMetadataCsv(syncReport: SyncMetadataReport): string {
        const discrepanciesCsvStringifier = createArrayCsvStringifier({
            header: [
                "model",
                "id",
                "Code in Metadata Server",
                "Code in Replica Server",
                "Replica Server Number",
            ],
        });
        const header = discrepanciesCsvStringifier.getHeaderString();
        const rows = syncReport.metadataWithCodeDiscrepancies.flatMap(result =>
            result.items
                .map(item =>
                    discrepanciesCsvStringifier.stringifyRecords([
                        [
                            item.model,
                            item.id,
                            item.mainObject.code,
                            item.replicaObject.code ?? "",
                            item.replicaIndex + 1,
                        ],
                    ])
                )
                .join("")
        );
        return [header, ...rows].join("");
    }

    private generateExclusiveMetadataCsv(syncReport: SyncMetadataReport): string {
        const exclusiveCsvStringifier = createArrayCsvStringifier({
            header: ["model", "id", "name", "code", "server"],
        });
        const header = exclusiveCsvStringifier.getHeaderString();
        const rows = syncReport.exclusiveMetadata.flatMap(result =>
            result.exclusive
                .map(item =>
                    exclusiveCsvStringifier.stringifyRecords([
                        [
                            item.object.model,
                            item.object.id,
                            item.object.name,
                            item.object.code ?? "",
                            item.source.type === "replica" ? `Replica ${item.source.index + 1}` : "metadata",
                        ],
                    ])
                )
                .join("")
        );
        return [header, ...rows].join("");
    }

    private createFolderForReports() {
        const currentTime = this.getCurrentTimestamp();
        const rootFolderPath = `sync_report_metadata_${currentTime}`;
        const removeFolderPath = path.join(rootFolderPath, "remove");
        const importFolderPath = path.join(rootFolderPath, "import");

        this.createReportFolder(rootFolderPath);
        this.createReportFolder(removeFolderPath);
        this.createReportFolder(importFolderPath);

        return { rootFolderPath, removeFolderPath, importFolderPath };
    }

    private createReportFolder(dirPath: string): void {
        try {
            mkdirSync(dirPath, { recursive: true });
        } catch (error) {
            logger.error(`Error creating folder: ${JSON.stringify(error, null, 2)}`);
            throw error;
        }
    }

    private getCurrentTimestamp(): string {
        const now = new Date();
        const pad = (n: number): string => n.toString().padStart(2, "0");

        const day = pad(now.getDate());
        const month = pad(now.getMonth() + 1);
        const year = now.getFullYear().toString();
        const hours = pad(now.getHours());
        const minutes = pad(now.getMinutes());
        const seconds = pad(now.getSeconds());

        return `${day}_${month}_${year}_${hours}_${minutes}_${seconds}`;
    }

    private writeJsonFile(options: { path: string; content: unknown }): void {
        const { path, content } = options;
        writeFileSync(path, JSON.stringify(content, null, 2), {
            encoding: "utf8",
        });
    }
}
