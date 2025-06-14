import _ from "lodash";
import { getValidationErrorFromCode, replaceByUnderScores, validateCode, validateName } from "./validation";
import { OptionSet } from "../OptionSet";
import { SettingsValidation, ValidationError, ValidationRule } from "../OptionSetValidator";
import { Project, Service } from "../Service";
import { Id } from "../Base";
import { Maybe } from "utils/ts-utils";
import { Option } from "../Option";

export class ServiceValidationStrategy {
    validate(optionSet: OptionSet, settings: SettingsValidation): ValidationError[] {
        return this.validateServiceNaming({ data: optionSet, ...settings });
    }

    private validateServiceNaming(settings: ValidateSettings): ValidationError[] {
        const { services } = settings;
        const { name, code, options } = settings.data;

        const nameError = validateName({ ...settings.data, name: name, type: "option_set" });
        const codeError = validateCode({ ...settings.data, code: code, type: "option_set" });

        // Name should always follow the format: [SERVICE_ACRONYM]- [Option Set Name] -> Example: "Acronym- Rest of Name"
        const match = name.match(/^(.+?)-\s(.+)$/) ?? [];
        const conventionNameError = this.isValidConvention({
            ...settings.data,
            regexMatch: match,
            name: name,
        });

        const codeToValidate = code ?? "";

        const [, acronym, rest] = match;
        const serviceCode = services.find(service => service.code === acronym)?.code ?? "";
        const invalidServiceError: Maybe<ValidationError> = !serviceCode
            ? {
                  ...settings.data,
                  type: "option_set",
                  rule: "invalid_service",
                  property: "name",
                  currentValue: name,
                  fixedValue: undefined,
              }
            : undefined;

        const expectedCode = this.generateServiceCode(serviceCode, rest ?? "");

        const codeValueError: Maybe<ValidationError> =
            expectedCode !== codeToValidate
                ? {
                      ...settings.data,
                      type: "option_set",
                      rule: "naming_conventions",
                      property: "code",
                      currentValue: codeToValidate,
                      fixedValue: expectedCode,
                  }
                : undefined;

        const optionErrors = options.flatMap(option => {
            return _([
                validateName({ ...option, type: "option" }),
                validateCode({ ...option, type: "option" }),
                ...this.getServiceCodeOrError(option, settings),
            ])
                .compact()
                .value();
        });

        return _([
            nameError,
            codeError,
            invalidServiceError,
            conventionNameError,
            codeValueError,
            ...optionErrors,
        ])
            .compact()
            .value();
    }

    private getBasePattern(name: string): Maybe<BasePattern> {
        return (
            this.validateStandardPattern(name) ??
            this.validatePatientMovementPattern(name) ??
            this.validatePatientOriginPattern(name) ??
            undefined
        );
    }

    private getServiceCodeOrError(option: Option, settings: ValidateSettings): ValidationError[] {
        const { name, code } = option;
        const pattern = this.getBasePattern(name);

        if (!pattern) {
            return [
                {
                    ...option,
                    currentValue: name,
                    rule: "not_pattern_found",
                    property: "name",
                    fixedValue: undefined,
                    type: "option",
                },
            ];
        }

        switch (pattern.type) {
            case "standard_pattern": {
                const { optionName, service } = pattern;
                const serviceCode = settings.services.find(s => s.code === service)?.code;
                if (!serviceCode)
                    return [
                        this.generateValidationError({
                            ...option,
                            rule: "invalid_service",
                            value: service,
                            type: "option",
                        }),
                    ];

                // [Option Name replacing special characters by underscores]_[SERVICE ACRONYM]
                const expectedCode = `${replaceByUnderScores(optionName)}_${serviceCode}`.toUpperCase();
                return _([
                    getValidationErrorFromCode({
                        ...option,
                        actualCode: code,
                        expectedCode: replaceByUnderScores(expectedCode),
                        type: "option",
                    }),
                ])
                    .compact()
                    .value();
            }
            case "patient_movement": {
                const { optionName, service, direction, projectCode } = pattern;
                const notFoundErrors = this.validateServiceAndProjects({
                    service: service,
                    project: projectCode,
                    data: option,
                    services: settings.services,
                    projects: settings.projects,
                });
                if (notFoundErrors.length > 0) return notFoundErrors;

                // [Project code]_[Option Name replacing special characters by underscores]_[IN or OUT]_[service acronym])
                const nameWithUnderScores = replaceByUnderScores(optionName);
                const expectedCode =
                    `${projectCode}_${nameWithUnderScores}_${direction}_${service}`.toUpperCase();
                return _([
                    getValidationErrorFromCode({
                        ...option,
                        actualCode: code,
                        expectedCode: replaceByUnderScores(expectedCode),
                        type: "option",
                    }),
                ])
                    .compact()
                    .value();
            }
            case "patient_origin": {
                const { projectCode, optionName, service } = pattern;

                const notFoundErrors = this.validateServiceAndProjects({
                    service: service,
                    project: projectCode,
                    data: option,
                    services: settings.services,
                    projects: settings.projects,
                });
                if (notFoundErrors.length > 0) return notFoundErrors;

                const nameWithUnderScores = replaceByUnderScores(optionName);

                // [Project code without dashes]_[Option Name replacing special characters by underscores]_[OOP]_[service acronym]
                const projectCodeWithoutDashes = projectCode.replaceAll("-", "");
                const expectedCode =
                    `${projectCodeWithoutDashes}_${nameWithUnderScores}_OOP_${service}`.toUpperCase();
                return _([
                    getValidationErrorFromCode({
                        ...option,
                        actualCode: code,
                        expectedCode: replaceByUnderScores(expectedCode),
                        type: "option",
                    }),
                ])
                    .compact()
                    .value();
            }
            default:
                console.warn(`Unknown pattern type: ${JSON.stringify(pattern, null, 2)}`);
                return [];
        }
    }

    private validateStandardPattern(name: string): Maybe<StandardPattern> {
        // [Option Name] ([service acronym])
        const pattern = /^(?<optionName>.+?)\s*\(\s*(?<service>[A-Z0-9_]+)\s*\)$/;
        const match = name.match(pattern);
        if (!match || !match.groups) return undefined;

        const { optionName, service } = match.groups;

        if (!optionName || !service) return undefined;

        return { optionName: optionName, service: service, type: "standard_pattern" };
    }

    private validatePatientMovementPattern(name: string): Maybe<PatientMovementPattern> {
        // [Project code]: [Option Name] ([IN or OUT]-[service acronym])
        // [Project code]: [Option Name] ([IN or OUT] - [service acronym])
        const pattern =
            /^(?<projectCode>[^:]+):\s*(?<optionName>.+?)\s*\(\s*(?<direction>IN|OUT)\s*-\s*(?<service>.+?)\s*\)$/;

        const match = name.match(pattern);
        if (!match?.groups) return undefined;

        const { projectCode, optionName, direction, service } = match.groups;
        return {
            projectCode: projectCode?.trim() ?? "",
            optionName: optionName?.trim() ?? "",
            direction: direction as "IN" | "OUT",
            service: service?.trim() ?? "",
            type: "patient_movement",
        };
    }

    private validatePatientOriginPattern(name: string): Maybe<PatientOriginPattern> {
        // [Project code]: [Option Name] ([OoP-[service acronym])
        // [Project code]: [Option Name] ([OoP - [service acronym])
        const pattern =
            /^(?<projectCode>[^:]+):\s*(?<optionName>.+?)\s*\(\s*(?<prefix>OoP)\s*-\s*(?<service>.+?)\s*\)$/;

        const match = name.match(pattern);
        if (!match?.groups) return undefined;

        const { projectCode, optionName, service } = match.groups;
        return {
            projectCode: projectCode?.trim() ?? "",
            optionName: optionName?.trim() ?? "",
            type: "patient_origin",
            service: service?.trim() ?? "",
        };
    }

    private generateServiceCode(acronym: string, optionSetName: string): string {
        const nameWithUnderScores = replaceByUnderScores(optionSetName);
        // Code should be: [SERVICE_ACRONYM]_[Option Set Name replacing special characters by underscores]
        return `${acronym}_${nameWithUnderScores}`.toUpperCase();
    }

    private isValidConvention(options: {
        id: Id;
        code: Maybe<string>;
        regexMatch: RegExpMatchArray;
        name: string;
    }): Maybe<ValidationError> {
        const { code, id, regexMatch, name } = options;
        return regexMatch.length === 0
            ? {
                  id: id,
                  code: code,
                  name: name,
                  type: "option_set",
                  rule: "naming_conventions",
                  property: "name",
                  currentValue: name,
                  fixedValue: undefined,
              }
            : undefined;
    }

    private generateValidationError(params: {
        id: Id;
        code: Maybe<string>;
        name: string;
        value: string;
        type: ValidationError["type"];
        rule: ValidationRule;
    }): ValidationError {
        const { id, name, code, rule, value, type } = params;
        return {
            code: code,
            id: id,
            name: name,
            type: type,
            rule: rule,
            property: "name",
            currentValue: value,
            fixedValue: undefined,
        };
    }

    private validateServiceAndProjects(params: {
        service: string;
        project: string;
        projects: Project[];
        services: Service[];
        data: Option;
    }): ValidationError[] {
        const { service, project, services, projects, data } = params;
        const serviceCode = services.find(s => s.code === service)?.code;

        const serviceError = !serviceCode
            ? this.generateValidationError({
                  ...data,
                  rule: "invalid_service",
                  value: service,
                  type: "option",
              })
            : undefined;

        const existingProjectCode = projects.find(s => s.code === project)?.code;

        const projectError = !existingProjectCode
            ? this.generateValidationError({
                  ...data,
                  rule: "invalid_project",
                  value: project,
                  type: "option",
              })
            : undefined;

        return _([serviceError, projectError]).compact().value();
    }
}

type ValidateSettings = {
    data: OptionSet;
    projects: Project[];
    services: Service[];
};

type BasePattern = StandardPattern | PatientMovementPattern | PatientOriginPattern;

type StandardPattern = {
    optionName: string;
    service: string;
    type: "standard_pattern";
};

type PatientMovementPattern = {
    optionName: string;
    service: string;
    projectCode: string;
    direction: "IN" | "OUT";
    type: "patient_movement";
};

type PatientOriginPattern = {
    optionName: string;
    service: string;
    projectCode: string;
    type: "patient_origin";
};
