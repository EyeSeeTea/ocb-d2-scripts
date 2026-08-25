import _ from "lodash";
import {
    D2Api,
    DataValueSetsDataValue,
    MetadataPayload,
    MetadataPick,
    D2TrackerEventToPost,
} from "../types/d2-api";
import { Async } from "domain/entities/Async";
import { Id } from "domain/entities/Base";
import { promiseMap } from "./dhis2-utils";
import { saveJsonToDisk } from "./files";
import { objectReferencesCode, recodeFields } from "./optionCodeReferences";
import { recodeDimensionCollections, recodeQueryCriteria } from "./optionCodeFilters";

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
 * - Metadata: Recode the code referenced as a quoted literal in the expressions of
 *   programIndicators, programRules and programRuleActions
 * - Metadata: Recode the code used as a filter item in the dimensions of eventVisualizations and
 *   mapViews, and in the query criteria of eventFilters
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
        const programMetadata = this.getProgramMetadata(options);
        const analyticsMetadata = await this.getAnalyticsMetadata(options);

        return {
            option: option,
            toCode: toCode,
            metadata: metadata,
            initialDataValues: dataValues,
            initialEvents: events,
            initialProgramMetadata: programMetadata,
            initialAnalyticsMetadata: analyticsMetadata,
        };
    }

    private async recodeOption(options: OptionsWithMetadataValues): Async<void> {
        const { option } = options;

        console.debug(`Rename option [id=${option.id}]: ${option.code} -> ${options.toCode}`);

        // Get data
        const dataValues = await this.recodeDataValuesGet(options);
        const events = await this.recodeEventsGet(options);
        const programMetadata = this.recodeProgramMetadataGet(options);
        const analyticsMetadata = this.recodeAnalyticsMetadataGet(options);

        // Update metadata
        await this.saveOption(options);
        await this.postProgramMetadata(programMetadata);
        await this.postAnalyticsMetadata(analyticsMetadata);

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
                programIndicators: metadataQuery.programIndicators,
                programRules: metadataQuery.programRules,
                programRuleActions: metadataQuery.programRuleActions,
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

    /* Program metadata: the option code is referenced as a quoted literal in expressions */

    private getProgramMetadata(options: RecodeOptionsWithMetadata): ProgramMetadata {
        const { option, metadata } = options;

        const programMetadata: ProgramMetadata = {
            programIndicators: metadata.programIndicators.filter(programIndicator => {
                return objectReferencesCode(programIndicator, programIndicatorFields, option.code);
            }),
            programRules: metadata.programRules.filter(programRule => {
                return objectReferencesCode(programRule, programRuleFields, option.code);
            }),
            programRuleActions: metadata.programRuleActions.filter(programRuleAction => {
                return objectReferencesCode(programRuleAction, programRuleActionFields, option.code);
            }),
        };

        const msg = getProgramMetadataNames(programMetadata);
        console.debug(`[recodeProgramMetadata] References to code ${option.code}: ${msg}`);

        return programMetadata;
    }

    private recodeProgramMetadataGet(options: OptionsWithMetadataValues): ProgramMetadata {
        const { option, toCode, initialProgramMetadata } = options;
        const recode = <T extends object>(object: T, fields: ReadonlyArray<keyof T>) =>
            recodeFields(object, fields, option.code, toCode);

        const programMetadata: ProgramMetadata = {
            programIndicators: initialProgramMetadata.programIndicators.map(programIndicator => {
                return recode(programIndicator, programIndicatorFields);
            }),
            programRules: initialProgramMetadata.programRules.map(programRule => {
                return recode(programRule, programRuleFields);
            }),
            programRuleActions: initialProgramMetadata.programRuleActions.map(programRuleAction => {
                return recode(programRuleAction, programRuleActionFields);
            }),
        };

        console.debug(
            `[recodeProgramMetadata] Objects to update: ${countProgramMetadata(programMetadata)}`
        );

        return programMetadata;
    }

    private async postProgramMetadata(programMetadata: ProgramMetadata): Async<void> {
        const count = countProgramMetadata(programMetadata);
        console.debug(`[recodeProgramMetadata] Objects to post: ${count}`);

        if (this.dryRun) {
            console.debug(`[recodeProgramMetadata] Dry run`);
            return;
        } else if (count === 0) {
            console.debug(`[recodeProgramMetadata] No objects to post`);
            return;
        } else {
            const res = await this.api.metadata.post(getProgramMetadataPayload(programMetadata)).getData();
            console.debug(`[recodeProgramMetadata] Post response: ${JSON.stringify(res.status)}`);

            if (res.status !== "OK") {
                throw new Error(`Failed to save program metadata: ${JSON.stringify(res)}`);
            }
        }
    }

    /* Analytics metadata: the option code is used as a filter item */

    /**
     * Locate the favourites and working lists that filter on one of the data items bound to the
     * option set, which is the same chain already used for dataValues and events. Locating by item
     * uid, and not by the code itself, keeps the query safe for codes with any character.
     */
    private async getAnalyticsMetadata(options: RecodeOptionsWithMetadata): Async<AnalyticsMetadata> {
        const { metadata } = options;
        const dataElementIds = metadata.dataElements.map(dataElement => dataElement.id);
        const attributeIds = metadata.trackedEntityAttributes.map(attribute => attribute.id);
        const programIndicatorIds = getProgramIndicatorIdsForItems(metadata, [
            ...dataElementIds,
            ...attributeIds,
        ]);

        const [eventVisualizations, mapViews, eventFilters] = await Promise.all([
            this.getByDimensions<D2EventVisualization>("eventVisualizations", {
                dataElementIds,
                attributeIds,
                programIndicatorIds,
            }),
            this.getByDimensions<D2MapView>("mapViews", {
                dataElementIds,
                attributeIds,
                programIndicatorIds,
            }),
            this.getByFilter<D2EventFilter>(
                "eventFilters",
                "eventQueryCriteria.dataFilters.dataItem",
                dataElementIds
            ),
        ]);

        const analyticsMetadata = this.recodeAnalyticsMetadata(
            { eventVisualizations, mapViews, eventFilters },
            options
        );

        // Only the objects that actually reference the code are kept, the same way getDataValues
        // keeps only the data values whose value is the code.
        const initial: AnalyticsMetadata = {
            eventVisualizations: eventVisualizations.filter(
                (object, index) => !_.isEqual(object, analyticsMetadata.eventVisualizations[index])
            ),
            mapViews: mapViews.filter(
                (object, index) => !_.isEqual(object, analyticsMetadata.mapViews[index])
            ),
            eventFilters: eventFilters.filter(
                (object, index) => !_.isEqual(object, analyticsMetadata.eventFilters[index])
            ),
        };

        const msg = getCountsByModel(initial);
        console.debug(`[recodeAnalytics] References to code ${options.option.code}: ${msg}`);

        return initial;
    }

    private recodeAnalyticsMetadataGet(options: OptionsWithMetadataValues): AnalyticsMetadata {
        const analyticsMetadata = this.recodeAnalyticsMetadata(options.initialAnalyticsMetadata, options);

        console.debug(`[recodeAnalytics] Objects to update: ${countModels(analyticsMetadata)}`);

        return analyticsMetadata;
    }

    private recodeAnalyticsMetadata(
        analyticsMetadata: AnalyticsMetadata,
        options: RecodeOptions
    ): AnalyticsMetadata {
        const { option, toCode } = options;

        return {
            eventVisualizations: analyticsMetadata.eventVisualizations.map(object =>
                recodeDimensionFilters(object, option.code, toCode)
            ),
            mapViews: analyticsMetadata.mapViews.map(object =>
                recodeDimensionFilters(object, option.code, toCode)
            ),
            eventFilters: analyticsMetadata.eventFilters.map(object => ({
                ...object,
                eventQueryCriteria: recodeQueryCriteria(
                    object.eventQueryCriteria,
                    option.code,
                    toCode
                ),
            })),
        };
    }

    private async postAnalyticsMetadata(analyticsMetadata: AnalyticsMetadata): Async<void> {
        const count = countModels(analyticsMetadata);
        console.debug(`[recodeAnalytics] Objects to post: ${count}`);

        if (this.dryRun) {
            console.debug(`[recodeAnalytics] Dry run`);
            return;
        } else if (count === 0) {
            console.debug(`[recodeAnalytics] No objects to post`);
            return;
        } else {
            // Maps are not posted: a mapView belongs to a single map, so updating the mapView is
            // what updates the copy seen through maps.mapViews.
            const res = await this.api.metadata.post(analyticsMetadata).getData();
            console.debug(`[recodeAnalytics] Post response: ${JSON.stringify(res.status)}`);

            if (res.status !== "OK") {
                throw new Error(`Failed to save analytics metadata: ${JSON.stringify(res)}`);
            }
        }
    }

    private async getByDimensions<T extends { id?: Id }>(
        model: string,
        itemIds: DimensionItemIds
    ): Async<T[]> {
        const [byDataElement, byAttribute, byProgramIndicator] = await Promise.all([
            this.getByFilter<T>(model, "dataElementDimensions.dataElement.id", itemIds.dataElementIds),
            this.getByFilter<T>(model, "attributeDimensions.attribute.id", itemIds.attributeIds),
            this.getByFilter<T>(
                model,
                "programIndicatorDimensions.programIndicator.id",
                itemIds.programIndicatorIds
            ),
        ]);

        return _.uniqBy([...byDataElement, ...byAttribute, ...byProgramIndicator], object => object.id);
    }

    private async getByFilter<T>(model: string, field: string, ids: Id[]): Async<T[]> {
        if (_.isEmpty(ids)) return [];

        const response = await this.api
            .get<Record<string, T[]>>(`/${model}`, {
                fields: ":owner",
                filter: `${field}:in:[${ids.join(",")}]`,
                paging: false,
            })
            .getData();

        return response[model] ?? [];
    }

    private async rollback(options: OptionsWithMetadataValues) {
        const { option, metadata, initialDataValues, initialEvents } = options;
        const { initialProgramMetadata, initialAnalyticsMetadata } = options;

        console.debug("[rollback] Executing rollback...");

        await this.saveOption({ ...options, toCode: option.code, metadata });
        await this.postProgramMetadata(initialProgramMetadata);
        await this.postAnalyticsMetadata(initialAnalyticsMetadata);
        await this.postDataValues(initialDataValues);
        await this.postEvents(initialEvents);

        console.debug("[rollback] Rollback completed");
    }

    private saveDataToDisk(options: OptionsWithMetadataValues): void {
        const { option, initialDataValues, initialEvents } = options;
        const { initialProgramMetadata, initialAnalyticsMetadata } = options;

        saveJsonToDisk(`dataValues_${option.id}`, { dataValues: initialDataValues });
        saveJsonToDisk(`events_${option.id}`, { events: initialEvents });
        saveJsonToDisk(`programMetadata_${option.id}`, initialProgramMetadata);
        saveJsonToDisk(`analyticsMetadata_${option.id}`, initialAnalyticsMetadata);

        console.debug(`Initial data saved to disk: option, dataValues, events and metadata`);
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
    initialProgramMetadata: ProgramMetadata;
    initialAnalyticsMetadata: AnalyticsMetadata;
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
    // The whole object is requested because a metadata post replaces it: a partial payload would
    // wipe the fields not sent.
    programIndicators: {
        fields: { $owner: true },
    },
    programRules: {
        fields: { $owner: true },
    },
    programRuleActions: {
        fields: { $owner: true },
    },
} as const;

type Metadata = MetadataPick<typeof metadataQuery>;

type ProgramMetadata = Readonly<{
    programIndicators: Metadata["programIndicators"];
    programRules: Metadata["programRules"];
    programRuleActions: Metadata["programRuleActions"];
}>;

// Fields where DHIS2 stores an option code as a quoted literal.
const programIndicatorFields = ["expression", "filter"] as const;
const programRuleFields = ["condition"] as const;
// `data` is an expression, `content` the message shown to the user, which also quotes the code.
const programRuleActionFields = ["data", "content"] as const;

/**
 * The $owner pick types programRuleActions.evaluationEnvironments as Ref[], while the POST payload
 * declares it as never[]. The value is read from the server and posted back untouched, so only that
 * single property is re-typed.
 */
function getProgramMetadataPayload(programMetadata: ProgramMetadata): Partial<MetadataPayload> {
    return {
        programIndicators: programMetadata.programIndicators,
        programRules: programMetadata.programRules,
        programRuleActions: programMetadata.programRuleActions.map(programRuleAction => ({
            ...programRuleAction,
            evaluationEnvironments: programRuleAction.evaluationEnvironments as never[],
        })),
    };
}

function countProgramMetadata(programMetadata: ProgramMetadata): number {
    return countModels(programMetadata);
}

function getProgramMetadataNames(programMetadata: ProgramMetadata): string {
    return getCountsByModel(programMetadata);
}

/* Analytics metadata */

type D2EventVisualization = MetadataPayload["eventVisualizations"][number];
type D2MapView = MetadataPayload["mapViews"][number];
type D2EventFilter = MetadataPayload["eventFilters"][number];

type AnalyticsMetadata = Readonly<{
    eventVisualizations: D2EventVisualization[];
    mapViews: D2MapView[];
    eventFilters: D2EventFilter[];
}>;

type DimensionItemIds = {
    dataElementIds: Id[];
    attributeIds: Id[];
    programIndicatorIds: Id[];
};

// Both eventVisualizations and mapViews hold the code in the same three dimension collections.
const dimensionCollections = [
    "dataElementDimensions",
    "attributeDimensions",
    "programIndicatorDimensions",
] as const;

function recodeDimensionFilters<T extends object>(object: T, fromCode: string, toCode: string): T {
    return recodeDimensionCollections(object, dimensionCollections, fromCode, toCode);
}

/**
 * A program indicator dimension holds an option code only when the indicator itself returns the
 * value of a data item bound to the option set, so the candidates are the indicators whose
 * expression or filter references one of those items.
 */
function getProgramIndicatorIdsForItems(metadata: Metadata, itemIds: Id[]): Id[] {
    return metadata.programIndicators
        .filter(programIndicator => {
            const expressions = [programIndicator.expression, programIndicator.filter];
            return itemIds.some(itemId =>
                expressions.some(expression => expression?.includes(itemId))
            );
        })
        .map(programIndicator => programIndicator.id);
}

/* Shared helpers for metadata grouped by model */

function countModels(metadataByModel: Record<string, unknown[]>): number {
    return _(metadataByModel)
        .values()
        .sumBy(objects => objects.length);
}

function getCountsByModel(metadataByModel: Record<string, unknown[]>): string {
    return _(metadataByModel)
        .map((objects, model) => `${model}=${objects.length}`)
        .join(", ");
}

// TODO: Escape special chars (: , /) using escape char /
// See https://docs.dhis2.org/en/develop/using-the-api/dhis-core-version-master/tracker.html
function escapeTrackerFilterValue(value: string): string {
    return value.replace(/\//g, "//").replace(/:/g, "/:").replace(/,/g, "/,");
}
