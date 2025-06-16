import { D2Api } from "../../../types/d2-api";
import _ from "lodash";
import { command, string, option, Type } from "cmd-ts";
import { buildAuthFromString, buildD2Api } from "scripts/common";
import { MetadataD2Repository } from "data/MetadataD2Repository";
import fs from "fs";
import { SyncMetadataUseCase } from "domain/usecases/SyncMetadataUseCase";
import { SyncReport } from "./SyncReport";
import CsvReadableStream from "csv-reader";
import { Async } from "domain/entities/Async";

type MetadataServer = {
    url: string;
    auth: string;
    personalToken: string;
    isMain: boolean;
    useProxy: boolean;
};

const ModelsSeparatedByCommas: Type<string, string[]> = {
    async from(str) {
        if (str === "all") return getAllMetadataModels();

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
    },
    handler: async args => {
        const modelsToCheck = await getModelsToCheck(args.ignoreModelsPath, args.modelsToCheck);
        const metadataReposFromFile = getRepositoriesFromJsonFile(args.serverConfig);
        const report = await new SyncMetadataUseCase(
            metadataReposFromFile.mainMetadataRepository,
            metadataReposFromFile.repositories
        ).execute({ modelsToCheck: modelsToCheck });

        new SyncReport().generateCsvReports(report);
    },
});

async function getModelsToCheck(ignoreModelsPath: string, modelsToCheck: string[]): Promise<string[]> {
    const modelsToIgnore = ignoreModelsPath ? await getModelsToIgnoreFromCsv(ignoreModelsPath) : [];
    return _.difference(modelsToCheck, modelsToIgnore);
}

function getRepositoriesFromJsonFile(jsonFilePath: string) {
    const serverContentFile = fs.readFileSync(jsonFilePath, "utf8");
    const { servers } = JSON.parse(serverContentFile) as unknown as { servers: MetadataServer[] };
    const mainServers = servers.filter(server => server.isMain);
    const mainServer = mainServers[0];
    if (mainServers.length !== 1 || !mainServer)
        throw new Error(
            "Only one server can be the main one. Set isMain: true to the server you want to be the main one"
        );

    return {
        mainMetadataRepository: new MetadataD2Repository(d2ApiFromServer(mainServer)),
        repositories: servers
            .filter(server => !server.isMain)
            .map(server => new MetadataD2Repository(d2ApiFromServer(server))),
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

function d2ApiFromServer(server: MetadataServer): D2Api {
    return buildD2Api({
        useProxy: server.useProxy,
        backend: "xhr",
        baseUrl: server.url,
        auth: server.auth
            ? buildAuthFromString(server.auth)
            : { type: "personalToken", token: server.personalToken },
    });
}

function getAllMetadataModels(): string[] {
    return [
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
    ];
}
