import _ from "lodash";
import { validateCode, validateName } from "./validation";
import { OptionSet } from "../OptionSet";
import { SettingsValidation, ValidationError } from "../OptionSetValidator";

export class EDValidationStrategy {
    static readonly prefix = "ED";

    validate(optionSet: OptionSet, _settings: SettingsValidation): ValidationError[] {
        const optionErrors = optionSet.options.flatMap(option => {
            const nameError = validateName({ ...option, type: "option" });
            const codeError = validateCode({ ...option, type: "option" });
            return _([nameError, codeError]).compact().value();
        });

        return optionErrors;
    }
}
