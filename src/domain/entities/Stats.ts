import { Maybe } from "utils/ts-utils";
import { Id } from "./Base";
import { MetadataModel } from "./MetadataObject";

type StatsAttrs = {
    errorMessages: ErrorMessage[];
    created: number;
    ignored: number;
    updated: number;
    deleted: number;
    total: number;
    model: Maybe<MetadataModel>;
};

export type ErrorMessage = { message: string; id: Id };

export class Stats {
    public readonly errorMessages: ErrorMessage[];
    public readonly created: number;
    public readonly ignored: number;
    public readonly updated: number;
    public readonly deleted: number;
    public readonly total: number;
    public readonly model: Maybe<string>;

    constructor(attrs: StatsAttrs) {
        this.created = attrs.created;
        this.ignored = attrs.ignored;
        this.updated = attrs.updated;
        this.deleted = attrs.deleted;
        this.errorMessages = attrs.errorMessages;
        this.total = attrs.total;
        this.model = attrs.model;
    }

    static combine(stats: Stats[]): Stats {
        return stats.reduce((acum, stat) => {
            return {
                errorMessages: [...acum.errorMessages, ...stat.errorMessages],
                created: acum.created + stat.created,
                ignored: acum.ignored + stat.ignored,
                updated: acum.updated + stat.updated,
                deleted: acum.deleted + stat.deleted,
                total: acum.total + stat.total,
                model: stat.model,
            };
        }, Stats.empty());
    }

    static empty(): Stats {
        return {
            model: undefined,
            errorMessages: [],
            created: 0,
            ignored: 0,
            updated: 0,
            deleted: 0,
            total: 0,
        };
    }
}
