import { MetadataModel } from "./MetadataObject";

/*
    Fields of a metadata model whose array values have no meaningful order in DHIS2 (persisted as
    sets), so two servers may return the same items in a different order. Any field not listed
    here is compared taking the order into account.
*/
export type MetadataModelSchema = Readonly<{
    model: MetadataModel;
    unorderedFields: ReadonlySet<string>;
}>;

/* The API returns attributeValues as an array, but DHIS2 stores it as a map, not as a collection. */
const alwaysUnorderedFields = ["attributeValues"] as const;

export function buildMetadataModelSchema(
    model: MetadataModel,
    unorderedCollections: ReadonlyArray<string>
): MetadataModelSchema {
    return {
        model: model,
        unorderedFields: new Set([...unorderedCollections, ...alwaysUnorderedFields]),
    };
}
