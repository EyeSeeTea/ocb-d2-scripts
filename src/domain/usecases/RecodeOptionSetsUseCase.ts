import { Async } from "domain/entities/Async";
import {
    buildRecodePlans,
    ChangeResult,
    OptionCodeChange,
    OptionSetRecodePlan,
} from "domain/entities/OptionCodeMapping";
import { OptionSetRepository } from "domain/repositories/OptionSetRepository";
import { OptionSetRecodeRepository, RecodeSummary } from "domain/repositories/OptionSetRecodeRepository";
import logger from "utils/log";

/**
 * Apply a mapping of option codes: validate every row against the server, then recode each option
 * set as a whole. An option set that fails is rolled back and the next one is processed.
 */
export class RecodeOptionSetsUseCase {
    constructor(
        private readonly optionSetRepository: OptionSetRepository,
        private readonly recodeRepository: OptionSetRecodeRepository
    ) {}

    async execute(options: RecodeOptions): Async<RecodeResult> {
        logger.info("Fetching all option sets...");
        const optionSets = await this.optionSetRepository.getAll();
        const { plans, results } = buildRecodePlans(options.changes, optionSets, {
            includeToBeConfirmed: options.includeToBeConfirmed,
        });

        logger.info(`Rows: ${results.length}, option sets to recode: ${plans.length}`);

        const summaries: RecodeSummary[] = [];
        const failures: Record<string, string> = {};

        for (const plan of plans) {
            const summary = await this.recodePlan(plan, options);
            if (typeof summary === "string") failures[plan.optionSet.id] = summary || "unknown error";
            else summaries.push(summary);
        }

        const finalResults = results.map((result): ChangeResult => {
            if (result.status !== "pending") return result;
            const failure = failures[result.change.optionSetId];
            if (failure) return { ...result, status: "error", reason: `option set not recoded: ${failure}` };
            return options.update ? { ...result, status: "applied" } : result;
        });

        return { results: finalResults, summaries };
    }

    private async recodePlan(
        plan: OptionSetRecodePlan,
        options: RecodeOptions
    ): Async<RecodeSummary | string> {
        const { optionSet } = plan;
        logger.info(`Recode option set ${optionSet.name} [${optionSet.id}]: ${plan.changes.length} changes`);

        try {
            return await this.recodeRepository.recode(plan, { dryRun: !options.update });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.error(`Option set ${optionSet.name} [${optionSet.id}] not recoded: ${message}`);
            return message;
        }
    }
}

type RecodeOptions = {
    changes: OptionCodeChange[];
    includeToBeConfirmed: boolean;
    update: boolean;
};

export type RecodeResult = {
    results: ChangeResult[];
    summaries: RecodeSummary[];
};
