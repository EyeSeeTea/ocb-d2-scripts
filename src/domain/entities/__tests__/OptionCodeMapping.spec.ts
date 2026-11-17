import { describe, expect, it } from "vitest";
import {
    buildRecodePlans,
    MappingOptionSet,
    needsTemporaryCodes,
    OptionCodeChange,
    recodeValue,
} from "domain/entities/OptionCodeMapping";

// Precipitating Event on QA1: active options renumbered over codes held by RETIRED options.
const precipitatingEvent: MappingOptionSet = {
    id: "SlSZSqeim6h",
    name: "Precipitating Event",
    options: [
        { id: "LQpHXF8qwgC", name: "[1] Medical conditions", code: "13" },
        { id: "N6m5qKjPpFz", name: "[2] Violence", code: "1" },
        { id: "A7a4VRrgmTn", name: "[3] Separation and loss", code: "3A" },
        { id: "retired0002", name: "[2] Physical violence - RETIRED", code: "2" },
    ],
};

const simpleSet: MappingOptionSet = {
    id: "DNxOZ6LGXnM",
    name: "Birthweight category",
    options: [
        { id: "Mne6tyDrQZG", name: "[99] Unknown", code: "[99]" },
        { id: "optionAaaaa", name: "[A] A", code: "B" },
        { id: "optionBbbbb", name: "[B] B", code: "A" },
    ],
};

let row = 1;
function change(
    optionSet: MappingOptionSet,
    optionId: string,
    toCode: string,
    attrs: Partial<OptionCodeChange> = {}
): OptionCodeChange {
    const option = optionSet.options.find(o => o.id === optionId);
    return {
        row: ++row,
        optionSetId: optionSet.id,
        optionId,
        fromCode: option?.code ?? "",
        toCode,
        changeType: "RECODE",
        ...attrs,
    };
}

const build = (changes: OptionCodeChange[], includeToBeConfirmed = false) =>
    buildRecodePlans(changes, [precipitatingEvent, simpleSet], { includeToBeConfirmed });

const statuses = (changes: OptionCodeChange[], includeToBeConfirmed = false) =>
    build(changes, includeToBeConfirmed).results.map(result => [
        result.change.optionId,
        result.status,
        result.reason,
    ]);

describe("buildRecodePlans", () => {
    it("plans a simple change", () => {
        const { plans, results } = build([change(simpleSet, "Mne6tyDrQZG", "99")]);

        expect(results.map(r => r.status)).toEqual(["pending"]);
        expect(plans).toEqual([
            {
                optionSet: simpleSet,
                changes: [expect.objectContaining({ toCode: "99" })],
                mapping: { "[99]": "99" },
            },
        ]);
    });

    it("allows a swap, since the final codes are unique", () => {
        const { plans } = build([
            change(simpleSet, "optionAaaaa", "A"),
            change(simpleSet, "optionBbbbb", "B"),
        ]);

        expect(plans[0]?.mapping).toEqual({ B: "A", A: "B" });
        expect(plans[0] && needsTemporaryCodes(plans[0])).toBe(true);
    });

    it("rejects a collision with an option not in the mapping, and the chain that depends on it", () => {
        const result = statuses([
            change(precipitatingEvent, "LQpHXF8qwgC", "1"),
            change(precipitatingEvent, "N6m5qKjPpFz", "2"),
            change(precipitatingEvent, "A7a4VRrgmTn", "3"),
        ]);

        expect(result).toEqual([
            ["LQpHXF8qwgC", "error", 'code 1 held by option "[2] Violence" (1)'],
            ["N6m5qKjPpFz", "error", 'code 2 held by option "[2] Physical violence - RETIRED" (2)'],
            ["A7a4VRrgmTn", "pending", ""],
        ]);
    });

    it("allows a chain whose target code is freed by another change", () => {
        const set: MappingOptionSet = {
            ...precipitatingEvent,
            options: precipitatingEvent.options.filter(option => option.id !== "retired0002"),
        };
        const { plans, results } = buildRecodePlans(
            [change(set, "LQpHXF8qwgC", "1"), change(set, "N6m5qKjPpFz", "2")],
            [set],
            { includeToBeConfirmed: false }
        );

        expect(results.map(r => r.status)).toEqual(["pending", "pending"]);
        expect(plans[0]?.mapping).toEqual({ "13": "1", "1": "2" });
    });

    it("rejects two changes to the same code", () => {
        const result = statuses([
            change(simpleSet, "optionAaaaa", "X"),
            change(simpleSet, "optionBbbbb", "X"),
        ]);

        expect(result.map(r => r[1])).toEqual(["error", "error"]);
        expect(result[0]?.[2]).toContain("also proposed for");
    });

    it("skips no-change rows and rows to be confirmed unless included", () => {
        const noChange = change(simpleSet, "Mne6tyDrQZG", "[99]", { changeType: "NO_CHANGE" });
        const tbc = change(simpleSet, "optionAaaaa", "A1", { changeType: "RECODE_TBC" });

        expect(statuses([noChange, tbc]).map(r => r[1])).toEqual(["skipped", "skipped"]);
        expect(statuses([noChange, tbc], true).map(r => r[1])).toEqual(["skipped", "pending"]);
    });

    it("marks a change already applied, so that a re-run is a no-op", () => {
        const applied = change(simpleSet, "Mne6tyDrQZG", "[99]", { fromCode: "99" });

        expect(statuses([applied])).toEqual([["Mne6tyDrQZG", "already_applied", "code already updated"]]);
    });

    it("rejects unknown options, wrong sets, code mismatches, empty codes and repeated rows", () => {
        const result = statuses([
            change(simpleSet, "unknownOpt1", "X"),
            change(simpleSet, "LQpHXF8qwgC", "X", { fromCode: "13" }),
            change(simpleSet, "Mne6tyDrQZG", "99", { fromCode: "98" }),
            change(precipitatingEvent, "A7a4VRrgmTn", ""),
        ]);

        expect(result).toEqual([
            ["unknownOpt1", "error", "option not found"],
            ["LQpHXF8qwgC", "error", "option belongs to option set SlSZSqeim6h"],
            ["Mne6tyDrQZG", "error", "current code on the server is [99]"],
            ["A7a4VRrgmTn", "error", "empty proposed code"],
        ]);

        const repeated = statuses([
            change(simpleSet, "optionAaaaa", "X"),
            change(simpleSet, "optionAaaaa", "Y"),
        ]);
        expect(repeated.map(r => r[2])).toEqual([
            "option listed in more than one row",
            "option listed in more than one row",
        ]);
    });

    it("does not need temporary codes when no target code is held", () => {
        const { plans } = build([change(simpleSet, "Mne6tyDrQZG", "99")]);
        expect(plans[0] && needsTemporaryCodes(plans[0])).toBe(false);
    });
});

describe("recodeValue", () => {
    it("maps a value once and keeps unknown values", () => {
        const mapping = { "13": "1", "1": "2" };
        expect(["13", "1", "5"].map(value => recodeValue(value, mapping))).toEqual(["1", "2", "5"]);
        expect(recodeValue("toString", mapping)).toBe("toString");
    });
});
