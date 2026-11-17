import { describe, expect, it } from "vitest";
import { Async } from "domain/entities/Async";
import { Option } from "domain/entities/Option";
import { OptionSet } from "domain/entities/OptionSet";
import { OptionSetRepository } from "domain/repositories/OptionSetRepository";
import { ValidateOptionSetsUseCase } from "../ValidateOptionSetsUseCase";

class OptionSetTestRepository implements OptionSetRepository {
    saved: OptionSet[] = [];

    constructor(private optionSets: OptionSet[]) {}

    async getAll(): Async<OptionSet[]> {
        return this.optionSets;
    }

    async save(optionSets: OptionSet[]): Async<void> {
        this.saved = optionSets;
    }
}

function createOptionSet(name: string, options: Partial<Option>[]): OptionSet {
    return OptionSet.create({
        id: `optionSet-${name}`,
        name: name,
        code: "A_CODE",
        category: "UNKNOWN",
        options: options.map((option, index) => ({
            id: `option-${index}`,
            name: "An option",
            code: "A_CODE",
            sortOrder: index,
            ...option,
        })),
    });
}

async function executeSquareBrackets(optionSets: OptionSet[]) {
    const optionSetRepository = new OptionSetTestRepository(optionSets);
    const result = await new ValidateOptionSetsUseCase(optionSetRepository).execute({
        update: true,
        mode: "square_brackets",
        services: [],
        projects: [],
        exceptions: [],
    });

    const proposed = result.proposedChanges.map(({ optionId, fromCode, toCode }) => ({
        optionId,
        fromCode,
        toCode,
    }));
    return { result, proposed };
}

describe("ValidateOptionSetsUseCase in square brackets mode", () => {
    it("proposes the option of an option set without category, which is skipped in the other mode", async () => {
        const optionSet = createOptionSet("Diagnosis list", [
            { id: "option-0", name: "[O-MEN] Outbreak case - meningitis", code: "TOP" },
        ]);

        const { result } = await executeSquareBrackets([optionSet]);

        expect(result.proposedChanges).toEqual([
            {
                optionSetId: optionSet.id,
                optionId: "option-0",
                fromCode: "TOP",
                toCode: "O-MEN",
                changeType: "PROPOSED",
                optionSetName: "Diagnosis list",
                optionName: "[O-MEN] Outbreak case - meningitis",
            },
        ]);
    });

    it("leaves the unknown report empty, because the category does not apply", async () => {
        const optionSet = createOptionSet("Diagnosis list", [{ name: "[A] Option", code: "X" }]);

        const { result } = await executeSquareBrackets([optionSet]);

        expect(result.unknown).toEqual([]);
    });

    it("does not propose an option whose name has no square brackets", async () => {
        const optionSet = createOptionSet("Diagnosis list", [{ name: "Outbreak case", code: "TOP" }]);

        const { proposed } = await executeSquareBrackets([optionSet]);

        expect(proposed).toEqual([]);
    });

    it("does not propose any of the options that would end up with the same code", async () => {
        const optionSet = createOptionSet("Diagnosis list", [
            { id: "option-0", name: "[HH] Uno", code: "X" },
            { id: "option-1", name: "[HH] Dos", code: "Y" },
        ]);

        const { proposed } = await executeSquareBrackets([optionSet]);

        expect(proposed).toEqual([]);
    });

    it("does not save the option set itself", async () => {
        const optionSetRepository = new OptionSetTestRepository([
            createOptionSet("[XX] Diagnosis list", [{ name: "[A] Option", code: "X" }]),
        ]);

        await new ValidateOptionSetsUseCase(optionSetRepository).execute({
            update: true,
            mode: "square_brackets",
            services: [],
            projects: [],
            exceptions: [],
        });

        expect(optionSetRepository.saved).toEqual([]);
    });
});
