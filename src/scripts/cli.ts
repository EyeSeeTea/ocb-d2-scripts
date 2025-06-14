import path from "path";
import { run, subcommands } from "cmd-ts";

import * as options from "./commands/options";
import * as metadata from "./commands/metadata";

export function runCli() {
    const cliSubcommands = subcommands({
        name: path.basename(__filename),
        cmds: {
            options: options.getCommand(),
            metadata: metadata.getCommand(),
        },
    });

    const args = process.argv.slice(2);
    run(cliSubcommands, args);
}
