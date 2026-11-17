import _ from "lodash";
import { Id } from "domain/entities/Base";
import { CodeMapping, recodeValue } from "domain/entities/OptionCodeMapping";

/**
 * Pure logic to recode option codes inside DHIS2 metadata expressions (programIndicators,
 * programRules, programRuleActions).
 *
 * A code appears as a quoted literal (`'13'` or `"13"`), and only its context tells which option set
 * it belongs to: the same literal `'1'` may be compared with items of many option sets. So a literal
 * is recoded only when it is compared with an item bound to the option set being recoded:
 *
 *   - `ITEM == 'CODE'`, `ITEM != 'CODE'`, and the reversed `'CODE' == ITEM`
 *   - `d2:countIfValue(ITEM, 'CODE')`
 *
 * where ITEM is a data element (`#{stage.de}` in program expressions; `#{de}`, `#{de.coc}`,
 * `#{de.coc.aoc}` in aggregate ones: indicators, validation rules, predictors), an attribute
 * (`A{tea}`) or a program rule
 * variable bound to one of them (`#{name}`, `A{name}`). Any other literal of a mapped code in an
 * expression that references the items is left as it is and reported for manual review.
 *
 * Each literal is recoded once from its original value, so chained mappings (`13 -> 1`, `1 -> 2`)
 * give the right result in a single pass.
 */

export type ItemRefs = {
    dataElementIds: Id[];
    attributeIds: Id[];
    /** Names of the program rule variables bound to those items (in the program of the object). */
    variableNames: string[];
};

export type ExpressionRecode = {
    value: string;
    /** Mapped codes that appear in the expression in a context that is not recoded automatically. */
    review: string[];
};

const LITERAL_REGEXP = /'([^']*)'|"([^"]*)"/g;

export function referencesItems(expression: string | undefined, refs: ItemRefs): boolean {
    const itemRegExp = getItemRegExpSource(refs);
    return Boolean(expression && itemRegExp && new RegExp(itemRegExp).test(expression));
}

export function recodeExpression(
    expression: string | undefined,
    refs: ItemRefs,
    mapping: CodeMapping,
    options: { isAssignedToItem?: boolean } = {}
): ExpressionRecode {
    if (!expression) return { value: expression ?? "", review: [] };

    const itemSource = getItemRegExpSource(refs);
    if (!itemSource) return { value: expression, review: [] };

    const before = [
        new RegExp(`(?:${itemSource})\\s*(?:==|!=)\\s*$`),
        new RegExp(`d2:countIfValue\\(\\s*(?:${itemSource})\\s*,\\s*$`),
    ];
    const after = new RegExp(`^\\s*(?:==|!=)\\s*(?:${itemSource})`);
    // An ASSIGN action to an item of the set holds the code as its whole expression: `'13'`.
    const isWholeLiteral = options.isAssignedToItem && /^\s*('[^']*'|"[^"]*")\s*$/.test(expression);
    const review: string[] = [];

    const value = expression.replace(
        LITERAL_REGEXP,
        (match, single?: string, double?: string, offset = 0) => {
            const code = single ?? double ?? "";
            if (!Object.prototype.hasOwnProperty.call(mapping, code)) return match;

            const prefix = expression.slice(0, offset);
            const suffix = expression.slice(offset + match.length);
            const isScoped = isWholeLiteral || before.some(re => re.test(prefix)) || after.test(suffix);

            if (!isScoped) {
                review.push(code);
                return match;
            }

            const quote = single !== undefined ? "'" : '"';
            return `${quote}${recodeValue(code, mapping)}${quote}`;
        }
    );

    return { value, review: _.uniq(review) };
}

/**
 * Codes of the mapping quoted anywhere in a free text, such as the `content` of a program rule
 * action (a message shown to the user). Never recoded automatically, only reported.
 */
export function findQuotedCodes(text: string | undefined, mapping: CodeMapping): string[] {
    if (!text) return [];
    const codes = Array.from(text.matchAll(LITERAL_REGEXP), match => match[1] ?? match[2] ?? "");
    return _.uniq(codes.filter(code => Object.prototype.hasOwnProperty.call(mapping, code)));
}

function getItemRegExpSource(refs: ItemRefs): string | undefined {
    const uid = "[A-Za-z][A-Za-z0-9]{10}";
    const alternatives = [
        // `#{stage.de}`, `#{de}` and `#{de.coc}` / `#{de.coc.aoc}` (`*` for any combo).
        ...refs.dataElementIds.map(
            id => `#\\{(?:${uid}\\.)?${escapeRegExp(id)}(?:\\.(?:${uid}|\\*)){0,2}\\}`
        ),
        ...refs.attributeIds.map(id => `A\\{${escapeRegExp(id)}\\}`),
        ...refs.variableNames.map(name => `[#A]\\{${escapeRegExp(name)}\\}`),
    ];

    return alternatives.length > 0 ? alternatives.join("|") : undefined;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
