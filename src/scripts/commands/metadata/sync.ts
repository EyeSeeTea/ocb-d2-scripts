import _ from "lodash";
import { command, string, option, Type, flag, optional, oneOf } from "cmd-ts";
import { MetadataD2Repository } from "data/MetadataD2Repository";
import fs from "fs";
import { SyncMetadataUseCase } from "domain/usecases/SyncMetadataUseCase";
import { SyncReport } from "./SyncReport";
import CsvReadableStream from "csv-reader";
import { Async } from "domain/entities/Async";
import { Instance } from "domain/entities/Instance";
import {
    allowedMetadataModels,
    getMetadataModelFromString,
    MetadataModel,
} from "domain/entities/MetadataObject";

const ModelsSeparatedByCommas: Type<string, string[]> = {
    async from(str) {
        if (str === "all") return getAllMetadataModelsString();

        const values = _.compact(str.split(","));
        if (_(values).isEmpty()) throw new Error("Value cannot be empty");
        return values;
    },
};

export const syncMetadata = command({
    name: "sync",
    description: "Sync metadata between DHIS2 instances",
    args: {
        modelsToCheck: option({
            type: ModelsSeparatedByCommas,
            long: "check-models",
            description:
                "DHIS2 models, comma-separated (dataSets, organisationUnits, users, ...). Use 'all' to check all models",
        }),
        serverConfig: option({
            type: string,
            long: "server-config",
            description: "Path to the JSON file with server configurations",
        }),
        ignoreModelsPath: option({
            type: string,
            long: "ignore-models",
            description: "Path to csv file with DHIS2 models to ignore (optional)",
            defaultValue: () => "",
        }),
        action: option({
            type: optional(oneOf(["CREATE", "CREATE_AND_UPDATE", "DELETE"])),
            long: "action",
            description: "Action to perform (CREATE | CREATE_AND_UPDATE | DELETE)",
        }),
        persist: flag({
            long: "persist",
            description: "Persist changes to the server.",
        }),
    },
    handler: async args => {
        const modelsToCheck = await getModelsToCheck(args.ignoreModelsPath, args.modelsToCheck);
        const metadataReposFromFile = getRepositoriesFromJsonFile(args.serverConfig);

        const report = await new SyncMetadataUseCase(
            metadataReposFromFile.mainMetadataRepository,
            metadataReposFromFile.repositories
        ).execute({ modelsToCheck: modelsToCheck, action: args.action, persist: args.persist });

        new SyncReport().generateReports(report);
    },
});

async function getModelsToCheck(ignoreModelsPath: string, modelsToCheck: string[]): Promise<MetadataModel[]> {
    const modelsToIgnore = ignoreModelsPath ? await getModelsToIgnoreFromCsv(ignoreModelsPath) : [];
    const models = _.difference(modelsToCheck, modelsToIgnore);

    return _(models)
        .map(model => {
            return getMetadataModelFromString(model);
        })
        .compact()
        .value();
}

function getRepositoriesFromJsonFile(jsonFilePath: string) {
    const serverContentFile = fs.readFileSync(jsonFilePath, "utf8");
    const { servers } = JSON.parse(serverContentFile) as unknown as {
        servers: Instance[];
    };
    const mainServers = servers.filter(server => server.isMain);
    const mainServer = mainServers[0];
    if (mainServers.length !== 1 || !mainServer)
        throw new Error(
            "Only one server can be the main one. Set isMain: true to the server you want to be the main one"
        );

    return {
        mainMetadataRepository: new MetadataD2Repository(mainServer),
        repositories: servers
            .filter(server => !server.isMain)
            .map(server => new MetadataD2Repository(server)),
    };
}

async function getModelsToIgnoreFromCsv(csvPath: string): Async<string[]> {
    return new Promise((resolve, reject) => {
        const allModels: string[] = [];
        return fs
            .createReadStream(csvPath, "utf8")
            .pipe(new CsvReadableStream({ trim: true }))
            .on("data", row => {
                const value = row as unknown as string;
                const firstValue = value[0];
                if (firstValue) {
                    allModels.push(firstValue);
                }
            })
            .on("end", () => resolve(allModels))
            .on("error", reject);
    });
}

function getAllMetadataModelsString(): string[] {
    return allowedMetadataModels.map(model => model);
}
