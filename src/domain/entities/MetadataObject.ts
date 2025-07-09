import { Maybe } from "utils/ts-utils";
import { Id } from "./Base";
import { Translation } from "./Translation";

export type MetadataModel = MetadataModelType;

export interface MetadataObjectBase {
    model: MetadataModel;
    id: Id;
    name: string;
    code: Maybe<string>;
    additionalFields?: Record<string, unknown>;
}

export interface MetadataObject extends MetadataObjectBase {
    type: "common";
}

export interface UserMetadataObject extends MetadataObjectBase {
    openId: string;
    type: "user";
}

export type MetadataObjectWithType = MetadataObject | UserMetadataObject;

export interface MetadataObjectWithTranslations extends MetadataObject {
    translations: Translation[];
}

export function isUserModel(metadataObject: MetadataObject): boolean {
    return metadataObject.model === "users";
}

type MetadataModelType = typeof allowedMetadataModels[number];

export const allowedMetadataModels = [
    "attributes",
    "categories",
    "categoryCombos",
    "categoryOptionCombos",
    "categoryOptionGroupSets",
    "categoryOptionGroups",
    "categoryOptions",
    "constants",
    "dashboardItems",
    "dashboards",
    "dataApprovalLevels",
    "dataApprovalWorkflows",
    "dataElementGroupSets",
    "dataElementGroups",
    "dataElements",
    "dataSets",
    "documents",
    "eventVisualizations",
    "indicatorGroupSets",
    "indicatorGroups",
    "indicatorTypes",
    "indicators",
    "legendSets",
    "mapViews",
    "maps",
    "optionGroupSets",
    "optionGroups",
    "optionSets",
    "options",
    "organisationUnitGroupSets",
    "organisationUnitGroups",
    "organisationUnitLevels",
    "organisationUnits",
    "programIndicatorGroups",
    "programIndicators",
    "programRuleActions",
    "programRuleVariables",
    "programRules",
    "programSections",
    "programStageSections",
    "programStages",
    "programs",
    "relationshipTypes",
    "sections",
    "sqlViews",
    "trackedEntityAttributes",
    "trackedEntityTypes",
    "userGroups",
    "userRoles",
    "users",
    "validationRuleGroups",
    "validationRules",
    "visualizations",
] as const;

export function getMetadataModelFromString(modelToCheck: string): Maybe<MetadataModel> {
    const model = allowedMetadataModels.find(model => model === modelToCheck);
    return model;
}
