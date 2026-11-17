import { describe, expect, it } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
    parseCsv,
    parseOptionCodeChanges,
    readOptionCodeChanges,
    writeOptionCodeChanges,
} from "data/OptionCodeMappingCsv";
import { OptionCodeChange } from "domain/entities/OptionCodeMapping";

// Shape of the client file: unquoted lists at the end spill over into extra cells.
const clientCsv = [
    "option_set_name,option_set_id,option_id,option_name,sort_order,current_code,proposed_code,change_type,retired,issue,data_elements,programs,,",
    "Birthweight category,DNxOZ6LGXnM,Mne6tyDrQZG,[99] Unknown,8,[99],99,BRACKETS_ONLY,no,,DE_1, DE_2,Prog A, Prog B",
    'MH,DwvSaMSA4Ey,abcdefghijk,"[1.10] A, b",10,110,1.10,RECODE_TBC,no,"DECIMAL: code 1.10 or 110",DE_3,P',
    "",
].join("\r\n");

describe("parseOptionCodeChanges", () => {
    it("reads the columns by header name, ignoring extra cells, and keeps codes as text", () => {
        expect(parseOptionCodeChanges(clientCsv)).toEqual([
            {
                row: 2,
                optionSetId: "DNxOZ6LGXnM",
                optionId: "Mne6tyDrQZG",
                fromCode: "[99]",
                toCode: "99",
                changeType: "BRACKETS_ONLY",
                optionSetName: "Birthweight category",
                optionName: "[99] Unknown",
            },
            {
                row: 3,
                optionSetId: "DwvSaMSA4Ey",
                optionId: "abcdefghijk",
                fromCode: "110",
                toCode: "1.10",
                changeType: "RECODE_TBC",
                optionSetName: "MH",
                optionName: "[1.10] A, b",
            },
        ]);
    });

    it("reads back the changes it writes", async () => {
        const changes: OptionCodeChange[] = [
            {
                optionSetId: "set",
                optionId: "opt",
                fromCode: "110",
                toCode: "1.10",
                changeType: "PROPOSED",
                optionSetName: "MH, details",
                optionName: '[1.10] "A"',
            },
        ];
        const path = join(mkdtempSync(join(tmpdir(), "mapping-")), "mapping.csv");

        await writeOptionCodeChanges(path, changes);

        expect(await readOptionCodeChanges(path)).toEqual([{ ...changes[0], row: 2 }]);
    });

    it("works without the change_type column", () => {
        const csv = "option_id,option_set_id,current_code,proposed_code\nopt,set,A,B\n";
        expect(parseOptionCodeChanges(csv)).toEqual([
            { row: 2, optionSetId: "set", optionId: "opt", fromCode: "A", toCode: "B" },
        ]);
    });

    it("fails before any change when a change_type is unknown, listing its rows", () => {
        const csv =
            "option_id,option_set_id,current_code,proposed_code,change_type\no1,s,A,B,RECODE\no2,s,C,D,MAYBE\n";
        expect(() => parseOptionCodeChanges(csv)).toThrow("unknown change_type MAYBE (row 3)");
    });

    it("fails when a required column is missing", () => {
        expect(() => parseOptionCodeChanges("option_id,current_code\n")).toThrow(
            "missing columns option_set_id, proposed_code"
        );
    });
});

describe("parseCsv", () => {
    it("handles quotes, doubled quotes and new lines in quoted cells", () => {
        expect(parseCsv('a,"b, ""c""\nd",e\nf')).toEqual([["a", 'b, "c"\nd', "e"], ["f"]]);
    });
});
