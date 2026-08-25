import { describe, test, expect } from "vitest";

import { OptionSetValidator, SettingsValidation } from "../OptionSetValidator";
import { Project, Service } from "../Service";
import { Option } from "../Option";
import { createOptionSet } from "./OptionSet.spec";

const projects: Project[] = [
    { name: "Demo", code: "Demo" },
    { name: "Couffo", code: "Couffo" },
    { name: "Afar", code: "YE1-05" },
    { name: "DAP", code: "DAP" },
];
const services: Service[] = [
    { code: "MAT", name: "MAT" },
    { code: "ATFC", name: "ATFC" },
    { code: "ED", name: "ED" },
];

const validateOptions: SettingsValidation = { projects, services, exceptions: [], mode: "categories" };
const squareBracketsOptions: SettingsValidation = { ...validateOptions, mode: "square_brackets" };

describe("OptionSetValidator", () => {
    test("should not have errors if optionSet SERVICE STANDARD convention is valid", () => {
        const optionSet = createOptionSet({
            name: "MAT- Newborn presentation",
            code: "MAT_NEWBORN_PRESENTATION",
            category: "SERVICE",
            options: [
                {
                    id: "1",
                    name: "Inside this structure (MAT)",
                    code: "INSIDE_THIS_STRUCTURE_MAT",
                    sortOrder: 1,
                },
                { id: "2", name: "MSF ambulance (MAT)", code: "MSF_AMBULANCE_MAT", sortOrder: 2 },
            ],
        });
        const validator = OptionSetValidator.build(optionSet, validateOptions);
        expect(validator.errors).toHaveLength(0);
    });

    test("should not have errors if optionSet SERVICE PATIENT MOVEMENT convention is valid", () => {
        const optionSet = createOptionSet({
            name: "MAT- Referral out destinations",
            code: "MAT_REFERRAL_OUT_DESTINATIONS",
            category: "SERVICE",
            options: [
                {
                    id: "1",
                    name: "Demo: Destination (OUT - MAT)",
                    code: "DEMO_DESTINATION_OUT_MAT",
                    sortOrder: 1,
                },
                {
                    id: "2",
                    name: "Couffo: CHD de Lokossa (IN - MAT)",
                    code: "COUFFO_CHD_DE_LOKOSSA_IN_MAT",
                    sortOrder: 2,
                },
            ],
        });
        const validator = OptionSetValidator.build(optionSet, validateOptions);
        expect(validator.errors).toHaveLength(0);
    });

    test("should not have errors if optionSet SERVICE PATIENT ORIGIN convention is valid", () => {
        const optionSet = createOptionSet({
            name: "ATFC- OoP",
            code: "ATFC_OOP",
            category: "SERVICE",
            options: [
                {
                    id: "1",
                    name: "YE1-05: Adear (OoP- ATFC)",
                    code: "YE105_ADEAR_OOP_ATFC",
                    sortOrder: 1,
                },
                {
                    id: "2",
                    name: "DAP: Juma Bazar (OoP - ATFC)",
                    code: "DAP_JUMA_BAZAR_OOP_ATFC",
                    sortOrder: 2,
                },
            ],
        });
        const validator = OptionSetValidator.build(optionSet, validateOptions);
        expect(validator.errors).toHaveLength(0);
    });

    test("should have errors if optionSet SERVICE STANDARD convention is not valid", () => {
        const optionSet = createOptionSet({
            name: "0test",
            code: "My code test",
            category: "SERVICE",
            options: [
                {
                    id: "1",
                    name: "0Option Name",
                    code: "OPTION-NAME",
                    sortOrder: 1,
                },
            ],
        });
        const validator = OptionSetValidator.build(optionSet, validateOptions);
        expect(validator.errors).toHaveLength(6);
        expect(validator.errors.find(error => error.rule === "not_pattern_found")).toBeDefined();
    });

    test("should not have errors if optionSet CROSS convention is valid", () => {
        const optionSet = createOptionSet({
            name: "CROSS- Age unit",
            code: "CROSS_AGE_UNIT",
            category: "CROSS",
            options: [
                { id: "1", name: "Years", code: "YEARS", sortOrder: 1 },
                { id: "1", name: "months", code: "MONTHS", sortOrder: 1 },
            ],
        });
        const validator = OptionSetValidator.build(optionSet, validateOptions);
        expect(validator.errors).toHaveLength(0);
    });

    test("should have errors if optionSet CROSS convention is not valid", () => {
        const optionSet = createOptionSet({
            name: "CROSS- Age,, unit",
            code: "CROSS_AGe_UNIT",
            category: "CROSS",
            options: [
                { id: "1", name: "Years", code: "lowercasevalue", sortOrder: 1 },
                { id: "1", name: "months", code: "invalid-value", sortOrder: 1 },
            ],
        });
        const validator = OptionSetValidator.build(optionSet, validateOptions);
        expect(validator.errors).toHaveLength(6);
    });

    test("should not have errors if optionSet AGGR convention is valid", () => {
        const optionSet = createOptionSet({
            name: "Aggr- Access_not in MSF",
            code: "AGGR_ACCESS_NOT_IN_MSF",
            category: "AGGREGATED",
            options: [
                {
                    id: "1",
                    name: "Yes: everywhere (Access1 - Aggr)",
                    code: "YES_EVERYWHERE_ACCESS1_AGGR",
                    sortOrder: 1,
                },
                { id: "2", name: "No (Access1- Aggr)", code: "NO_ACCESS1_AGGR", sortOrder: 2 },
                {
                    id: "3",
                    name: "Yes: but not in MSF projects (Aggr)",
                    code: "YES_BUT_NOT_IN_MSF_PROJECTS_AGGR",
                    sortOrder: 3,
                },
            ],
        });
        const validator = OptionSetValidator.build(optionSet, validateOptions);
        expect(validator.errors).toHaveLength(0);
    });

    test("should have errors if optionSet AGGR convention is not valid", () => {
        const optionSet = createOptionSet({
            name: "Aggr- Access_not in MSF",
            code: "AGGR_ACCESS_NOT_IN_MSF",
            category: "AGGREGATED",
            options: [
                {
                    id: "1",
                    name: "Yes: everywhere",
                    code: "YES_EVERYWHERE_ACCESS1_AGGR",
                    sortOrder: 1,
                },
            ],
        });
        const validator = OptionSetValidator.build(optionSet, validateOptions);
        expect(validator.errors).toHaveLength(1);
    });
});

describe("OptionSetValidator in square brackets mode", () => {
    function buildOptions(options: Option[]) {
        const optionSet = createOptionSet({ name: "Diagnosis list", category: "UNKNOWN", options });
        return OptionSetValidator.build(optionSet, squareBracketsOptions).errors;
    }

    function createOption(attrs: Partial<Option>): Option {
        return { id: "1", name: "An option", code: "A_CODE", sortOrder: 1, ...attrs };
    }

    test("should set the code to the content of the square brackets of the name", () => {
        const errors = buildOptions([
            createOption({ id: "1", name: "[O-MEN] Outbreak case - meningitis", code: "TOP" }),
        ]);

        expect(errors).toEqual([
            {
                id: "1",
                name: "[O-MEN] Outbreak case - meningitis",
                code: "TOP",
                type: "option",
                rule: "square_brackets",
                property: "code",
                currentValue: "TOP",
                fixedValue: "O-MEN",
            },
        ]);
    });

    test("should not report an option whose name has no square brackets", () => {
        expect(buildOptions([createOption({ name: "Outbreak case", code: "[TOP]" })])).toEqual([]);
    });

    test("should not report an option whose code already matches its square brackets", () => {
        expect(buildOptions([createOption({ name: "[O-MEN] Outbreak", code: "O-MEN" })])).toEqual([]);
    });

    test("should take the first group when the name has several", () => {
        const errors = buildOptions([createOption({ name: "[A] Text [B]", code: "X" })]);
        expect(errors.map(error => error.fixedValue)).toEqual(["A"]);
    });

    test("should ignore a group with blank content", () => {
        expect(buildOptions([createOption({ name: "[ ] Blank", code: "X" })])).toEqual([]);
    });

    test("should apply the rule to a category that has its own convention", () => {
        const optionSet = createOptionSet({
            name: "NEON- Admission type",
            category: "SERVICE",
            options: [createOption({ name: "[IN] Inborn (NEON)", code: "[IN]" })],
        });
        const errors = OptionSetValidator.build(optionSet, squareBracketsOptions).errors;

        expect(errors.map(error => error.fixedValue)).toEqual(["IN"]);
    });

    test("should not fix two options whose names resolve to the same code", () => {
        const errors = buildOptions([
            createOption({ id: "1", name: "[HH] Uno", code: "X" }),
            createOption({ id: "2", name: "[HH] Dos", code: "Y" }),
        ]);

        expect(errors.map(error => [error.id, error.rule, error.fixedValue])).toEqual([
            ["1", "duplicated_code", undefined],
            ["2", "duplicated_code", undefined],
        ]);
    });

    test("should not fix an option that collides with the code of an untouched option", () => {
        const errors = buildOptions([
            createOption({ id: "1", name: "[HH] Uno", code: "X" }),
            createOption({ id: "2", name: "Sin corchetes", code: "HH" }),
        ]);

        expect(errors.map(error => [error.id, error.rule, error.fixedValue])).toEqual([
            ["1", "duplicated_code", undefined],
        ]);
    });
});
