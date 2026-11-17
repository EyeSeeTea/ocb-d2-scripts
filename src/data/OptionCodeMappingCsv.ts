import fs from "fs/promises";
import _ from "lodash";
import { createArrayCsvStringifier } from "csv-writer";
import { ChangeResult, changeTypes, isChangeType, OptionCodeChange } from "domain/entities/OptionCodeMapping";
import { RecodeSummary } from "domain/repositories/OptionSetRecodeRepository";

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
    optionSetName: "option_set_name",
    optionName: "option_name",
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

    const lines = rows
        .map((row, rowIndex) => ({ row, line: rowIndex + 2 }))
        .filter(({ row }) => row.some(value => value.trim() !== ""));

    // An unknown change type has no defined meaning (it could be another kind of "to be confirmed"),
    // so the whole file is rejected before any change rather than applying it as a plain recode.
    const unknown = lines.filter(({ row }) => {
        const value = cell(row, "changeType");
        return value !== "" && !isChangeType(value);
    });
    if (unknown.length > 0) {
        const details = unknown.map(({ row, line }) => `${cell(row, "changeType")} (row ${line})`);
        const known = changeTypes.join(", ");
        throw new Error(`Mapping CSV: unknown change_type ${details.join(", ")}. Known: ${known}`);
    }

    return lines.map(({ row, line }) => {
        const changeType = cell(row, "changeType");
        return {
            row: line,
            optionSetId: cell(row, "optionSetId"),
            optionId: cell(row, "optionId"),
            fromCode: cell(row, "fromCode"),
            toCode: cell(row, "toCode"),
            changeType: isChangeType(changeType) ? changeType : undefined,
            optionSetName: cell(row, "optionSetName") || undefined,
            optionName: cell(row, "optionName") || undefined,
        };
    });
}

/** Write changes in the mapping format, so they can be reviewed and passed to `options recode`. */
export async function writeOptionCodeChanges(path: string, changes: OptionCodeChange[]): Promise<void> {
    const stringifier = createArrayCsvStringifier({
        header: [
            MAPPING_COLUMNS.optionSetName,
            MAPPING_COLUMNS.optionSetId,
            MAPPING_COLUMNS.optionId,
            MAPPING_COLUMNS.optionName,
            MAPPING_COLUMNS.fromCode,
            MAPPING_COLUMNS.toCode,
            MAPPING_COLUMNS.changeType,
        ],
    });
    const records = changes.map(change => [
        change.optionSetName ?? "",
        change.optionSetId,
        change.optionId,
        change.optionName ?? "",
        change.fromCode,
        change.toCode,
        change.changeType ?? "",
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
        change.row ?? "",
        optionSetName,
        change.optionSetId,
        change.optionId,
        optionName.trim(),
        change.fromCode,
        change.toCode,
        change.changeType ?? "",
        status,
        reason,
    ]);

    const summaryStringifier = createArrayCsvStringifier({
        header: ["option_set", "option_set_id", "counts", "review_items", "backup"],
    });
    const summaryRecords = summaries.map(summary => [
        summary.optionSetName,
        summary.optionSetId,
        JSON.stringify(summary.counts),
        summary.review.length,
        summary.backupPath ?? "",
    ]);

    const reviewStringifier = createArrayCsvStringifier({
        header: ["option_set", "option_set_id", "model", "id", "name", "field", "detail"],
    });
    const reviewRecords = summaries.flatMap(summary =>
        summary.review.map(item => [
            summary.optionSetName,
            summary.optionSetId,
            item.model,
            item.id,
            item.name,
            item.field,
            item.detail,
        ])
    );

    await fs.writeFile(path, stringifier.getHeaderString() + stringifier.stringifyRecords(records), "utf-8");
    await fs.writeFile(
        getSiblingPath(path, "summary"),
        summaryStringifier.getHeaderString() + summaryStringifier.stringifyRecords(summaryRecords),
        "utf-8"
    );
    await fs.writeFile(
        getSiblingPath(path, "review"),
        reviewStringifier.getHeaderString() + reviewStringifier.stringifyRecords(reviewRecords),
        "utf-8"
    );
}

/** `report.csv` -> `report-<suffix>.csv` */
function getSiblingPath(path: string, suffix: string): string {
    return path.replace(/(\.csv)?$/, `-${suffix}.csv`);
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
