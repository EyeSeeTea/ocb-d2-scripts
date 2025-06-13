import _ from "lodash";
import { Maybe } from "utils/ts-utils";
import { CrossValidationStrategy } from "./options/CrossValidationStrategy";
import { Struct } from "./generic/Struct";
import { OptionSet } from "./OptionSet";
import { Exceptions, Project, Service } from "./Service";
import { EDValidationStrategy } from "./options/EDValidationStrategy";
import { AggrValidationStrategy } from "./options/AggrValidationStrategy";
import { Id } from "./Base";
import { ServiceValidationStrategy } from "./options/ServiceValidationStrategy";

export type ValidationRule =
    | "special_characters"
    | "lowercase_chars"
    | "naming_conventions"
    | "invalid_service"
    | "invalid_project"
    | "not_pattern_found";

type OptionSetValidatorAttrs = {
    optionSet: OptionSet;
    errors: ValidationError[];
};

export type ValidationError = {
    id: Id;
    name: string;
    code: Maybe<string>;
    type: "option_set" | "option";
    rule: ValidationRule;
    currentValue: string;
    fixedValue: Maybe<string>;
    property: "name" | "code";
};

export class OptionSetValidator extends Struct<OptionSetValidatorAttrs>() {
    // commas and back and forward slashes
    static NAME_FORBIDDEN = /[\\/,]/;

    // only uppercase letters, digits, and underscores are allowed
    static CODE_LOWERCASE = /[a-z]/;
    static CODE_INVALID_CHAR = /[^A-Z0-9_]/;

    static build(optionSet: OptionSet, settings: SettingsValidation): OptionSetValidator {
        return this.create({ optionSet, errors: this.validate(optionSet, settings) });
    }

    static validate(optionSet: OptionSet, params: SettingsValidation): ValidationError[] {
        return this.getErrorsByCategory({ optionSet, ...params });
    }

    private static getErrorsByCategory(
        params: { optionSet: OptionSet } & SettingsValidation
    ): ValidationError[] {
        const { optionSet } = params;
        switch (optionSet.category) {
            case "SERVICE":
                return new ServiceValidationStrategy().validate(optionSet, params);
            case "CROSS":
                return new CrossValidationStrategy().validate(optionSet, params);
            case "PROJECT_ED":
                return new EDValidationStrategy().validate(optionSet, params);
            case "AGGREGATED":
                return new AggrValidationStrategy().validate(optionSet, params);
            case "UNKNOWN":
                return [];
            default:
                console.warn(`Unknown category: ${optionSet.category}`);
                return [];
        }
    }
}

export type SettingsValidation = { services: Project[]; projects: Service[]; exceptions: Exceptions[] };
