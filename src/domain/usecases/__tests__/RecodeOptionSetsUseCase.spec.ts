import { describe, expect, it } from "vitest";
import { Async } from "domain/entities/Async";
import { OptionCodeChange, OptionSetRecodePlan } from "domain/entities/OptionCodeMapping";
import { OptionSet } from "domain/entities/OptionSet";
import { OptionSetRepository } from "domain/repositories/OptionSetRepository";
import { OptionSetRecodeRepository, RecodeSummary } from "domain/repositories/OptionSetRecodeRepository";
import { RecodeOptionSetsUseCase } from "../RecodeOptionSetsUseCase";

const optionSets = ["setA", "setB"].map(id =>
    OptionSet.create({
        id,
        name: `Set ${id}`,
        code: undefined,
        category: "UNKNOWN",
        options: [{ id: `${id}-option`, name: "[X] Option", code: "[X]", sortOrder: 1 }],
    })
);

class OptionSetTestRepository implements OptionSetRepository {
    async getAll(): Async<OptionSet[]> {
        return optionSets;
    }
    async save(): Async<void> {}
}

class RecodeTestRepository implements OptionSetRecodeRepository {
    calls: Array<{ plan: OptionSetRecodePlan; dryRun: boolean }> = [];
    constructor(private failingSetId?: string) {}

    async recode(plan: OptionSetRecodePlan, options: { dryRun: boolean }): Async<RecodeSummary> {
        this.calls.push({ plan, dryRun: options.dryRun });
        if (plan.optionSet.id === this.failingSetId) throw new Error("E1029 org unit");
        return {
            optionSetId: plan.optionSet.id,
            optionSetName: plan.optionSet.name,
            counts: {} as never,
            review: [],
        };
    }
}

const changes: OptionCodeChange[] = ["setA", "setB"].map((id, index) => ({
    row: index + 2,
    optionSetId: id,
    optionId: `${id}-option`,
    fromCode: "[X]",
    toCode: "X",
    changeType: "BRACKETS_ONLY",
}));

async function execute(update: boolean, failingSetId?: string) {
    const recodeRepository = new RecodeTestRepository(failingSetId);
    const useCase = new RecodeOptionSetsUseCase(new OptionSetTestRepository(), recodeRepository);
    const result = await useCase.execute({ changes, includeToBeConfirmed: false, update });
    return { ...result, calls: recodeRepository.calls };
}

describe("RecodeOptionSetsUseCase", () => {
    it("keeps the rows pending in a dry run, and recodes each set with dryRun", async () => {
        const { results, calls } = await execute(false);

        expect(results.map(result => result.status)).toEqual(["pending", "pending"]);
        expect(calls.map(call => [call.plan.optionSet.id, call.dryRun])).toEqual([
            ["setA", true],
            ["setB", true],
        ]);
    });

    it("marks the rows applied on update", async () => {
        const { results, summaries } = await execute(true);

        expect(results.map(result => result.status)).toEqual(["applied", "applied"]);
        expect(summaries.map(summary => summary.optionSetId)).toEqual(["setA", "setB"]);
    });

    it("marks the rows of a failed set as error and goes on with the next set", async () => {
        const { results, summaries } = await execute(true, "setA");

        expect(results.map(result => [result.status, result.reason])).toEqual([
            ["error", "option set not recoded: E1029 org unit"],
            ["applied", ""],
        ]);
        expect(summaries.map(summary => summary.optionSetId)).toEqual(["setB"]);
    });
});
