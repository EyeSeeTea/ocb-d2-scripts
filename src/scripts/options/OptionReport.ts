import fs from "fs/promises";
import { createArrayCsvStringifier } from "csv-writer";
import _ from "lodash";
import logger from "utils/log";
import { OptionSetValidator } from "domain/entities/OptionSetValidator";
import { ValidationOptionSetResponse } from "domain/usecases/ValidateOptionSetsUseCase";
import { OptionSet } from "domain/entities/OptionSet";

export class OptionSetValidatorReport {
    async generateReport(options: {
        validationResponse: ValidationOptionSetResponse;
        csvPath: string;
        csvUnknownPath: string;
    }): Promise<void> {
        const { validationResponse, csvPath, csvUnknownPath } = options;
        const { optionSetValidations, unknown } = validationResponse;
        const csvString = this.buildCsvFromErrors(optionSetValidations);
        const unknownCsvString = this.generateUnknownCsv(unknown);
        await fs.writeFile(csvPath, csvString, "utf-8");
        await fs.writeFile(csvUnknownPath, unknownCsvString, "utf-8");

        logger.info(`Report generated: ${csvPath}`);
    }

    private generateUnknownCsv(optionSets: OptionSet[]): string {
        const unknownStringifier = createArrayCsvStringifier({
            header: ["Option Set ID", "Option Set Code", "Option Set Name"],
        });

        const header = unknownStringifier.getHeaderString();
        const rows = optionSets
            .map(optionSet => {
                return unknownStringifier.stringifyRecords([
                    [optionSet.id, optionSet.code ?? "", optionSet.name],
                ]);
            })
            .join("");

        return [header, rows].join("");
    }

    private buildCsvFromErrors(results: OptionSetValidator[]): string {
        const optionStringifier = createArrayCsvStringifier({
            header: [
                "Metadata",
                "Option Set ID",
                "Option Set Code",
                "Option Set Name",
                "Category",
                "Option Code",
                "Option Id",
                "Option Name",
                "Property Error",
                "Error Type",
                "Value to Update",
            ],
        });

        const header = optionStringifier.getHeaderString();

        const rows = results.flatMap(({ optionSet, errors }) => {
            const allErrors = errors.map(error => {
                const row = optionStringifier.stringifyRecords([
                    [
                        error.type,
                        optionSet.id,
                        optionSet.code ?? "",
                        optionSet.name,
                        optionSet.category,
                        error.type === "option" ? error.code : "",
                        error.type === "option" ? error.id : "",
                        error.type === "option" ? error.name : "",
                        error.property,
                        error.rule,
                        error.fixedValue,
                    ],
                ]);
                return row;
            });
            return allErrors.join("");
        });

        return [header, ...rows].join("");
    }
}
