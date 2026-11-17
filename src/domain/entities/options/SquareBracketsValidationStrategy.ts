import _ from "lodash";
import { Maybe } from "utils/ts-utils";
import { Option } from "../Option";
import { OptionSet } from "../OptionSet";
import { ValidationError } from "../OptionSetValidator";
import { getCodeFromSquareBrackets } from "./squareBrackets";

/**
 * The option code is the content of the square brackets of its name. Options whose name has no
 * square brackets are left untouched, whatever their code is.
 *
 * This strategy replaces the category conventions instead of complementing them: the resulting code
 * follows the name and nothing else.
 */
export class SquareBracketsValidationStrategy {
    validate(optionSet: OptionSet): ValidationError[] {
        const duplicatedCodes = this.getDuplicatedCodes(optionSet.options);

        return _(optionSet.options)
            .map(option => {
                const expectedCode = getCodeFromSquareBrackets(option.name);
                if (!expectedCode || expectedCode === option.code) return undefined;

                return duplicatedCodes.has(expectedCode)
                    ? this.buildError(option, "duplicated_code", undefined)
                    : this.buildError(option, "square_brackets", expectedCode);
            })
            .compact()
            .value();
    }

    /**
     * An option set cannot hold two options with the same code, so a code is unusable when another
     * option of the set already ends up with it. The final code of an option is the one from its
     * name, or the current one when the name has no square brackets.
     */
    private getDuplicatedCodes(options: Option[]): Set<string> {
        const finalCodes = options.map(option => getCodeFromSquareBrackets(option.name) ?? option.code);

        const duplicated = _(finalCodes)
            .countBy()
            .pickBy(count => count > 1)
            .keys()
            .value();

        return new Set(duplicated);
    }

    private buildError(
        option: Option,
        rule: ValidationError["rule"],
        fixedValue: Maybe<string>
    ): ValidationError {
        return {
            id: option.id,
            name: option.name,
            code: option.code,
            type: "option",
            rule: rule,
            property: "code",
            currentValue: option.code,
            fixedValue: fixedValue,
        };
    }
}
