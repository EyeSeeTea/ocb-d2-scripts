import { describe, it, expect } from "vitest";
import { getDifferingFields } from "../MetadataComparison";
import { buildMetadataModelSchema } from "../MetadataSchema";
import { categoryOptionComboRefs, createCategoryCombo } from "./fixtures/categoryCombo.data";

const UNORDERED_FIELD = "categoryOptionCombos";
const ORDERED_FIELD = "categories";

const schema = buildMetadataModelSchema("categoryCombos", [UNORDERED_FIELD, "translations"]);

const [refA, refB, refC] = categoryOptionComboRefs;

const esTranslation = { locale: "es", property: "NAME", value: "CNTA Edad 6 y salida" };
const frTranslation = { locale: "fr", property: "NAME", value: "Âge 6 et sortie en CNTA" };

describe("getDifferingFields", () => {
    describe("fields without order in DHIS2", () => {
        it("ignores a different order of references", () => {
            expect(
                compare({ [UNORDERED_FIELD]: [refA, refB, refC] }, { [UNORDERED_FIELD]: [refB, refA, refC] })
            ).toEqual([]);
        });

        it("reports a different set of references", () => {
            expect(compare({ [UNORDERED_FIELD]: [refA, refB] }, { [UNORDERED_FIELD]: [refA, refC] })).toEqual(
                [UNORDERED_FIELD]
            );
        });

        it("reports a different number of repetitions of the same items", () => {
            expect(
                compare({ [UNORDERED_FIELD]: [refA, refA, refB] }, { [UNORDERED_FIELD]: [refA, refB, refB] })
            ).toEqual([UNORDERED_FIELD]);
        });

        it("ignores a different order of translations and of their keys", () => {
            const reorderedEsTranslation = { value: esTranslation.value, property: "NAME", locale: "es" };

            expect(
                compare(
                    { translations: [esTranslation, frTranslation] },
                    { translations: [frTranslation, reorderedEsTranslation] }
                )
            ).toEqual([]);
        });

        it("reports a translation with a different value", () => {
            const changedFrTranslation = { ...frTranslation, value: "Âge 6" };

            expect(
                compare(
                    { translations: [esTranslation, frTranslation] },
                    { translations: [changedFrTranslation, esTranslation] }
                )
            ).toEqual(["translations"]);
        });

        it("ignores a different order of attribute values even if the schema does not list them", () => {
            const firstValue = { attribute: { id: "attr1" }, value: "1" };
            const secondValue = { attribute: { id: "attr2" }, value: "2" };

            expect(
                compare(
                    { attributeValues: [firstValue, secondValue] },
                    { attributeValues: [secondValue, firstValue] }
                )
            ).toEqual([]);
        });
    });

    describe("fields with order in DHIS2", () => {
        it("reports a different order of references", () => {
            expect(compare({ [ORDERED_FIELD]: [refA, refB] }, { [ORDERED_FIELD]: [refB, refA] })).toEqual([
                ORDERED_FIELD,
            ]);
        });
    });

    describe("non-collection fields", () => {
        it("reports a different scalar value", () => {
            expect(compare({ skipTotal: false }, { skipTotal: true })).toEqual(["skipTotal"]);
        });

        it("reports a field present in only one of the objects", () => {
            expect(compare({ dataDimensionType: "DISAGGREGATION" }, {})).toEqual(["dataDimensionType"]);
        });

        it("never reports ignored properties", () => {
            expect(compare({ lastUpdated: "2026-04-01" }, { lastUpdated: "2026-03-25" })).toEqual([]);
        });
    });
});

function compare(mainFields: Record<string, unknown>, replicaFields: Record<string, unknown>) {
    return getDifferingFields(createCategoryCombo(mainFields), createCategoryCombo(replicaFields), schema);
}
