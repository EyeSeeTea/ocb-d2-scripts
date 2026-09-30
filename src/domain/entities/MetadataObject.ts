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
    openId: Maybe<string>;
    type: "user";
}

export type MetadataObjectWithType = MetadataObject | UserMetadataObject;

export interface MetadataObjectWithTranslations extends MetadataObject {
    translations: Translation[];
}

/*
    A metadata object with its comparison identifier already resolved, so comparisons never
    have to deal with objects that cannot be identified.
*/
export type ComparableMetadataObject = Readonly<{
    identifier: string;
    object: MetadataObjectWithType;
}>;

/*
    Identifier used to match objects between servers: the OIDC identifier (openId) for users
    and the DHIS2 uid for the rest. Users without an OIDC identifier cannot be matched, so they
    have no comparison identifier and must be excluded from the comparison.
*/
export function getComparisonIdentifier(metadataObject: MetadataObjectWithType): Maybe<string> {
    const identifier = metadataObject.type === "user" ? metadataObject.openId : metadataObject.id;
    return identifier || undefined;
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
