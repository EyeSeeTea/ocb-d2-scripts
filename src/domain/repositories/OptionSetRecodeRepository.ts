import { Async } from "domain/entities/Async";
import { OptionSetRecodePlan } from "domain/entities/OptionCodeMapping";

export type RecodeCounts = {
    options: number;
    dataValues: number;
    events: number;
    programIndicators: number;
    programRules: number;
    programRuleActions: number;
    eventVisualizations: number;
    mapViews: number;
    eventFilters: number;
};

export type RecodeSummary = {
    optionSetId: string;
    optionSetName: string;
    counts: RecodeCounts;
    /** References to a code that are not recoded automatically and must be checked by hand. */
    review: string[];
    /** Backup file with the initial state, written before any change (not in dry run). */
    backupPath?: string;
};

export interface OptionSetRecodeRepository {
    /** Recode the option set and every reference to its codes. Rolls back and throws on error. */
    recode(plan: OptionSetRecodePlan, options: { dryRun: boolean }): Async<RecodeSummary>;
}
