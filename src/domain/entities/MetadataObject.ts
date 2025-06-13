import { Maybe } from "utils/ts-utils";
import { Id } from "./Base";
import { Translation } from "./Translation";

export type MetadataModel = string; // Ex: "dataElements".

export interface MetadataObject {
    model: MetadataModel;
    id: Id;
    name: string;
    code: Maybe<string>;
    additionalFields?: Record<string, unknown>;
    openId: string;
}

export interface UserMetadataObject extends MetadataObject {
    openId: string;
    type: "user";
}

export interface MetadataObjectWithTranslations extends MetadataObject {
    translations: Translation[];
}

export function isUserModel(metadataObject: MetadataObject): boolean {
    return metadataObject.model === "users";
}
