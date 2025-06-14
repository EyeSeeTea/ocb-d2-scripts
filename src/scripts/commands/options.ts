import { subcommands } from "cmd-ts";
import { analyzeOptionsCmd } from "scripts/options/analyze";

export function getCommand() {
    return subcommands({
        name: "options",
        cmds: { analyze: analyzeOptionsCmd },
    });
}
