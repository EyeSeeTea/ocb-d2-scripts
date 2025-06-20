import { Id } from "./Base";
import { MetadataModel, MetadataObjectWithType } from "./MetadataObject";

export type Source = { type: "main" } | { type: "replica"; index: number };

export type ExclusiveMetadataItem = {
    object: MetadataObjectWithType;
    source: Source;
};

export type MetadataValidationResult = {
    model: MetadataModel;
    exclusive: ExclusiveMetadataItem[];
};

export type DiscrepancyMetadata = {
    model: MetadataModel;
    id: Id;
    mainObject: MetadataObjectWithType;
    replicaObject: MetadataObjectWithType;
    replicaIndex: number;
    differingFields: string[];
};

export type DiscrepancyValidationResult = {
    model: MetadataModel;
    items: DiscrepancyMetadata[];
};

export const METADATA_PROPERTIES_TO_IGNORE = [
    "url",
    "href",
    "externalAccess",
    "publicAccess",
    "userGroupAccesses",
    "userAccesses",
    "access",
    "lastUpdatedBy",
    "createdBy",
    "code",
    "lastUpdated",
    "lastLogin",
    "users",
    "user",
];
