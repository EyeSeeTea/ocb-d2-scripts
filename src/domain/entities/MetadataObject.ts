import { Maybe } from "utils/ts-utils";
import { Id } from "./Base";
import { Translation } from "./Translation";

export type MetadataModel = string; // Ex: "dataElements".

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
