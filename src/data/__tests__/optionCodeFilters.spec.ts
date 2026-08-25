import { describe, expect, it } from "vitest";
import {
    recodeAnalyticsFilter,
    recodeDimensionCollections,
    recodeDimensions,
    recodeQueryCriteria,
} from "data/optionCodeFilters";

const FROM_CODE = "[R-HI]";
const TO_CODE = "R-HI";

describe("recodeAnalyticsFilter", () => {
    it("recodes the only item of an IN filter", () => {
        expect(recodeAnalyticsFilter("IN:[R-HI]", FROM_CODE, TO_CODE)).toBe("IN:R-HI");
    });

    it("recodes one item of an IN list and leaves the others", () => {
        expect(recodeAnalyticsFilter("IN:[R-HI];RX;RXTRA", FROM_CODE, TO_CODE)).toBe("IN:R-HI;RX;RXTRA");
    });

    it("does not touch an item that merely contains the code", () => {
        expect(recodeAnalyticsFilter("IN:RXTRA;RX", "RX", "REACTION")).toBe("IN:RXTRA;REACTION");
    });

    it("recodes an EQ filter", () => {
        expect(recodeAnalyticsFilter("EQ:[R-HI]", FROM_CODE, TO_CODE)).toBe("EQ:R-HI");
    });

    it("keeps chained numeric operators untouched", () => {
        expect(recodeAnalyticsFilter("GE:5:LE:10", FROM_CODE, TO_CODE)).toBe("GE:5:LE:10");
    });

    it("recodes an item in a chained filter", () => {
        expect(recodeAnalyticsFilter("NE:RX:IN:[R-HI];RX", FROM_CODE, TO_CODE)).toBe("NE:RX:IN:R-HI;RX");
    });

    it("does not treat an operator as a value", () => {
        expect(recodeAnalyticsFilter("IN:EQ", "IN", "OUT")).toBe("IN:EQ");
    });

    it("returns the filter as it is when the code is not present", () => {
        expect(recodeAnalyticsFilter("IN:RX;RXTRA", FROM_CODE, TO_CODE)).toBe("IN:RX;RXTRA");
    });

    it("returns the filter as it is when it is empty", () => {
        expect(recodeAnalyticsFilter("", FROM_CODE, TO_CODE)).toBe("");
    });
});

describe("recodeDimensions", () => {
    it("recodes the filter of each dimension and keeps the rest of the object", () => {
        const dimensions = [
            { dataElement: { id: "ZZdeTrack01" }, filter: "IN:[R-HI];RX", legendSet: { id: "abc" } },
            { dataElement: { id: "other" }, filter: "IN:RXTRA" },
        ];

        expect(recodeDimensions(dimensions, FROM_CODE, TO_CODE)).toEqual([
            { dataElement: { id: "ZZdeTrack01" }, filter: "IN:R-HI;RX", legendSet: { id: "abc" } },
            { dataElement: { id: "other" }, filter: "IN:RXTRA" },
        ]);
    });

    it("keeps dimensions without a filter", () => {
        const dimensions = [{ dataElement: { id: "ZZdeTrack01" } }];
        expect(recodeDimensions(dimensions, FROM_CODE, TO_CODE)).toEqual(dimensions);
    });

    it("returns the same dimension reference when nothing changes", () => {
        const dimension = { dataElement: { id: "ZZdeTrack01" }, filter: "IN:RX" };
        expect(recodeDimensions([dimension], FROM_CODE, TO_CODE)[0]).toBe(dimension);
    });
});

describe("recodeQueryCriteria", () => {
    it("recodes the values of dataFilters", () => {
        const criteria = { dataFilters: [{ dataItem: "ZZdeTrack01", in: ["[R-HI]", "RX"] }] };

        expect(recodeQueryCriteria(criteria, FROM_CODE, TO_CODE)).toEqual({
            dataFilters: [{ dataItem: "ZZdeTrack01", in: ["R-HI", "RX"] }],
        });
    });

    it("recodes the values of attributeValueFilters", () => {
        const criteria = { attributeValueFilters: [{ attribute: "ZZteaReac01", in: ["[R-HI]"] }] };

        expect(recodeQueryCriteria(criteria, FROM_CODE, TO_CODE)).toEqual({
            attributeValueFilters: [{ attribute: "ZZteaReac01", in: ["R-HI"] }],
        });
    });

    it("recodes an eq value", () => {
        const criteria = { dataFilters: [{ dataItem: "ZZdeTrack01", eq: "[R-HI]" }] };

        expect(recodeQueryCriteria(criteria, FROM_CODE, TO_CODE)).toEqual({
            dataFilters: [{ dataItem: "ZZdeTrack01", eq: "R-HI" }],
        });
    });

    it("keeps the other properties of the criteria and of each filter", () => {
        const criteria = {
            displayColumnOrder: ["eventDate"],
            dataFilters: [{ dataItem: "ZZdeTrack01", in: ["[R-HI]"], like: "keep" }],
        };

        expect(recodeQueryCriteria(criteria, FROM_CODE, TO_CODE)).toEqual({
            displayColumnOrder: ["eventDate"],
            dataFilters: [{ dataItem: "ZZdeTrack01", in: ["R-HI"], like: "keep" }],
        });
    });

    it("does not touch a value that merely contains the code", () => {
        const criteria = { dataFilters: [{ dataItem: "ZZdeTrack01", in: ["RXTRA"] }] };
        expect(recodeQueryCriteria(criteria, "RX", "REACTION")).toEqual(criteria);
    });

    it("returns the same criteria reference when nothing changes", () => {
        const criteria = { dataFilters: [{ dataItem: "ZZdeTrack01", in: ["RX"] }] };
        expect(recodeQueryCriteria(criteria, FROM_CODE, TO_CODE)).toBe(criteria);
    });

    it("returns criteria without filters as it is", () => {
        const criteria = { displayColumnOrder: ["eventDate"] };
        expect(recodeQueryCriteria(criteria, FROM_CODE, TO_CODE)).toBe(criteria);
    });
});

describe("recodeDimensionCollections", () => {
    const collections = ["dataElementDimensions", "attributeDimensions", "programIndicatorDimensions"];

    it("recodes every collection present and keeps the rest of the object", () => {
        const eventVisualization = {
            id: "ZZevVis0001",
            name: "ZZREF EV dimension filters",
            dataElementDimensions: [{ dataElement: { id: "ZZdeTrack01" }, filter: "IN:[R-HI];RX" }],
            attributeDimensions: [{ attribute: { id: "ZZteaReac01" }, filter: "IN:[R-HI]" }],
            programIndicatorDimensions: [{ programIndicator: { id: "ZZpiValue01" }, filter: "IN:[R-HI]" }],
        };

        expect(recodeDimensionCollections(eventVisualization, collections, FROM_CODE, TO_CODE)).toEqual({
            id: "ZZevVis0001",
            name: "ZZREF EV dimension filters",
            dataElementDimensions: [{ dataElement: { id: "ZZdeTrack01" }, filter: "IN:R-HI;RX" }],
            attributeDimensions: [{ attribute: { id: "ZZteaReac01" }, filter: "IN:R-HI" }],
            programIndicatorDimensions: [{ programIndicator: { id: "ZZpiValue01" }, filter: "IN:R-HI" }],
        });
    });

    it("ignores collections that are absent", () => {
        const mapView = {
            id: "ZZmapView01",
            dataElementDimensions: [{ dataElement: { id: "ZZdeTrack01" }, filter: "IN:[R-HI]" }],
        };

        expect(recodeDimensionCollections(mapView, collections, FROM_CODE, TO_CODE)).toEqual({
            id: "ZZmapView01",
            dataElementDimensions: [{ dataElement: { id: "ZZdeTrack01" }, filter: "IN:R-HI" }],
        });
    });

    it("returns the same object reference when no dimension changes", () => {
        const mapView = { id: "ZZmapView01", dataElementDimensions: [{ filter: "IN:RXTRA" }] };
        expect(recodeDimensionCollections(mapView, collections, FROM_CODE, TO_CODE)).toBe(mapView);
    });
});
