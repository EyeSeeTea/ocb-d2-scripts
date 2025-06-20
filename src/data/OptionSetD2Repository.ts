import _ from "lodash";
import { D2Api } from "types/d2-api";
import { Async } from "domain/entities/Async";
import { OptionSet } from "domain/entities/OptionSet";
import { OptionSetRepository } from "domain/repositories/OptionSetRepository";
import { promiseMap } from "./dhis2-utils";
import logger from "utils/log";

export class OptionSetD2Repository implements OptionSetRepository {
    constructor(private api: D2Api) {}

    async getAll(): Async<OptionSet[]> {
        const totalPages = await this.getTotalPages({ pageSize: 100 });
        logger.info("Loading optionSets...");
        const rangePages = _.range(1, totalPages + 1);

        const optionSets = await promiseMap(rangePages, async page => {
            const d2OptionSets = await this.getOptionsSets(page);
            return d2OptionSets.objects.map(d2OptionSet =>
                OptionSet.create({ ...d2OptionSet, category: "UNKNOWN" })
            );
        });

        return _(optionSets).flatten().value();
    }

    private getOptionsSets(page: number) {
        return this.api.models.optionSets
            .get({ fields: optionSetFields, pageSize: PAGE_SIZE, page: page })
            .getData();
    }

    private async getTotalPages(options: { pageSize: number }): Async<number> {
        const response = await this.api.models.optionSets
            .get({ fields: { id: true }, pageSize: 0 })
            .getData();

        return Math.ceil(response.pager.total / options.pageSize);
    }
}

const optionSetFields = {
    id: true,
    name: true,
    code: true,
    options: { id: true, name: true, code: true, sortOrder: true },
} as const;

const PAGE_SIZE = 100;
