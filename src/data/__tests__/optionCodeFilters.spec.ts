import { describe, expect, it } from "vitest";
import {
    findLikeFilters,
    recodeAnalyticsFilter,
    recodeDimensionCollections,
    recodeQueryCriteria,
} from "data/optionCodeFilters";

const DE = "lCoJD1K1cm0";
const OTHER_DE = "pV6GZChjIuj";
const TEA = "OcaSynTeaPe";
const mapping = { "13": "1", "1": "2", RX: "R1" };
const itemIds = { dataElementIds: [DE], attributeIds: [TEA] };

describe("recodeAnalyticsFilter", () => {
    it("recodes the items of an IN filter in a single pass", () => {
        expect(recodeAnalyticsFilter("IN:1;13;5", mapping)).toBe("IN:2;1;5");
    });

    it("recodes EQ and chained operators, not operators nor numbers", () => {
        expect(recodeAnalyticsFilter("EQ:13", mapping)).toBe("EQ:1");
        expect(recodeAnalyticsFilter("IN:1;13:NE:12", mapping)).toBe("IN:2;1:NE:12");
        expect(recodeAnalyticsFilter("GE:5:LE:10", mapping)).toBe("GE:5:LE:10");
    });

    it("does not touch an item that merely contains a code", () => {
        expect(recodeAnalyticsFilter("IN:RXTRA", mapping)).toBe("IN:RXTRA");
    });

    it("returns an empty filter as it is", () => {
        expect(recodeAnalyticsFilter("", mapping)).toBe("");
    });
});

describe("recodeDimensionCollections", () => {
    const collections = ["dataElementDimensions", "attributeDimensions", "programIndicatorDimensions"];

    it("recodes only the dimensions of the items of the set", () => {
        const object = {
            id: "ev1",
            dataElementDimensions: [
                { dataElement: { id: DE }, filter: "IN:1;13" },
                { dataElement: { id: OTHER_DE }, filter: "IN:1;13" },
            ],
            attributeDimensions: [{ attribute: { id: TEA }, filter: "EQ:13" }],
            programIndicatorDimensions: [{ programIndicator: { id: "pi1" }, filter: "IN:1" }],
        };

        const recoded = recodeDimensionCollections(object, collections, [DE, TEA, "pi1"], mapping);

        expect(recoded).toEqual({
            id: "ev1",
            dataElementDimensions: [
                { dataElement: { id: DE }, filter: "IN:2;1" },
                { dataElement: { id: OTHER_DE }, filter: "IN:1;13" },
            ],
            attributeDimensions: [{ attribute: { id: TEA }, filter: "EQ:1" }],
            programIndicatorDimensions: [{ programIndicator: { id: "pi1" }, filter: "IN:2" }],
        });
    });

    it("returns the same object when nothing changes", () => {
        const object = { dataElementDimensions: [{ dataElement: { id: OTHER_DE }, filter: "IN:1" }] };
        expect(recodeDimensionCollections(object, collections, [DE], mapping)).toBe(object);
    });

    it("ignores absent collections and dimensions without filter", () => {
        const object = { dataElementDimensions: [{ dataElement: { id: DE } }] };
        expect(recodeDimensionCollections(object, collections, [DE], mapping)).toBe(object);
    });
});

describe("recodeQueryCriteria", () => {
    it("recodes in/eq of the filters on the items of the set, keeping the rest", () => {
        const criteria = {
            order: "eventDate:asc",
            dataFilters: [
                { dataItem: DE, in: ["1", "13"] },
                { dataItem: DE, eq: "13" },
                { dataItem: OTHER_DE, in: ["1"] },
            ],
            attributeValueFilters: [{ attribute: TEA, eq: "1" }],
        };

        expect(recodeQueryCriteria(criteria, itemIds, mapping)).toEqual({
            order: "eventDate:asc",
            dataFilters: [
                { dataItem: DE, in: ["2", "1"] },
                { dataItem: DE, eq: "1" },
                { dataItem: OTHER_DE, in: ["1"] },
            ],
            attributeValueFilters: [{ attribute: TEA, eq: "2" }],
        });
    });

    it("returns the same criteria when nothing changes, and non-objects as they are", () => {
        const criteria = { dataFilters: [{ dataItem: OTHER_DE, in: ["1"] }] };
        expect(recodeQueryCriteria(criteria, itemIds, mapping)).toBe(criteria);
        expect(recodeQueryCriteria(null, itemIds, mapping)).toBe(null);
    });
});

describe("findLikeFilters", () => {
    it("finds like filters on the items of the set", () => {
        const criteria = {
            dataFilters: [
                { dataItem: DE, like: "Malari" },
                { dataItem: OTHER_DE, like: "x" },
            ],
        };
        expect(findLikeFilters(criteria, itemIds)).toEqual([{ dataItem: DE, like: "Malari" }]);
    });
});
