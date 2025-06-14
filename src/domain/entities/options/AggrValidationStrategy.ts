import _ from "lodash";
import { getValidationErrorFromCode, replaceByUnderScores, validateCode, validateName } from "./validation";
import { OptionSet } from "../OptionSet";
import { SettingsValidation, ValidationError } from "../OptionSetValidator";
import { Maybe } from "utils/ts-utils";

export class AggrValidationStrategy {
    private readonly namePattern = /^(?<prefix>Aggr)-\s+(?<optionSetName>.+)$/i;
    private readonly nameOptionPattern =
        /^(?<optionName>.+?)\s*\(\s*(?:(?<value>.+?)\s*[-–]\s*)?(?<suffix>aggr)\s*\)$/i;

    static readonly prefix = "Aggr";

    validate(optionSet: OptionSet, settings: SettingsValidation): ValidationError[] {
        const exceptionCodes = settings.exceptions.map(exception => exception.code);
        const nameOptSetError = validateName({ ...optionSet, type: "option_set" });
        const codeOptSetError = validateCode({ ...optionSet, type: "option_set" });

        const nameConvention = this.validateOptSetPattern(optionSet.name);
        if (!nameConvention) {
            return [
                {
                    code: optionSet.code,
                    id: optionSet.id,
                    name: optionSet.name,
                    currentValue: optionSet.name,
                    rule: "not_pattern_found",
                    type: "option_set",
                    fixedValue: "",
                    property: "name",
                },
            ];
        }

        const optSetCodeExpected = this.generateCodeException(nameConvention, exceptionCodes);

        const invalidOptSetCodeError = getValidationErrorFromCode({
            id: optionSet.id,
            name: optionSet.name,
            code: optionSet.code,
            actualCode: optionSet.code ?? "",
            expectedCode: optSetCodeExpected,
            type: "option_set",
        });

        const optionErrors = optionSet.options.flatMap((option): ValidationError[] => {
            const nameError = validateName({ ...option, type: "option" });
            const codeError = validateCode({ ...option, type: "option" });

            const nameConvention = this.validatePattern(option.name);

            const nameConventionError: Maybe<ValidationError> = !nameConvention
                ? {
                      ...optionSet,
                      currentValue: option.name,
                      rule: "not_pattern_found",
                      type: "option",
                      fixedValue: "",
                      property: "name",
                  }
                : undefined;

            if (nameConventionError || !nameConvention)
                return _([nameError, nameConventionError, codeError]).compact().value();

            const prefixUpperCase = AggrValidationStrategy.prefix.toUpperCase();

            const optionNameUnderScores = replaceByUnderScores(nameConvention.optionName ?? "");

            const value = nameConvention.value
                ? `${nameConvention.value}_${prefixUpperCase}`
                : prefixUpperCase;

            const expectedCode = `${optionNameUnderScores}_${value}`.toUpperCase();

            const invalidCodeError = getValidationErrorFromCode({
                ...optionSet,
                actualCode: option.code,
                expectedCode: replaceByUnderScores(expectedCode),
                type: "option",
            });

            return _([nameError, nameConventionError, codeError, invalidCodeError]).compact().value();
        });

        return _([nameOptSetError, codeOptSetError, invalidOptSetCodeError, ...optionErrors])
            .compact()
            .value();
    }

    private generateCodeException(groups: AggrOptSetData, exceptionCodes: string[]) {
        const alphaNumericRegex = /[^a-zA-Z0-9]/g;

        const optionSetName = groups.optionSetName
            .split(" ")
            .map(word => {
                return exceptionCodes.includes(word)
                    ? word.replace(alphaNumericRegex, "")
                    : word.replace(alphaNumericRegex, "_");
            })
            .join("_");

        return replaceByUnderScores(`${groups.prefix}_${optionSetName}`).toUpperCase();
    }

    private validateOptSetPattern(name: string): Maybe<AggrOptSetData> {
        // Aggr- [Option Set Name]
        const match = name.match(this.namePattern);
        if (!match?.groups) return undefined;

        const { prefix, optionSetName } = match.groups;
        return {
            optionSetName: optionSetName?.trim() ?? "",
            prefix: prefix?.trim() ?? "",
        };
    }

    private validatePattern(name: string): Maybe<AggrData> {
        // [Option Name] (aggr)
        // [Option Name] (value - aggr)
        const match = name.match(this.nameOptionPattern);
        if (!match?.groups) return undefined;

        const { optionName, suffix, value } = match.groups;
        return {
            optionName: optionName?.trim() ?? "",
            suffix: suffix?.trim() ?? "",
            value: value?.trim() ?? "",
        };
    }
}

type AggrData = {
    optionName: string;
    suffix: string;
    value: string;
};

type AggrOptSetData = {
    optionSetName: string;
    prefix: string;
};
