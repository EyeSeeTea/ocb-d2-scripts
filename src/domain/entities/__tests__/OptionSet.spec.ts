import { describe, it, expect } from "vitest";
import { OptionSet, OptionSetAttrs } from "../OptionSet";

describe("OptionSet", () => {
    it("should classify category as SERVICE", () => {
        const optionSet = createOptionSet({ name: "Beirut Emergency- Newborn presentation" });
        expect(optionSet.getCategory(allowedServices)).toBe("SERVICE");
    });

    it("should classify category as CROSS", () => {
        const optionSet = createOptionSet({ name: "CROSS- Example" });
        expect(optionSet.getCategory(allowedServices)).toBe("CROSS");
    });

    it("should classify category as AGGREGATED", () => {
        const optionSet = createOptionSet({ name: "Aggr- Example" });
        expect(optionSet.getCategory(allowedServices)).toBe("AGGREGATED");
    });

    it("should classify category as UNKNOWN", () => {
        const optionSet = createOptionSet({ name: "0test" });
        expect(optionSet.getCategory(allowedServices)).toBe("UNKNOWN");
    });
});

export function createOptionSet(data: Partial<OptionSetAttrs> = {}): OptionSet {
    return OptionSet.create({
        id: "default-id",
        name: "A valid name",
        code: "VALID_CODE",
        options: [],
        category: "UNKNOWN",
        ...data,
    });
}

const allowedServices = ["Beirut Emergency", "Another service name"];
