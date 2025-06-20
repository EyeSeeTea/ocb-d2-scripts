import _ from "lodash";
import { D2Api, DataValueSetsDataValue, MetadataPick, D2TrackerEventToPost } from "../types/d2-api";
import { Async } from "domain/entities/Async";
import { Id } from "domain/entities/Base";
import { promiseMap } from "./dhis2-utils";
import { saveJsonToDisk } from "./files";

/**
 * Rename the code in DHIS2 option model and related metadata/data.
 *
 * DHIS2 uses the option code as a value in many places, which is why renaming is disabled in the UI.
 *
 * The following order of actions must be followed to avoid validation errors:
 *
 * 1) Retrieve the data
 * 2) Update the option metadata
 * 3) Update the data
 * 4) rollback if an error occurs (save json to disk and persist initial data)
 *    Initial data is always saved to disk as a backup in case rollback cannot be performed.
 *
 * Tasks:
 *
 * - Metadata: Rename the option code
 * - Data values: Recode the associated code used as dataValues[].value
 * - Events: Recode the associated code used as dataValues[].value
 * - Metadata: Recode the attribute values associated with the option (TODO)
 * - Tracker: Recode the associated tracked entity attributes (TODO)
 */

export class D2RenameOptionCode {
    constructor(private api: D2Api, private options: { dryRun: boolean }) {}

    async execute(options: RecodeOptions): Async<void> {
        const { option } = options;
        const metadata = await this.getMetadata(option);

        const optionsWithMetadataValues = await this.getOptionsWithMetadata({ ...options, metadata });

        this.saveDataToDisk(optionsWithMetadataValues);

        await this.recodeOption(optionsWithMetadataValues).catch(err => {
            console.debug(`Error recoding option: ${JSON.stringify(err, null, 4)}`);
            return this.rollback(optionsWithMetadataValues);
        });
    }

    private async getOptionsWithMetadata(
        options: RecodeOptionsWithMetadata
    ): Async<OptionsWithMetadataValues> {
        const { option, toCode, metadata } = options;

        const dataValues = await this.getDataValues(options);
        const events = await this.getEvents(options);

        return {
            option: option,
            toCode: toCode,
            metadata: metadata,
            initialDataValues: dataValues,
            initialEvents: events,
        };
    }

    private async recodeOption(options: OptionsWithMetadataValues): Async<void> {
        const { option } = options;

        console.debug(`Rename option [id=${option.id}]: ${option.code} -> ${options.toCode}`);

        // Get data
        const dataValues = await this.recodeDataValuesGet(options);
        const events = await this.recodeEventsGet(options);

        // Update metadata
        await this.saveOption(options);

        // Update data
        await this.postDataValues(dataValues);
        await this.postEvents(events);
    }

    /* Private methods */

    private async getMetadata(option: D2Option) {
        const optionSet = await this.getOptionSetForOption(option);

        return this.api.metadata
            .get({
                options: {
                    ...metadataQuery.options,
                    filter: { id: { eq: option.id } },
                },
                dataElements: {
                    ...metadataQuery.dataElements,
                    filter: { "optionSet.id": { eq: optionSet.id } },
                },
                trackedEntityAttributes: {
                    ...metadataQuery.trackedEntityAttributes,
                    filter: { "optionSet.id": { eq: optionSet.id } },
                },
                organisationUnits: {
                    ...metadataQuery.organisationUnits,
                    filter: { level: { eq: "1" } },
                },
            })
            .getData();
    }

    private async getOptionSetForOption(option: D2Option) {
        const { optionSets } = await this.api.metadata
            .get({
                optionSets: {
                    fields: { id: true },
                    filter: { "options.id": { eq: option.id } },
                },
            })
            .getData();

        const optionSet = optionSets[0];
        if (!optionSet) throw new Error(`Option with id ${option.id} not found`);

        return optionSet;
    }

    private get dryRun(): boolean {
        return this.options.dryRun;
    }

    private async saveOption(options: RecodeOptionsWithMetadata): Async<void> {
        if (this.dryRun) return;
        const option = options.metadata.options[0];
        if (!option) throw new Error("Option not found");

        const optionUpdated: typeof option = { ...option, code: options.toCode };
        const res = await this.api.metadata.post({ options: [optionUpdated] }).getData();
        console.debug(`[options] Save ${option.name}: ${JSON.stringify(res.status)}`);

        if (res.status !== "OK") throw new Error(`Failed to save option: ${JSON.stringify(res)}`);
    }

    private async getDataValues(options: RecodeOptionsWithMetadata): Async<DataValueSetsDataValue[]> {
        const { option, metadata } = options;

        const dataElementsForAggregated = metadata.dataElements.filter(dataElement => {
            return dataElement.domainType === "AGGREGATE";
        });

        if (dataElementsForAggregated.length === 0) {
            console.debug("[recodeDataValues] No data elements for aggregated domain found");
            return [];
        }

        const rootOrgUnitId = metadata.organisationUnits[0]?.id;
        if (!rootOrgUnitId) throw new Error("[recodeDataValues] Root org unit not found");

        const msg = `[recodeDataValues] Get data values for ${dataElementsForAggregated.length} data elements`;
        console.debug(msg);

        const { dataValues } = await this.api.dataValues
            .getSet({
                dataSet: [],
                dataElement: dataElementsForAggregated.map(dataElement => dataElement.id),
                orgUnit: [rootOrgUnitId],
                children: true,
                startDate: "1900",
                endDate: (new Date().getFullYear() + 100).toString(),
            })
            .getData();

        const size = dataElementsForAggregated.length;
        const names = dataElementsForAggregated.map(de => de.name).join(", ");
        console.debug(`[recodeDataValues] Process data values for ${size} data elements: ${names}`);

        const dataElementIds = new Set(dataElementsForAggregated.map(dataElement => dataElement.id));
        return dataValues.filter(dataValue => {
            return dataElementIds.has(dataValue.dataElement) && dataValue.value == option.code;
        });
    }

    private async recodeDataValuesGet(options: OptionsWithMetadataValues): Async<DataValueSetsDataValue[]> {
        const { toCode, initialDataValues } = options;

        const dataValuesUpdated = initialDataValues.map(dataValue => ({ ...dataValue, value: toCode }));

        console.debug(`[recodeDataValues] Data values to update: ${dataValuesUpdated.length}`);

        return dataValuesUpdated;
    }

    private async postDataValues(dataValues: DataValueSetsDataValue[]): Async<void> {
        console.debug(`[recodeDataValues] Data values to post: ${dataValues.length}`);

        if (this.dryRun) {
            console.debug(`[recodeDataValues] Dry run`);
            return;
        } else if (dataValues.length === 0) {
            console.debug(`[recodeDataValues] No data values to post`);
            return;
        } else {
            const res = await this.api.dataValues.postSet({}, { dataValues: dataValues }).getData();
            console.debug(`[recodeDataValues] Data values post response: ${JSON.stringify(res.importCount)}`);
        }
    }

    private async getEvents(options: RecodeOptionsWithMetadata): Async<D2Event[]> {
        const { option } = options;

        const dataElementsForPrograms = options.metadata.dataElements.filter(dataElement => {
            return dataElement.domainType === "TRACKER";
        });

        const eventGroups = await promiseMap(dataElementsForPrograms, async dataElement => {
            console.debug(`[recodeEvents: dataElement=${dataElement.name}] Get events (name=${option.name})`);

            const { instances: events } = await this.api.tracker.events
                .get({
                    fields: { $all: true },
                    // Even though the code is used as value, the API expects the name to be passed as filter value.

                    filter: `${dataElement.id}:EQ:${escapeTrackerFilterValue(option.name)}`,
                    pageSize: 100_000,
                })
                .getData();

            console.debug(`[recodeEvents: dataElement=${dataElement.name}] Events: ${events.length}`);

            const eventsRecoded = _(events)
                .map((event): typeof event | null => {
                    const dataValues = event.dataValues.filter(dataValue => {
                        return dataValue.dataElement === dataElement.id && dataValue.value == option.code;
                    });

                    return { ...event, dataValues: dataValues };
                })
                .compact()
                .value();

            return eventsRecoded;
        });

        return _.flatten(eventGroups);
    }

    private async recodeEventsGet(options: OptionsWithMetadataValues): Async<D2Event[]> {
        const { toCode, initialEvents } = options;

        const eventsRecoded = _(initialEvents)
            .map(event => {
                const dataValuesRecoded = event.dataValues.map(dataValue => {
                    return { ...dataValue, value: toCode };
                });
                return { ...event, dataValues: dataValuesRecoded };
            })
            .compact()
            .value();

        console.debug(`[recodeEvents] Events to update: ${eventsRecoded.length}`);
        return eventsRecoded;
    }

    private async postEvents(events: D2Event[]): Async<void> {
        console.debug(`[recodeEvents] Events to post: ${events.length}`);

        if (this.dryRun) {
            console.debug(`[recodeEvents] Dry run`);
            return;
        } else if (events.length === 0) {
            console.debug(`[recodeEvents] No events to post`);
            return;
        } else {
            const opts = { skipPatternValidation: true, skipRuleEngine: true, skipSideEffects: true };
            const res = await this.api.tracker.post(opts, { events: events }).getData();
            console.debug(`[recodeEvents] Post response: ${JSON.stringify(res.stats)}`);
        }
    }

    private async rollback(options: OptionsWithMetadataValues) {
        const { option, metadata, initialDataValues, initialEvents } = options;

        console.debug("[rollback] Executing rollback...");

        await this.saveOption({ ...options, toCode: option.code, metadata });
        await this.postDataValues(initialDataValues);
        await this.postEvents(initialEvents);

        console.debug("[rollback] Rollback completed");
    }

    private saveDataToDisk(options: OptionsWithMetadataValues): void {
        const { option, initialDataValues, initialEvents } = options;

        saveJsonToDisk(`dataValues_${option.id}`, { dataValues: initialDataValues });
        saveJsonToDisk(`events_${option.id}`, { events: initialEvents });

        console.debug(`Initial data saved to disk: option, dataValues and events`);
    }
}

type RecodeOptions = {
    option: D2Option;
    toCode: string;
};

type RecodeOptionsWithMetadata = RecodeOptions & {
    metadata: Metadata;
};

type OptionsWithMetadataValues = RecodeOptionsWithMetadata & {
    initialDataValues: DataValueSetsDataValue[];
    initialEvents: D2Event[];
};

type D2Option = {
    id: Id;
    name: string;
    code: string;
};

type D2Event = D2TrackerEventToPost;

const metadataQuery = {
    options: {
        fields: { $owner: true },
    },
    dataElements: {
        fields: { id: true, name: true, domainType: true },
    },
    trackedEntityAttributes: {
        fields: { id: true, name: true, domainType: true },
    },
    organisationUnits: {
        fields: { id: true },
    },
} as const;

type Metadata = MetadataPick<typeof metadataQuery>;

// TODO: Escape special chars (: , /) using escape char /
// See https://docs.dhis2.org/en/develop/using-the-api/dhis-core-version-master/tracker.html
function escapeTrackerFilterValue(value: string): string {
    return value.replace(/\//g, "//").replace(/:/g, "/:").replace(/,/g, "/,");
}
