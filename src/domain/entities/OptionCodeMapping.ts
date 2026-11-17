import _ from "lodash";
import { Id } from "./Base";

/**
 * A mapping of option codes, as given by the client (one row per option), and the plan that
 * applies it to each option set.
 *
 * An option set is recoded as a whole: every value is mapped once from its original code, so the
 * result does not depend on the order of the rows. This allows chains (`13 -> 1` while `1 -> 2`)
 * and swaps, as long as the final codes of the set are unique.
 */

export type OptionCodeChange = {
    /** Line in the source file, 1 being the header. */
    row: number;
    optionSetId: Id;
    optionId: Id;
    fromCode: string;
    toCode: string;
    changeType: string;
};

export type MappingOption = { id: Id; name: string; code: string };
export type MappingOptionSet = { id: Id; name: string; options: MappingOption[] };

/** fromCode -> toCode, for the options of a single option set. */
export type CodeMapping = Record<string, string>;

export type OptionSetRecodePlan = {
    optionSet: MappingOptionSet;
    changes: OptionCodeChange[];
    mapping: CodeMapping;
};

export type ChangeStatus = "pending" | "applied" | "already_applied" | "skipped" | "error";

export type ChangeResult = {
    change: OptionCodeChange;
    status: ChangeStatus;
    reason: string;
    optionSetName: string;
    optionName: string;
};

export const CHANGE_TYPE_NO_CHANGE = "NO_CHANGE";
export const CHANGE_TYPE_TO_BE_CONFIRMED = "RECODE_TBC";

export function buildRecodePlans(
    changes: OptionCodeChange[],
    optionSets: MappingOptionSet[],
    options: { includeToBeConfirmed: boolean }
): { plans: OptionSetRecodePlan[]; results: ChangeResult[] } {
    const optionSetsById = _.keyBy(optionSets, optionSet => optionSet.id);
    const optionsById = _(optionSets)
        .flatMap(optionSet => optionSet.options.map(option => ({ option, optionSet })))
        .keyBy(({ option }) => option.id)
        .value();
    const rowsByOption = _.groupBy(changes, change => change.optionId);

    const initialResults = changes.map((change): ChangeResult => {
        const found = optionsById[change.optionId];
        const result = (status: ChangeStatus, reason = ""): ChangeResult => ({
            change,
            status,
            reason,
            optionSetName: optionSetsById[change.optionSetId]?.name ?? found?.optionSet.name ?? "",
            optionName: found?.option.name ?? "",
        });

        if (change.changeType === CHANGE_TYPE_NO_CHANGE || change.fromCode === change.toCode)
            return result("skipped", "no change");
        if (change.changeType === CHANGE_TYPE_TO_BE_CONFIRMED && !options.includeToBeConfirmed)
            return result("skipped", "to be confirmed (use --include-to-be-confirmed)");
        if (!change.toCode) return result("error", "empty proposed code");
        if ((rowsByOption[change.optionId]?.length ?? 0) > 1)
            return result("error", "option listed in more than one row");
        if (!found) return result("error", "option not found");
        if (found.optionSet.id !== change.optionSetId)
            return result("error", `option belongs to option set ${found.optionSet.id}`);
        if (found.option.code === change.toCode) return result("already_applied", "code already updated");
        if (found.option.code !== change.fromCode)
            return result("error", `current code on the server is ${found.option.code}`);

        return result("pending");
    });

    const results = rejectCollisions(initialResults, optionSetsById);

    const plans = _(results)
        .filter(result => result.status === "pending")
        .groupBy(result => result.change.optionSetId)
        .map((setResults, optionSetId): OptionSetRecodePlan | undefined => {
            const optionSet = optionSetsById[optionSetId];
            if (!optionSet) return undefined;
            const setChanges = setResults.map(result => result.change);

            return {
                optionSet,
                changes: setChanges,
                mapping: _.fromPairs(setChanges.map(change => [change.fromCode, change.toCode])),
            };
        })
        .compact()
        .value();

    return { plans, results };
}

/**
 * The final codes of a set must be unique, counting the options that are not in the mapping or whose
 * change is not applied. Rejecting a change keeps its option with the current code, which may in turn
 * block another change (`13 -> 1` while `1 -> 2` is rejected), hence the loop until nothing changes.
 */
function rejectCollisions(
    results: ChangeResult[],
    optionSetsById: Record<Id, MappingOptionSet>
): ChangeResult[] {
    const rejected = results.map(result => {
        if (result.status !== "pending") return result;

        const optionSet = optionSetsById[result.change.optionSetId];
        if (!optionSet) return result;

        const finalCodes = getFinalCodes(optionSet, results);
        const holders = optionSet.options.filter(
            option => option.id !== result.change.optionId && finalCodes[option.id] === result.change.toCode
        );
        const holder = holders[0];
        if (!holder) return result;

        const holderChange = results.find(r => r.change.optionId === holder.id && r.status === "pending");
        const why = holderChange ? "also proposed for" : "held by";
        return {
            ...result,
            status: "error" as const,
            reason: `code ${result.change.toCode} ${why} option "${holder.name.trim()}" (${holder.code})`,
        };
    });

    const changed = rejected.some((result, index) => result.status !== results[index]?.status);
    return changed ? rejectCollisions(rejected, optionSetsById) : rejected;
}

function getFinalCodes(optionSet: MappingOptionSet, results: ChangeResult[]): Record<Id, string> {
    const pendingByOption = _(results)
        .filter(result => result.status === "pending" && result.change.optionSetId === optionSet.id)
        .keyBy(result => result.change.optionId)
        .value();

    return _(optionSet.options)
        .map(option => [option.id, pendingByOption[option.id]?.change.toCode ?? option.code] as const)
        .fromPairs()
        .value();
}

/**
 * A change whose target code is still held by another option of the set (which, once the plan is
 * valid, is an option that changes too). DHIS2 rejects two options with the same code in a set
 * (E4028), so the options go through temporary codes first.
 */
export function needsTemporaryCodes(plan: OptionSetRecodePlan): boolean {
    const currentCodes = new Set(plan.optionSet.options.map(option => option.code));
    return plan.changes.some(change => currentCodes.has(change.toCode));
}

export function recodeValue(value: string, mapping: CodeMapping): string {
    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] ?? value : value;
}
