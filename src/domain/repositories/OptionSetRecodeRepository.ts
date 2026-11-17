import { Async } from "domain/entities/Async";
import { Id } from "domain/entities/Base";
import { OptionSetRecodePlan } from "domain/entities/OptionCodeMapping";

export type RecodeCounts = {
    options: number;
    dataValues: number;
    events: number;
    programIndicators: number;
    programRules: number;
    programRuleActions: number;
    indicators: number;
    validationRules: number;
    predictors: number;
    eventVisualizations: number;
    mapViews: number;
    eventFilters: number;
};

/** A reference to a code that is not recoded automatically and must be checked by hand. */
export type ReviewItem = {
    model:
        | "programIndicator"
        | "programRule"
        | "programRuleAction"
        | "indicator"
        | "validationRule"
        | "predictor"
        | "sqlView"
        | "dataEntryForm"
        | "eventFilter"
        | "mapView"
        | "trackedEntityAttribute";
    id: Id;
    /** Empty for the objects without a name (programRuleActions, mapViews). */
    name: string;
    field: string;
    /** What to check: the codes found, the filter, or what must be done by hand. */
    detail: string;
};

export type RecodeSummary = {
    optionSetId: Id;
    optionSetName: string;
    counts: RecodeCounts;
    review: ReviewItem[];
    /** Backup file with the initial state, written before any change (not in dry run). */
    backupPath?: string;
};

/**
 * Renaming the codes of an option set is a single operation in the domain. It cascades only because
 * DHIS2 stores option codes as values (data values, events, expressions, filters), not as references
 * to the option. That propagation is a storage concern, so it lives behind this interface.
 */
export interface OptionSetRecodeRepository {
    /** Recode the option set and every reference to its codes. Rolls back and throws on error. */
    recode(plan: OptionSetRecodePlan, options: { dryRun: boolean }): Async<RecodeSummary>;
}
