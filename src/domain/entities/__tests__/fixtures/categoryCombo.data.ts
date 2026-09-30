import { MetadataObject } from "domain/entities/MetadataObject";

export const categoryComboId = "qZConKk2nzD";

export const categoryOptionComboRefs = [
    { id: "fzSkTxkfU5L" },
    { id: "jQtur8vv0i6" },
    { id: "xv8vqovB7Tv" },
] as const;

export function createCategoryCombo(additionalFields: Record<string, unknown>): MetadataObject {
    return {
        model: "categoryCombos",
        id: categoryComboId,
        name: "ATFC Age 6 and exit",
        code: "CC_NUT_003",
        type: "common",
        additionalFields: { id: categoryComboId, ...additionalFields },
    };
}
