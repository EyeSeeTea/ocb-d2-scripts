import { describe, expect, it } from "vitest";
import {
    expressionReferencesCode,
    objectReferencesCode,
    recodeFields,
    replaceCodeInExpression,
} from "data/optionCodeReferences";

const dataElement = "#{gqLxLWF3rFi.BFJO2Lwn64g}";

type ProgramIndicator = { id: string; name: string; expression: string; filter: string };

const programIndicatorFields = ["expression", "filter"] as const;

function createProgramIndicator(attrs: Partial<ProgramIndicator> = {}): ProgramIndicator {
    return {
        id: "Ptb5WPyuhqB",
        name: "ZZTEST PI meningitis",
        expression: "V{event_count}",
        filter: `${dataElement} == '[F-HI]'`,
        ...attrs,
    };
}

describe("replaceCodeInExpression", () => {
    it("replaces a code with square brackets", () => {
        const expression = replaceCodeInExpression(`${dataElement} == '[F-HI]'`, "[F-HI]", "F-HI");
        expect(expression).toBe(`${dataElement} == 'F-HI'`);
    });

    it("replaces a code with a hyphen", () => {
        const expression = replaceCodeInExpression(`${dataElement} == 'O-MEN'`, "O-MEN", "O_MEN");
        expect(expression).toBe(`${dataElement} == 'O_MEN'`);
    });

    it("replaces every occurrence, leaving the other codes untouched", () => {
        const filter = `${dataElement} == '[F-HI]' || ${dataElement} == '[23]' || ${dataElement} == '[F-HI]'`;

        expect(replaceCodeInExpression(filter, "[F-HI]", "F-HI")).toBe(
            `${dataElement} == 'F-HI' || ${dataElement} == '[23]' || ${dataElement} == 'F-HI'`
        );
    });

    it("replaces codes quoted with double quotes", () => {
        const expression = replaceCodeInExpression(`${dataElement} == "[23]"`, "[23]", "23");
        expect(expression).toBe(`${dataElement} == "23"`);
    });

    it("does not replace the code when it appears inside another token", () => {
        const filter = `${dataElement} == 'CHOLERA' || ${dataElement} == 'CH'`;

        expect(replaceCodeInExpression(filter, "CH", "COUGH")).toBe(
            `${dataElement} == 'CHOLERA' || ${dataElement} == 'COUGH'`
        );
    });

    it("does not replace the code when it is not quoted", () => {
        const expression = "d2:hasValue(CH)";
        expect(replaceCodeInExpression(expression, "CH", "COUGH")).toBe(expression);
    });

    it("does not replace the code across mixed quotes", () => {
        const expression = `${dataElement} == '[23]"`;
        expect(replaceCodeInExpression(expression, "[23]", "23")).toBe(expression);
    });

    it("returns the expression as it is when the code is empty", () => {
        const expression = `${dataElement} == '[23]'`;
        expect(replaceCodeInExpression(expression, "", "23")).toBe(expression);
    });
});

describe("expressionReferencesCode", () => {
    it("is true for a quoted code", () => {
        expect(expressionReferencesCode(`${dataElement} == '[F-HI]'`, "[F-HI]")).toBe(true);
    });

    it("is false when the code only appears inside another token", () => {
        expect(expressionReferencesCode(`${dataElement} == 'CHOLERA'`, "CH")).toBe(false);
    });

    it("is false for an empty code", () => {
        expect(expressionReferencesCode(`${dataElement} == ''`, "")).toBe(false);
    });
});

describe("recodeFields", () => {
    it("recodes only the given fields and keeps the rest of the object", () => {
        const programIndicator = createProgramIndicator({ expression: "V{event_count} + 1" });

        expect(recodeFields(programIndicator, programIndicatorFields, "[F-HI]", "F-HI")).toEqual({
            id: "Ptb5WPyuhqB",
            name: "ZZTEST PI meningitis",
            expression: "V{event_count} + 1",
            filter: `${dataElement} == 'F-HI'`,
        });
    });

    it("returns the same object reference when no field changes", () => {
        const programIndicator = createProgramIndicator();

        expect(recodeFields(programIndicator, programIndicatorFields, "[23]", "23")).toBe(
            programIndicator
        );
    });

    it("ignores fields that are not present in the object", () => {
        type ProgramRuleAction = { id: string; data?: string; content: string };
        const programRuleAction: ProgramRuleAction = {
            id: "EeAK4zSJ4WT",
            content: "Outbreak code 'O-MEN' detected",
        };

        expect(recodeFields(programRuleAction, ["data", "content"], "O-MEN", "O_MEN")).toEqual({
            id: "EeAK4zSJ4WT",
            content: "Outbreak code 'O_MEN' detected",
        });
    });
});

describe("objectReferencesCode", () => {
    it("is true when any of the fields references the code", () => {
        const programIndicator = createProgramIndicator();
        expect(objectReferencesCode(programIndicator, programIndicatorFields, "[F-HI]")).toBe(true);
    });

    it("is false when no field references the code", () => {
        const programIndicator = createProgramIndicator();
        expect(objectReferencesCode(programIndicator, programIndicatorFields, "SEVERE")).toBe(false);
    });
});
