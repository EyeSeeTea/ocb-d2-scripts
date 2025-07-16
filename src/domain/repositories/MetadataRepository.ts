import { Async } from "domain/entities/Async";
import { MetadataModel, MetadataObjectWithType } from "domain/entities/MetadataObject";
import { Paginated } from "domain/entities/Pagination";
import { Stats } from "domain/entities/Stats";
import { MetadataActionType } from "domain/usecases/SyncMetadataUseCase";

export interface MetadataRepository {
    getPaginated(options: { model: MetadataModel; page: number }): Async<Paginated<MetadataObjectWithType>>;
    delete(metadataObjects: MetadataObjectWithType[], options: SaveMetadataOptions): Async<Stats[]>;
    save(metadataObjects: MetadataObjectWithType[], options: SaveMetadataOptions): Async<Stats[]>;
}

export type Payload = Record<MetadataModel, object[]>;
export type SaveMetadataOptions = {
    action: MetadataActionType;
    persist: boolean;
};
