import { describe, it, expect } from "vitest";
import { getComparisonIdentifier, MetadataObject, UserMetadataObject } from "../MetadataObject";

const uid = "zzDnAcQDgTR";
const openId = "lab.manager@msf.org";

describe("getComparisonIdentifier", () => {
    describe("users", () => {
        it("returns the openId when the user has one", () => {
            expect(getComparisonIdentifier(createUser({ openId: openId }))).toBe(openId);
        });

        it("returns undefined when the user has no openId", () => {
            expect(getComparisonIdentifier(createUser({ openId: undefined }))).toBeUndefined();
        });

        it("returns undefined when the openId is an empty string", () => {
            expect(getComparisonIdentifier(createUser({ openId: "" }))).toBeUndefined();
        });
    });

    describe("non user models", () => {
        it("returns the uid", () => {
            expect(getComparisonIdentifier(createMetadataObject())).toBe(uid);
        });
    });
});

function createUser(data: Partial<UserMetadataObject> = {}): UserMetadataObject {
    return {
        model: "users",
        id: uid,
        name: "Lab Manager Nigeria",
        code: "nigeria-lab-manager",
        openId: undefined,
        type: "user",
        ...data,
    };
}

function createMetadataObject(data: Partial<MetadataObject> = {}): MetadataObject {
    return {
        model: "dataElements",
        id: uid,
        name: "A data element",
        code: "DE_CODE",
        type: "common",
        ...data,
    };
}
