import { subcommands } from "cmd-ts";
import { analyzeOptionsCmd } from "scripts/options/analyze";
import { recodeOptionsCmd } from "scripts/options/recode";

export function getCommand() {
    return subcommands({
        name: "options",
        cmds: { analyze: analyzeOptionsCmd, recode: recodeOptionsCmd },
    });
}
