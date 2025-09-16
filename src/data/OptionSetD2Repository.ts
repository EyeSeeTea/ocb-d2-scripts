import _ from "lodash";
import { D2Api } from "types/d2-api";
import { Async } from "domain/entities/Async";
import { OptionSet } from "domain/entities/OptionSet";
import { OptionSetRepository } from "domain/repositories/OptionSetRepository";
import { getInChunks, promiseMap } from "./dhis2-utils";
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

    async save(optionSets: OptionSet[], options?: { dryRun: boolean }): Async<void> {
        const allIds = optionSets.map(os => os.id);

        const stats = await getInChunks(allIds, async optionSetIds => {
            const response = await this.api.models.optionSets
                .get({
                    fields: { $owner: true },
                    filter: { id: { in: optionSetIds } },
                    paging: false,
                })
                .getData();

            const optionSetsToSave = optionSetIds.map(optionSetId => {
                const existingRecord = response.objects.find(d2Os => d2Os.id === optionSetId);
                const optionSet = optionSets.find(os => os.id === optionSetId);
                if (!optionSet) {
                    throw Error("Cannot find optionSet");
                }
                return {
                    ...(existingRecord || {}),
                    name: optionSet.name,
                    code: optionSet.code ?? "",
                };
            });

            const postResponse = await this.api.metadata
                .post(
                    { optionSets: optionSetsToSave },
                    { importMode: options?.dryRun ? "VALIDATE" : "COMMIT" }
                )
                .getData();

            return [postResponse.stats];
        });

        console.debug("OptionSets saved:", JSON.stringify(stats, null, 2));
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
