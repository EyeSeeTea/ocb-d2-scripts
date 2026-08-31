import { Id } from "./Base";
import { MetadataModel, MetadataObjectWithType } from "./MetadataObject";

export type Source = { type: "main" } | { type: "replica"; index: number };

export function getSourceName(source: Source): string {
    return source.type === "replica" ? `Replica ${source.index + 1}` : "metadata";
}

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

export const skipReasons = ["missing-identifier"] as const;
export type SkipReason = typeof skipReasons[number];

/*
    Objects left out of the comparison because they cannot be identified in both servers.
*/
export type SkippedMetadataItem = Readonly<{
    object: MetadataObjectWithType;
    source: Source;
    reason: SkipReason;
}>;

export type SkippedValidationResult = {
    model: MetadataModel;
    items: SkippedMetadataItem[];
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
