import { describe, expect, it } from "vitest";
import { getCodeFromSquareBrackets } from "../squareBrackets";

describe("getCodeFromSquareBrackets", () => {
    it("returns the content of the group at the start of the name", () => {
        expect(getCodeFromSquareBrackets("[O-MEN] Outbreak case - meningitis")).toBe("O-MEN");
    });

    it("returns the content of a group placed anywhere in the name", () => {
        expect(getCodeFromSquareBrackets("Outbreak case [O-MEN]")).toBe("O-MEN");
    });

    it("returns the first group when the name has several", () => {
        expect(getCodeFromSquareBrackets("[A] Text [B]")).toBe("A");
    });

    it("keeps the content as it is, without normalizing it", () => {
        expect(getCodeFromSquareBrackets("[o men] Lowercase and space")).toBe("o men");
    });

    it("returns undefined when the name has no group", () => {
        expect(getCodeFromSquareBrackets("Outbreak case - meningitis")).toBeUndefined();
    });

    it("returns undefined when the group is empty", () => {
        expect(getCodeFromSquareBrackets("[] Outbreak case")).toBeUndefined();
    });

    it("returns undefined when the group only has blanks", () => {
        expect(getCodeFromSquareBrackets("[ ] Outbreak case")).toBeUndefined();
    });

    it("returns undefined when the group is not closed", () => {
        expect(getCodeFromSquareBrackets("[O-MEN Outbreak case")).toBeUndefined();
    });
});
