import fs from "fs/promises";
import { createArrayCsvStringifier } from "csv-writer";
import _ from "lodash";
import logger from "utils/log";
import { OptionSetValidator, ValidationError } from "domain/entities/OptionSetValidator";
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
                "Category",
                "Option Set ID",
                "Option Set Code",
                "Option Set Name",
                "Option Id",
                "Option Code",
                "Option Name",
                "Property Error",
                "Error Type",
                "Value to Update",
            ],
        });

        const header = optionStringifier.getHeaderString();

        const rows = results.flatMap(({ optionSet, errors }) => {
            const optionSetErrorsById = _(errors)
                .filter(error => error.type === "option_set")
                .groupBy(error => error.id)
                .value();

            const optionErrorsById = _(errors)
                .filter(error => error.type === "option")
                .groupBy(error => error.id)
                .value();

            // const errorsById = _.groupBy(optionErrors, "id");

            const optionSetUniqueError = _(optionSetErrorsById)
                .flatMap(groupedErrors => {
                    return optionStringifier.stringifyRecords([
                        this.generateUniqueRowFromValidationErrors({
                            optionSet,
                            errors: groupedErrors,
                        }),
                    ]);
                })
                .compact()
                .value();

            const optionUniqueError = _(optionErrorsById)
                .flatMap(groupedErrors => {
                    return optionStringifier.stringifyRecords([
                        this.generateUniqueRowFromValidationErrors({
                            optionSet,
                            errors: groupedErrors,
                        }),
                    ]);
                })
                .compact()
                .value();

            return [...optionSetUniqueError, ...optionUniqueError].join("");
            // const allErrors = errors.map(error => {
            //     const row = optionStringifier.stringifyRecords([
            //         [
            //             error.type,
            //             optionSet.category,
            //             optionSet.id,
            //             optionSet.code ?? "",
            //             optionSet.name,
            //             error.type === "option" ? error.id : "",
            //             error.type === "option" ? error.code : "",
            //             error.type === "option" ? error.name : "",
            //             error.property,
            //             error.rule,
            //             error.fixedValue,
            //         ],
            //     ]);
            //     return row;
            // });
            // return allErrors.join("");
        });

        return [header, ...rows].join("");
    }

    private generateUniqueRowFromValidationErrors(params: {
        optionSet: OptionSet;
        errors: ValidationError[];
    }): string[] {
        const { optionSet, errors } = params;
        const firstRecord = errors[0];

        if (!firstRecord) return [];

        return [
            firstRecord.type,
            optionSet.category,
            optionSet.id,
            optionSet.code ?? "",
            optionSet.name,
            firstRecord.type === "option" ? firstRecord.id : "",
            firstRecord.type === "option" ? firstRecord.code ?? "" : "",
            firstRecord.type === "option" ? firstRecord.name : "",
            _(errors)
                .map(error => error.property)
                .uniq()
                .join(", "),
            firstRecord.type,
            _(errors)
                .map(error => error.fixedValue)
                .compact()
                .join(", "),
        ];
    }
}
