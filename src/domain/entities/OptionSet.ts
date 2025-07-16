import { Maybe } from "utils/ts-utils";
import { Id } from "./Base";
import { Struct } from "./generic/Struct";
import { Option } from "./Option";
import { AggrValidationStrategy } from "./options/AggrValidationStrategy";
import { CrossValidationStrategy } from "./options/CrossValidationStrategy";
import { EDValidationStrategy } from "./options/EDValidationStrategy";

export type OptionSetAttrs = {
    id: Id;
    name: string;
    code: Maybe<string>;
    options: Option[];
    category: OptionSetCategory;
};

type OptionSetCategory = "SERVICE" | "CROSS" | "PROJECT_ED" | "AGGREGATED" | "UNKNOWN";

export class OptionSet extends Struct<OptionSetAttrs>() {
    static NAME_SEPARATOR = "- ";

    static buildWithCategory(data: OptionSet[], allowedServices: string[]): OptionSet[] {
        return data.map(optionSet => optionSet._update({ category: optionSet.getCategory(allowedServices) }));
    }

    getCategory(allowedServices: string[]): OptionSetCategory {
        switch (true) {
            case this.name.startsWith(`${EDValidationStrategy.prefix}${OptionSet.NAME_SEPARATOR}`):
                return "SERVICE";
            case this.name.startsWith(`${CrossValidationStrategy.prefix}${OptionSet.NAME_SEPARATOR}`):
                return "CROSS";
            case this.name.startsWith(`${AggrValidationStrategy.prefix}${OptionSet.NAME_SEPARATOR}`):
                return "AGGREGATED";
            case allowedServices.some(service =>
                this.name.startsWith(`${service}${OptionSet.NAME_SEPARATOR}`)
            ):
                return "SERVICE";
            default:
                return "UNKNOWN";
        }
    }

    static getUnknown(optionSets: OptionSet[]): OptionSet[] {
        return optionSets.filter(optionSet => optionSet.category === "UNKNOWN");
    }
}
