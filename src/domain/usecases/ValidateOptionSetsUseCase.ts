import _ from "lodash";
import { OptionSet } from "domain/entities/OptionSet";
import { OptionSetRepository } from "domain/repositories/OptionSetRepository";
import { Async } from "domain/entities/Async";
import { Option } from "domain/entities/Option";
import { OptionRepository } from "domain/repositories/OptionRepository";
import { OptionSetValidator } from "domain/entities/OptionSetValidator";
import { Exceptions, Project, Service } from "domain/entities/Service";
import { promiseMap } from "data/dhis2-utils";
import logger from "utils/log";

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
        const { unknown, otherCategories } = this.splitOptionSets(optionSetsWithCategory);

        const optionSetValidations = otherCategories.flatMap(optionSet =>
            OptionSetValidator.build(optionSet, options)
        );

        return { unknown, optionSetValidations, optionSets: otherCategories };
    }

    private splitOptionSets(optionSets: OptionSet[]): { unknown: OptionSet[]; otherCategories: OptionSet[] } {
        const unknown = OptionSet.getUnknown(optionSets);
        const otherCategories = optionSets.filter(optionSet => !unknown.some(u => u.id === optionSet.id));
        return { unknown, otherCategories };
    }

    private async saveOptions(
        options: UseCaseOptions,
        optionSets: OptionSet[],
        validationResults: OptionSetValidator[]
    ): Async<void> {
        if (!options.update) return;

        const optionsToSave = this.fixAndGetOptions(optionSets, validationResults);
        await promiseMap(optionsToSave, async option => {
            await this.optionRepository.save(option, { dryRun: !options.update });
        });
    }

    private fixAndGetOptions(optionSets: OptionSet[], validationResults: OptionSetValidator[]): Option[] {
        const optionsById = _(optionSets)
            .flatMap(optionSet => optionSet.options)
            .keyBy(option => option.id)
            .value();

        return validationResults.flatMap((validationResult): Option[] => {
            const onlyFixableErrors = _(validationResult.errors)
                .filter(error => error.type === "option")
                .groupBy(error => error.id)
                .filter(errors => errors.every(error => error.property === "code"))
                .map(errors => errors.find(error => error.fixedValue))
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
}

type UseCaseOptions = {
    update: boolean;
    services: Service[];
    projects: Project[];
    exceptions: Exceptions[];
};

export type ValidationOptionSetResponse = {
    optionSetValidations: OptionSetValidator[];
    unknown: OptionSet[];
};
