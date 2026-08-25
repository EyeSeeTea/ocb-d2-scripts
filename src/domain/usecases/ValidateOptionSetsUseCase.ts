import _ from "lodash";
import { OptionSet } from "domain/entities/OptionSet";
import { OptionSetRepository } from "domain/repositories/OptionSetRepository";
import { Async } from "domain/entities/Async";
import { Option } from "domain/entities/Option";
import { OptionRepository } from "domain/repositories/OptionRepository";
import { OptionSetValidator, ValidationMode } from "domain/entities/OptionSetValidator";
import { Exceptions, Project, Service } from "domain/entities/Service";
import { promiseMap } from "data/dhis2-utils";
import logger from "utils/log";
import { Maybe } from "utils/ts-utils";

export class ValidateOptionSetsUseCase {
    constructor(
        private readonly optionSetRepository: OptionSetRepository,
        private readonly optionRepository: OptionRepository
    ) {}

    async execute(options: UseCaseOptions): Async<ValidationOptionSetResponse> {
        logger.info("Fetching all option sets...");
        const optionsSets = await this.optionSetRepository.getAll();
        const validationResult = this.getOptionSetValidators(optionsSets, options);

        if (options.update) {
            await this.saveOptions(
                options,
                validationResult.optionSets,
                validationResult.optionSetValidations
            );
        }

        return validationResult;
    }

    private getOptionSetValidators(
        optionSets: OptionSet[],
        options: UseCaseOptions
    ): ValidationOptionSetResponse & { optionSets: OptionSet[] } {
        const serviceCodes = options.services.map(service => service.code);
        const optionSetsWithCategory = OptionSet.buildWithCategory(optionSets, serviceCodes);
        const { unknown, toValidate } = this.splitOptionSets(optionSetsWithCategory, options.mode);

        const optionSetValidations = toValidate.flatMap(optionSet =>
            OptionSetValidator.build(optionSet, options)
        );

        return { unknown, optionSetValidations, optionSets: toValidate };
    }

    /**
     * The category conventions only apply to the option sets that have a category, so the unknown
     * ones are set apart and just listed in their own report. The square brackets rule does not
     * depend on the category, so there every option set is validated.
     */
    private splitOptionSets(
        optionSets: OptionSet[],
        mode: ValidationMode
    ): { unknown: OptionSet[]; toValidate: OptionSet[] } {
        if (mode === "square_brackets") return { unknown: [], toValidate: optionSets };

        const unknown = OptionSet.getUnknown(optionSets);
        const toValidate = optionSets.filter(optionSet => !unknown.some(u => u.id === optionSet.id));
        return { unknown, toValidate };
    }

    private async saveOptions(
        options: UseCaseOptions,
        optionSets: OptionSet[],
        validationResults: OptionSetValidator[]
    ): Async<void> {
        if (!options.update) return;

        const optionsToSave = this.fixAndGetOptions(optionSets, validationResults, options.mode);
        const optionSetsToSave = this.fixAndGetOptionSets(optionSets, validationResults);

        logger.debug(`Options to update: ${optionSetsToSave.length}`);

        await this.optionSetRepository.save(optionSetsToSave, { dryRun: !options.update });

        await promiseMap(optionsToSave, async option => {
            await this.optionRepository.save(option, { dryRun: !options.update });
        });
    }

    private fixAndGetOptions(
        optionSets: OptionSet[],
        validationResults: OptionSetValidator[],
        mode: ValidationMode
    ): Option[] {
        const optionsById = _(optionSets)
            .flatMap(optionSet => optionSet.options)
            .keyBy(option => option.id)
            .value();

        return validationResults.flatMap((validationResult): Option[] => {
            const onlyFixableErrors = _(validationResult.errors)
                .filter(error => error.type === "option")
                .groupBy(error => error.id)
                // With the category conventions an option is only fixed when every error it has is
                // about its code. The square brackets rule fixes the code on its own, so an option
                // is not skipped because of the errors of its name.
                .filter(errors => mode === "square_brackets" || errors.every(e => e.property === "code"))
                .map(errors => errors.find(error => error.property === "code" && error.fixedValue))
                .compact()
                .value();

            return _(onlyFixableErrors)
                .map(error => {
                    const option = optionsById[error.id];
                    if (!option || !error.fixedValue) return undefined;

                    return { ...option, code: error.fixedValue };
                })
                .compact()
                .value();
        });
    }

    private fixAndGetOptionSets(
        optionSets: OptionSet[],
        validationResults: OptionSetValidator[]
    ): OptionSet[] {
        const optionSetsById = _(optionSets)
            .keyBy(optionSet => optionSet.id)
            .value();

        return validationResults.flatMap((validationResult): OptionSet[] => {
            const onlyFixableErrors = _(validationResult.errors)
                .filter(error => error.type === "option_set")
                .groupBy(error => error.id)
                .filter(errors => errors.every(error => error.property === "code"))
                .map(errors => errors.find(error => error.fixedValue))
                .compact()
                .value();

            return _(onlyFixableErrors)
                .map((error): Maybe<OptionSet> => {
                    const option = optionSetsById[error.id];
                    if (!option || !error.fixedValue) return undefined;

                    return OptionSet.create({ ...option, code: error.fixedValue });
                })
                .compact()
                .value();
        });
    }
}

type UseCaseOptions = {
    update: boolean;
    mode: ValidationMode;
    services: Service[];
    projects: Project[];
    exceptions: Exceptions[];
};

export type ValidationOptionSetResponse = {
    optionSetValidations: OptionSetValidator[];
    unknown: OptionSet[];
};
