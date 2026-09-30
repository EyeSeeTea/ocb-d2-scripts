import _ from "lodash";
import { MetadataObjectWithType } from "./MetadataObject";
import { MetadataModelSchema } from "./MetadataSchema";
import { METADATA_PROPERTIES_TO_IGNORE } from "./MetadataValidationResult";

export function getDifferingFields(
    main: MetadataObjectWithType,
    replica: MetadataObjectWithType,
    schema: MetadataModelSchema
): ReadonlyArray<string> {
    const mainFields = main.additionalFields ?? {};
    const replicaFields = replica.additionalFields ?? {};
    const fields = _.union(Object.keys(mainFields), Object.keys(replicaFields));

    return fields.filter(
        field =>
            !METADATA_PROPERTIES_TO_IGNORE.includes(field) &&
            !areFieldValuesEqual(field, mainFields[field], replicaFields[field], schema)
    );
}

function areFieldValuesEqual(
    field: string,
    mainValue: unknown,
    replicaValue: unknown,
    schema: MetadataModelSchema
): boolean {
    const isUnorderedPair =
        schema.unorderedFields.has(field) && Array.isArray(mainValue) && Array.isArray(replicaValue);

    return isUnorderedPair
        ? _.isEqual(toCanonicalMultiset(mainValue), toCanonicalMultiset(replicaValue))
        : _.isEqual(mainValue, replicaValue);
}

function toCanonicalMultiset(values: ReadonlyArray<unknown>): ReadonlyArray<string> {
    return values.map(toCanonicalJson).sort();
}

function toCanonicalJson(value: unknown): string {
    return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeysDeep);
    if (!isPlainRecord(value)) return value;

    const entries = Object.entries(value);
    return Object.fromEntries(
        _.sortBy(entries, ([key]) => key).map(([key, nestedValue]) => [key, sortKeysDeep(nestedValue)])
    );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return _.isPlainObject(value);
}
