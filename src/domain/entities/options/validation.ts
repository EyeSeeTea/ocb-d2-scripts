import { Maybe } from "utils/ts-utils";
import { Id } from "../Base";
import { OptionSetValidator, ValidationError } from "../OptionSetValidator";

export function validateName(params: {
    id: Id;
    code: Maybe<string>;
    name: string;
    type: ValidationError["type"];
}): Maybe<ValidationError> {
    const { id, code, name, type } = params;
    return OptionSetValidator.NAME_FORBIDDEN.test(name)
        ? {
              id,
              name,
              code,
              type: type,
              currentValue: name,
              rule: "special_characters",
              property: "name",
              fixedValue: undefined,
          }
        : undefined;
}

export function validateCode(params: {
    id: Id;
    name: string;
    code: Maybe<string>;
    type: ValidationError["type"];
}): Maybe<ValidationError> {
    const { id, code, name, type } = params;
    const codeValue = code ?? "";
    const isLowerCase = OptionSetValidator.CODE_LOWERCASE.test(codeValue);
    const isInvalidChar = OptionSetValidator.CODE_INVALID_CHAR.test(codeValue.toUpperCase());
    if (!isLowerCase && !isInvalidChar) return undefined;

    return {
        code: code,
        id: id,
        name: name,
        currentValue: codeValue,
        rule: "lowercase_chars",
        property: "code",
        fixedValue: undefined,
        type: type,
    };
}

export function getValidationErrorFromCode(params: {
    id: Id;
    name: string;
    code: Maybe<string>;
    actualCode: string;
    expectedCode: string;
    type: ValidationError["type"];
}): Maybe<ValidationError> {
    const { actualCode, code, expectedCode, id, name, type } = params;
    return actualCode !== expectedCode
        ? {
              id: id,
              code: code,
              name: name,
              type: type,
              rule: "naming_conventions",
              property: "code",
              currentValue: actualCode,
              fixedValue: expectedCode,
          }
        : undefined;
}

export function replaceByUnderScores(value: string): string {
    return value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "_")
        .replace(/_+/g, "_");
}
