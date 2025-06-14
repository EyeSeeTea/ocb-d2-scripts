import _ from "lodash";
import { getValidationErrorFromCode, replaceByUnderScores, validateCode, validateName } from "./validation";
import { OptionSet } from "../OptionSet";
import { SettingsValidation, ValidationError } from "../OptionSetValidator";

export class CrossValidationStrategy {
    static readonly prefix = "CROSS";

    validate(optionSet: OptionSet, _settings: SettingsValidation): ValidationError[] {
        const nameOptSetError = validateName({ ...optionSet, type: "option" });
        const codeOptSetError = validateCode({ ...optionSet, type: "option" });

        const optionErrors = optionSet.options.flatMap(option => {
            // [Option Name]
            const nameError = validateName({ ...option, type: "option" });
            const codeError = validateCode({ ...option, type: "option" });

            const expectedCode = replaceByUnderScores(option.name);
            const invalidCodeError = getValidationErrorFromCode({
                ...option,
                actualCode: option.code,
                expectedCode,
                type: "option",
            });

            return _([nameError, codeError, invalidCodeError]).compact().value();
        });

        return _([nameOptSetError, codeOptSetError, ...optionErrors])
            .compact()
            .value();
    }
}
