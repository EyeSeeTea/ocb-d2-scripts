import { Async } from "domain/entities/Async";
import { MetadataModel, MetadataObjectWithType } from "domain/entities/MetadataObject";
import { Paginated } from "domain/entities/Pagination";

export interface MetadataRepository {
    getPaginated(options: { model: MetadataModel; page: number }): Async<Paginated<MetadataObjectWithType>>;
}

export type Payload = Record<MetadataModel, object[]>;

export interface SaveOptions {
    dryRun: boolean;
}
