import { describe, it, expect } from "vitest";
import { Async } from "domain/entities/Async";
import { Id } from "domain/entities/Base";
import { MetadataModel, MetadataObjectWithType, UserMetadataObject } from "domain/entities/MetadataObject";
import { Paginated } from "domain/entities/Pagination";
import { Stats } from "domain/entities/Stats";
import { MetadataRepository } from "domain/repositories/MetadataRepository";
import { SyncMetadataReport, SyncMetadataUseCase } from "../SyncMetadataUseCase";

const openId = "john.doe@eyeseetea.com";

describe("SyncMetadataUseCase", () => {
    /*
       Users without an OIDC identifier used to be grouped under the same missing key, so every
       user of the replica was compared against a single unrelated user of the main server.
    */
    describe("users without an OIDC identifier", () => {
        const mainUser = createUser({ id: "mainUserId1", code: "nigeria-lab-manager" });
        const firstReplicaUser = createUser({ id: "replicaUserId1", code: "john.traore" });
        const secondReplicaUser = createUser({ id: "replicaUserId2", code: "john.doe" });

        const syncSkippedUsers = () =>
            syncUsers({ main: [mainUser], replica: [firstReplicaUser, secondReplicaUser] });

        it("does not compare their codes", async () => {
            const report = await syncSkippedUsers();
            expect(report.metadataWithCodeDiscrepancies).toEqual([{ model: "users", items: [] }]);
        });

        it("does not compare their fields", async () => {
            const report = await syncSkippedUsers();
            expect(report.metadataWithPropertiesDiscrepancies).toEqual([{ model: "users", items: [] }]);
        });

        it("does not report them as exclusive metadata", async () => {
            const report = await syncSkippedUsers();
            expect(report.exclusiveMetadata).toEqual([{ model: "users", exclusive: [] }]);
        });

        it("reports them as skipped, with the server they belong to", async () => {
            const report = await syncSkippedUsers();
            expect(report.skippedMetadata).toEqual([
                {
                    model: "users",
                    items: [
                        { object: mainUser, source: { type: "main" }, reason: "missing-identifier" },
                        {
                            object: firstReplicaUser,
                            source: { type: "replica", index: 0 },
                            reason: "missing-identifier",
                        },
                        {
                            object: secondReplicaUser,
                            source: { type: "replica", index: 0 },
                            reason: "missing-identifier",
                        },
                    ],
                },
            ]);
        });
    });

    describe("users with an OIDC identifier", () => {
        it("reports a code discrepancy when the same user has a different username", async () => {
            const mainUser = createUser({ id: "mainUserId1", code: "john.doe", openId: openId });
            const replicaUser = createUser({ id: "replicaUserId1", code: "j.doe", openId: openId });

            const report = await syncUsers({ main: [mainUser], replica: [replicaUser] });

            expect(report.metadataWithCodeDiscrepancies).toEqual([
                {
                    model: "users",
                    items: [
                        {
                            model: "users",
                            id: openId,
                            mainObject: mainUser,
                            replicaObject: replicaUser,
                            replicaIndex: 0,
                            differingFields: ["code"],
                        },
                    ],
                },
            ]);
        });

        it("reports a user missing in the replica as exclusive to the main server", async () => {
            const mainUser = createUser({ id: "mainUserId1", openId: openId });

            const report = await syncUsers({ main: [mainUser], replica: [] });

            expect(report.exclusiveMetadata).toEqual([
                { model: "users", exclusive: [{ object: mainUser, source: { type: "main" } }] },
            ]);
        });

        it("does not report them as skipped", async () => {
            const mainUser = createUser({ id: "mainUserId1", openId: openId });

            const report = await syncUsers({ main: [mainUser], replica: [] });

            expect(report.skippedMetadata).toEqual([{ model: "users", items: [] }]);
        });
    });
});

class FakeMetadataRepository implements MetadataRepository {
    constructor(private objectsByModel: Partial<Record<MetadataModel, MetadataObjectWithType[]>>) {}

    async getPaginated(options: {
        model: MetadataModel;
        page: number;
    }): Async<Paginated<MetadataObjectWithType>> {
        const objects = this.objectsByModel[options.model] ?? [];
        return {
            objects: objects,
            pager: { page: 1, pageCount: 1, total: objects.length, pageSize: objects.length },
        };
    }

    async save(): Async<Stats[]> {
        return [];
    }

    async delete(): Async<Stats[]> {
        return [];
    }
}

async function syncUsers(options: {
    main: UserMetadataObject[];
    replica: UserMetadataObject[];
}): Async<SyncMetadataReport> {
    const useCase = new SyncMetadataUseCase(new FakeMetadataRepository({ users: options.main }), [
        new FakeMetadataRepository({ users: options.replica }),
    ]);

    const result = await useCase.execute({
        modelsToCheck: ["users"],
        action: undefined,
        persist: false,
    });

    return result.syncMetadataReport;
}

function createUser(data: Partial<UserMetadataObject> & { id: Id }): UserMetadataObject {
    const user: UserMetadataObject = {
        model: "users",
        name: "A user",
        code: "a-username",
        openId: undefined,
        type: "user",
        ...data,
    };

    return { ...user, additionalFields: { id: user.id, username: user.code } };
}
