import { describe, expect, it } from "vitest";
import { findQuotedCodes, ItemRefs, recodeExpression, referencesItems } from "data/optionCodeReferences";

const DE = "lCoJD1K1cm0";
const OTHER_DE = "pV6GZChjIuj";
const TEA = "OcaSynTeaPe";
const item = `#{Ky97KUZnlK8.${DE}}`;
const otherItem = `#{Ky97KUZnlK8.${OTHER_DE}}`;

const refs: ItemRefs = { dataElementIds: [DE], attributeIds: [TEA], variableNames: ["precip event"] };
// Chained mapping of Precipitating Event: 13 -> 1 while 1 -> 2.
const mapping = { "13": "1", "1": "2", "[F-HI]": "F-HI" };

const recode = (expression: string, options = {}) => recodeExpression(expression, refs, mapping, options);

describe("recodeExpression", () => {
    it("recodes a code compared with a data element of the set", () => {
        expect(recode(`${item} == '13'`).value).toBe(`${item} == '1'`);
    });

    it("recodes != comparisons, double quotes and the reversed form", () => {
        expect(recode(`${item} != "13" && '13' == ${item}`).value).toBe(`${item} != "1" && '1' == ${item}`);
    });

    it("recodes a chained mapping in a single pass", () => {
        expect(recode(`${item} == '13' || ${item} == '1'`).value).toBe(`${item} == '1' || ${item} == '2'`);
    });

    it("does not recode a code compared with an item of another option set", () => {
        const result = recode(`${otherItem} == '1' && ${item} == '13'`);
        expect(result.value).toBe(`${otherItem} == '1' && ${item} == '1'`);
        expect(result.review).toEqual(["1"]);
    });

    it("recodes d2:countIfValue on an item of the set", () => {
        expect(recode(`d2:countIfValue(${item}, '13')`).value).toBe(`d2:countIfValue(${item}, '1')`);
    });

    it("recodes data elements without stage, attributes and program rule variables", () => {
        expect(recode(`#{${DE}} == '13'`).value).toBe(`#{${DE}} == '1'`);
        expect(recode(`A{${TEA}} == '13'`).value).toBe(`A{${TEA}} == '1'`);
        expect(recode(`#{precip event} == '13' || A{precip event} == '1'`).value).toBe(
            `#{precip event} == '1' || A{precip event} == '2'`
        );
    });

    it("escapes regexp characters in codes and variable names", () => {
        expect(recode(`${item} == '[F-HI]'`).value).toBe(`${item} == 'F-HI'`);
    });

    it("does not touch a code that merely contains a mapped code", () => {
        expect(recode(`${item} == '113'`).value).toBe(`${item} == '113'`);
    });

    it("reports a mapped code out of a comparison with an item", () => {
        const result = recode(`d2:hasValue(${item}) && d2:concatenate('13', 'x') == 'y'`);
        expect(result.value).toBe(`d2:hasValue(${item}) && d2:concatenate('13', 'x') == 'y'`);
        expect(result.review).toEqual(["13"]);
    });

    it("recodes the whole literal of an action assigned to an item of the set", () => {
        expect(recode(`'13'`, { isAssignedToItem: true }).value).toBe(`'1'`);
        expect(recode(`'13'`).value).toBe(`'13'`);
    });

    it("returns the expression as it is when there are no items", () => {
        const none = { dataElementIds: [], attributeIds: [], variableNames: [] };
        expect(recodeExpression(`${item} == '13'`, none, mapping)).toEqual({
            value: `${item} == '13'`,
            review: [],
        });
    });
});

describe("referencesItems", () => {
    it("detects an item of the set", () => {
        expect(referencesItems(`${item} == '1'`, refs)).toBe(true);
        expect(referencesItems(`${otherItem} == '1'`, refs)).toBe(false);
        expect(referencesItems(undefined, refs)).toBe(false);
    });
});

describe("findQuotedCodes", () => {
    it("finds the quoted codes of the mapping in a free text", () => {
        expect(findQuotedCodes("Code '13' or \"1\" selected, not '5'", mapping)).toEqual(["13", "1"]);
    });
});

describe("recodeExpression in aggregate expressions", () => {
    const aggregateRefs: ItemRefs = { dataElementIds: [DE], attributeIds: [], variableNames: [] };
    const recodeAggregate = (expression: string) => recodeExpression(expression, aggregateRefs, mapping);

    it("recodes a code compared with an aggregate data element, with or without combos", () => {
        expect(recodeAggregate(`if(#{${DE}} == '13', 1, 0)`).value).toBe(`if(#{${DE}} == '1', 1, 0)`);
        expect(recodeAggregate(`if(#{${DE}.HllvX50cXC0} == '13', 1, 0)`).value).toBe(
            `if(#{${DE}.HllvX50cXC0} == '1', 1, 0)`
        );
        expect(recodeAggregate(`if(#{${DE}.*.HllvX50cXC0} != "1", 1, 0)`).value).toBe(
            `if(#{${DE}.*.HllvX50cXC0} != "2", 1, 0)`
        );
    });

    it("does not recode a code compared with another data element", () => {
        expect(recodeAggregate(`if(#{${OTHER_DE}.HllvX50cXC0} == '13', 1, 0)`).value).toBe(
            `if(#{${OTHER_DE}.HllvX50cXC0} == '13', 1, 0)`
        );
    });
});
