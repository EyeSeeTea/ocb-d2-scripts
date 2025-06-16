import { describe, test, expect } from "vitest";

import { OptionSetValidator } from "../OptionSetValidator";
import { Project, Service } from "../Service";
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

const validateOptions = { projects, services, exceptions: [] };

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
