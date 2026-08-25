import { describe, expect, it } from "vitest";
import { Async } from "domain/entities/Async";
import { Option } from "domain/entities/Option";
import { OptionSet } from "domain/entities/OptionSet";
import { OptionRepository } from "domain/repositories/OptionRepository";
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

class OptionTestRepository implements OptionRepository {
    saved: Option[] = [];

    async getById(): Async<Option> {
        throw new Error("Not used");
    }

    async save(option: Option): Async<void> {
        this.saved.push(option);
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
    const optionRepository = new OptionTestRepository();

    const result = await new ValidateOptionSetsUseCase(optionSetRepository, optionRepository).execute({
        update: true,
        mode: "square_brackets",
        services: [],
        projects: [],
        exceptions: [],
    });

    return { result, savedOptions: optionRepository.saved };
}

describe("ValidateOptionSetsUseCase in square brackets mode", () => {
    it("saves the option of an option set without category, which is skipped in the other mode", async () => {
        const optionSet = createOptionSet("Diagnosis list", [
            { id: "option-0", name: "[O-MEN] Outbreak case - meningitis", code: "TOP" },
        ]);

        const { savedOptions } = await executeSquareBrackets([optionSet]);

        expect(savedOptions).toEqual([
            { id: "option-0", name: "[O-MEN] Outbreak case - meningitis", code: "O-MEN", sortOrder: 0 },
        ]);
    });

    it("leaves the unknown report empty, because the category does not apply", async () => {
        const optionSet = createOptionSet("Diagnosis list", [{ name: "[A] Option", code: "X" }]);

        const { result } = await executeSquareBrackets([optionSet]);

        expect(result.unknown).toEqual([]);
    });

    it("does not save an option whose name has no square brackets", async () => {
        const optionSet = createOptionSet("Diagnosis list", [{ name: "Outbreak case", code: "TOP" }]);

        const { savedOptions } = await executeSquareBrackets([optionSet]);

        expect(savedOptions).toEqual([]);
    });

    it("does not save any of the options that would end up with the same code", async () => {
        const optionSet = createOptionSet("Diagnosis list", [
            { id: "option-0", name: "[HH] Uno", code: "X" },
            { id: "option-1", name: "[HH] Dos", code: "Y" },
        ]);

        const { savedOptions } = await executeSquareBrackets([optionSet]);

        expect(savedOptions).toEqual([]);
    });

    it("does not save the option set itself", async () => {
        const optionSetRepository = new OptionSetTestRepository([
            createOptionSet("[XX] Diagnosis list", [{ name: "[A] Option", code: "X" }]),
        ]);

        await new ValidateOptionSetsUseCase(optionSetRepository, new OptionTestRepository()).execute({
            update: true,
            mode: "square_brackets",
            services: [],
            projects: [],
            exceptions: [],
        });

        expect(optionSetRepository.saved).toEqual([]);
    });
});
