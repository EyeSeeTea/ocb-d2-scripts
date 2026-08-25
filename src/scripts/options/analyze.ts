import _ from "lodash";
import CsvReadableStream from "csv-reader";
import { createReadStream } from "fs";
import { command, string, option, flag, boolean } from "cmd-ts";
import { getApiUrlOptions, getD2ApiFromArgs } from "scripts/common";
import { ValidateOptionSetsUseCase } from "domain/usecases/ValidateOptionSetsUseCase";
import { OptionSetD2Repository } from "data/OptionSetD2Repository";
import logger from "utils/log";
import { OptionD2Repository } from "data/OptionD2Repository";
import { Maybe } from "utils/ts-utils";
import { Service } from "domain/entities/Service";
import { OptionSetValidatorReport } from "./OptionReport";
import { ValidationMode } from "domain/entities/OptionSetValidator";

export const analyzeOptionsCmd = command({
    name: "analyze",
    description: "Analyze optionSet/options codes and names",
    args: {
        ...getApiUrlOptions(),
        reportPath: option({
            type: string,
            long: "report-path",
            description: "Path to save the report",
            defaultValue: () => "optionset-report.csv",
        }),
        unknownReportPath: option({
            type: string,
            long: "unknown-report-path",
            description: "Path to save the report with unknown optionSets",
            defaultValue: () => "unknown-optionset-report.csv",
        }),
        update: flag({
            long: "update",
            description: "Persist changes",
            defaultValue: () => false,
            type: boolean,
        }),
        squareBrackets: flag({
            long: "square-brackets",
            description:
                "Set the code of every option to the content of the square brackets of its name. Replaces the category conventions and does not use the services/projects csv files",
            defaultValue: () => false,
            type: boolean,
        }),
        servicesPath: option({
            type: string,
            long: "services-path",
            description: "Path to the csv file with services. Not used with --square-brackets",
            defaultValue: () => "",
        }),
        projectsPath: option({
            type: string,
            long: "projects-path",
            description: "Path to the csv file with projects. Not used with --square-brackets",
            defaultValue: () => "",
        }),
        exceptionsPath: option({
            type: string,
            long: "exceptions-path",
            description: "Path to the csv file with exceptions",
            defaultValue: () => "",
        }),
    },
    handler: async args => {
        const { exceptionsPath, servicesPath, projectsPath } = args;
        const mode: ValidationMode = args.squareBrackets ? "square_brackets" : "categories";

        // The square brackets mode does not use the category conventions, so it needs none of the csv files.
        const usesCategories = mode === "categories";
        const services = usesCategories ? await readNamedRefFromCsv(servicesPath) : [];
        const projects = usesCategories ? await readNamedRefFromCsv(projectsPath) : [];
        const exceptions = usesCategories && exceptionsPath ? await readNamedRefFromCsv(exceptionsPath) : [];

        const api = getD2ApiFromArgs(args);
        const optionSetRepository = new OptionSetD2Repository(api);
        const optionRepository = new OptionD2Repository(api);

        const optionSetValidations = await new ValidateOptionSetsUseCase(
            optionSetRepository,
            optionRepository
        ).execute({
            update: args.update,
            mode,
            services,
            projects,
            exceptions,
        });

        if (optionSetValidations.optionSetValidations.length > 0 || optionSetValidations.unknown.length > 0) {
            await new OptionSetValidatorReport().generateReport({
                csvPath: args.reportPath,
                csvUnknownPath: args.unknownReportPath,
                validationResponse: optionSetValidations,
            });
        } else {
            logger.info("No invalid options found");
        }
    },
});

function readNamedRefFromCsv(csvPath: Maybe<string>): Promise<Service[]> {
    if (!csvPath) return Promise.reject(new Error("CSV path is required"));
    const inputStream = createReadStream(csvPath, "utf8");
    const results: Service[] = [];

    return new Promise((resolve, reject) => {
        inputStream
            .pipe(new CsvReadableStream({ parseNumbers: true, parseBooleans: true, trim: true }))
            .on("data", row => {
                const data = row as string[];
                const firstValue = data[0] ?? "";
                const secondValue = data[1] ?? firstValue;
                results.push({ code: firstValue, name: secondValue });
            })
            .on("error", error => {
                console.error(`Error reading CSV file: ${error.message}`);
                reject(error);
            })
            .on("end", () => {
                resolve(results);
            });
    });
}
