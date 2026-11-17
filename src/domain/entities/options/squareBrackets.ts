import { Maybe } from "utils/ts-utils";

const SQUARE_BRACKETS_GROUP = /\[([^\]]*)\]/;

/**
 * The code an option should have according to its name: the content of the first square brackets
 * group, taken literally.
 *
 * Example: `[O-MEN] Outbreak case - meningitis` gives `O-MEN`.
 *
 * Returns undefined when the name has no group, or its content is blank, which means the option is
 * left as it is.
 */
export function getCodeFromSquareBrackets(name: string): Maybe<string> {
    const content = name.match(SQUARE_BRACKETS_GROUP)?.[1];

    return content && content.trim() !== "" ? content : undefined;
}
