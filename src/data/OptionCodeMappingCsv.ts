import fs from "fs/promises";
import _ from "lodash";
import { createArrayCsvStringifier } from "csv-writer";
import { ChangeResult, OptionCodeChange } from "domain/entities/OptionCodeMapping";
import { RecodeSummary } from "domain/repositories/OptionSetRecodeRepository";
import { ProposedOptionChange } from "domain/usecases/ValidateOptionSetsUseCase";

/**
 * Read and write the client mapping CSV (`option-code-changes.csv`).
 *
 * Columns are located by header name, so any extra column is ignored. Rows may hold more cells than
 * the header (lists not quoted in the client file), which is fine as long as the required columns
 * come first. Values are kept as text: a code such as `1.10` must not become a number.
 */

export const MAPPING_COLUMNS = {
    optionSetId: "option_set_id",
    optionId: "option_id",
    fromCode: "current_code",
    toCode: "proposed_code",
    changeType: "change_type",
} as const;

const REQUIRED_COLUMNS = ["optionSetId", "optionId", "fromCode", "toCode"] as const;

export async function readOptionCodeChanges(path: string): Promise<OptionCodeChange[]> {
    const content = await fs.readFile(path, "utf-8");
    return parseOptionCodeChanges(content);
}

export function parseOptionCodeChanges(content: string): OptionCodeChange[] {
    const [header = [], ...rows] = parseCsv(content);
    const index = _.mapValues(MAPPING_COLUMNS, column => header.findIndex(cell => cell.trim() === column));

    const missing = REQUIRED_COLUMNS.filter(key => index[key] < 0).map(key => MAPPING_COLUMNS[key]);
    if (missing.length > 0) throw new Error(`Mapping CSV: missing columns ${missing.join(", ")}`);

    const cell = (row: string[], key: keyof typeof MAPPING_COLUMNS) =>
        (index[key] >= 0 ? row[index[key]] ?? "" : "").trim();

    return rows
        .map((row, rowIndex) => ({ row, line: rowIndex + 2 }))
        .filter(({ row }) => row.some(value => value.trim() !== ""))
        .map(({ row, line }) => ({
            row: line,
            optionSetId: cell(row, "optionSetId"),
            optionId: cell(row, "optionId"),
            fromCode: cell(row, "fromCode"),
            toCode: cell(row, "toCode"),
            changeType: cell(row, "changeType"),
        }));
}

/** Write proposed changes in the mapping format, so they can be reviewed and passed to `options recode`. */
export async function writeProposedMapping(path: string, changes: ProposedOptionChange[]): Promise<void> {
    const stringifier = createArrayCsvStringifier({
        header: [
            "option_set_name",
            MAPPING_COLUMNS.optionSetId,
            MAPPING_COLUMNS.optionId,
            "option_name",
            MAPPING_COLUMNS.fromCode,
            MAPPING_COLUMNS.toCode,
            MAPPING_COLUMNS.changeType,
        ],
    });
    const records = changes.map(({ optionSet, option, toCode }) => [
        optionSet.name,
        optionSet.id,
        option.id,
        option.name,
        option.code,
        toCode,
        "PROPOSED",
    ]);
    await fs.writeFile(path, stringifier.getHeaderString() + stringifier.stringifyRecords(records), "utf-8");
}

export async function writeRecodeReport(
    path: string,
    results: ChangeResult[],
    summaries: RecodeSummary[]
): Promise<void> {
    const stringifier = createArrayCsvStringifier({
        header: [
            "row",
            "option_set",
            "option_set_id",
            "option_id",
            "option_name",
            "current_code",
            "proposed_code",
            "change_type",
            "status",
            "reason",
        ],
    });
    const records = results.map(({ change, status, reason, optionSetName, optionName }) => [
        change.row,
        optionSetName,
        change.optionSetId,
        change.optionId,
        optionName.trim(),
        change.fromCode,
        change.toCode,
        change.changeType,
        status,
        reason,
    ]);

    const summaryStringifier = createArrayCsvStringifier({
        header: ["option_set", "option_set_id", "counts", "review", "backup"],
    });
    const summaryRecords = summaries.map(summary => [
        summary.optionSetName,
        summary.optionSetId,
        JSON.stringify(summary.counts),
        summary.review.join(" | "),
        summary.backupPath ?? "",
    ]);

    await fs.writeFile(path, stringifier.getHeaderString() + stringifier.stringifyRecords(records), "utf-8");
    await fs.writeFile(
        path.replace(/(\.csv)?$/, "-summary.csv"),
        summaryStringifier.getHeaderString() + summaryStringifier.stringifyRecords(summaryRecords),
        "utf-8"
    );
}

/** Minimal RFC 4180 parser: quoted cells may hold commas, quotes (doubled) and new lines. */
export function parseCsv(content: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let inQuotes = false;
    const text = content.replace(/^\uFEFF/, "");

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inQuotes) {
            if (char === '"' && text[i + 1] === '"') {
                cell += '"';
                i++;
            } else if (char === '"') {
                inQuotes = false;
            } else {
                cell += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ",") {
            row.push(cell);
            cell = "";
        } else if (char === "\n" || char === "\r") {
            if (char === "\r" && text[i + 1] === "\n") i++;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
        } else {
            cell += char;
        }
    }

    if (cell !== "" || row.length > 0) rows.push([...row, cell]);
    return rows;
}
