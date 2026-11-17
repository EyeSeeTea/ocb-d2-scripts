import _ from "lodash";
import { command, string, option, flag, boolean } from "cmd-ts";
import { getApiUrlOptions, getD2ApiFromArgs } from "scripts/common";
import { OptionSetD2Repository } from "data/OptionSetD2Repository";
import { OptionSetRecodeD2Repository } from "data/OptionSetRecodeD2Repository";
import { readOptionCodeChanges, writeRecodeReport } from "data/OptionCodeMappingCsv";
import { RecodeOptionSetsUseCase } from "domain/usecases/RecodeOptionSetsUseCase";
import logger from "utils/log";

export const recodeOptionsCmd = command({
    name: "recode",
    description: "Recode option codes from a mapping CSV, with their data and metadata references",
    args: {
        ...getApiUrlOptions(),
        mappingPath: option({
            type: string,
            long: "mapping-path",
            description:
                "CSV with columns option_set_id, option_id, current_code, proposed_code [, change_type]",
        }),
        reportPath: option({
            type: string,
            long: "report-path",
            description: "Path to save the report (a -summary.csv is written next to it)",
            defaultValue: () => "option-recode-report.csv",
        }),
        includeToBeConfirmed: flag({
            long: "include-to-be-confirmed",
            description: "Also apply the rows with change_type RECODE_TBC",
            defaultValue: () => false,
            type: boolean,
        }),
        update: flag({
            long: "update",
            description: "Persist changes (otherwise, dry run)",
            defaultValue: () => false,
            type: boolean,
        }),
    },
    handler: async args => {
        const api = getD2ApiFromArgs(args);
        const changes = await readOptionCodeChanges(args.mappingPath);

        const { results, summaries } = await new RecodeOptionSetsUseCase(
            new OptionSetD2Repository(api),
            new OptionSetRecodeD2Repository(api)
        ).execute({
            changes,
            includeToBeConfirmed: args.includeToBeConfirmed,
            update: args.update,
        });

        await writeRecodeReport(args.reportPath, results, summaries);

        const byStatus = _.countBy(results, result => result.status);
        logger.info(`Rows by status: ${JSON.stringify(byStatus)} (${args.update ? "updated" : "dry run"})`);
        logger.info(`Report generated: ${args.reportPath}`);
    },
});
