/**
 * Pure logic to recode an option code inside DHIS2 metadata expressions.
 *
 * DHIS2 references an option by its code as a quoted literal inside expressions, for example a
 * programIndicator filter such as `#{abc.def} == '[F-HI]'`. Renaming the option code requires
 * rewriting those literals. Both the syntax and the affected models are DHIS2 specific, which is why
 * this lives in the data layer next to D2RenameOptionCode.
 */

/**
 * Replace an option code, only where it appears as a quoted literal.
 *
 * Plain substring replacement is unsafe: codes such as `CH`, `10` or `IN` also appear inside other
 * tokens and inside other codes. Regex metacharacters in the code (`[`, `]`, `-`) are escaped.
 */
export function replaceCodeInExpression(expression: string, fromCode: string, toCode: string): string {
    if (!fromCode) return expression;

    return expression.replace(
        getQuotedCodeRegExp(fromCode, "g"),
        (_match, quote: string) => `${quote}${toCode}${quote}`
    );
}

export function expressionReferencesCode(expression: string, code: string): boolean {
    return Boolean(code) && getQuotedCodeRegExp(code, "").test(expression);
}

/**
 * Return a copy of the object with the given fields recoded. The remaining fields are kept as they
 * are, because the object is posted back in full: a metadata post replaces the whole object.
 */
export function recodeFields<T extends object>(
    object: T,
    fields: ReadonlyArray<keyof T>,
    fromCode: string,
    toCode: string
): T {
    return fields.reduce<T>((acc, field) => {
        const value = acc[field];
        if (typeof value !== "string") return acc;

        const recodedValue = replaceCodeInExpression(value, fromCode, toCode);
        return recodedValue === value ? acc : { ...acc, [field]: recodedValue };
    }, object);
}

export function objectReferencesCode<T extends object>(
    object: T,
    fields: ReadonlyArray<keyof T>,
    code: string
): boolean {
    return fields.some(field => {
        const value = object[field];
        return typeof value === "string" && expressionReferencesCode(value, code);
    });
}

function getQuotedCodeRegExp(code: string, flags: string): RegExp {
    return new RegExp(`(['"])${escapeRegExp(code)}\\1`, flags);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
