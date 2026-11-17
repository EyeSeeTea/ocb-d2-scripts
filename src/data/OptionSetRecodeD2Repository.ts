import _ from "lodash";
import { D2Api } from "types/d2-api";
import { Async } from "domain/entities/Async";
import { Id } from "domain/entities/Base";
import { needsTemporaryCodes, OptionSetRecodePlan, recodeValue } from "domain/entities/OptionCodeMapping";
import {
    OptionSetRecodeRepository,
    RecodeCounts,
    RecodeSummary,
    ReviewItem,
} from "domain/repositories/OptionSetRecodeRepository";
import logger from "utils/log";
import { saveJsonToDisk } from "./files";
import { findQuotedCodes, ItemRefs, recodeExpression, referencesItems } from "./optionCodeReferences";
import { findLikeFilters, recodeDimensionCollections, recodeQueryCriteria } from "./optionCodeFilters";

/**
 * Recode an option set as a whole, from a mapping of codes, together with every reference to them:
 *
 * - Data: aggregate data values and tracker event data values of the data elements of the set.
 * - Expressions: quoted codes compared with the items of the set in programIndicators (expression,
 *   filter), programRules (condition), programRuleActions (data), and in the aggregate expressions
 *   of indicators (numerator, denominator), validationRules (leftSide, rightSide) and predictors
 *   (generator, sampleSkipTest), which can compare an aggregate data element with a code.
 * - Analytics metadata: dimension filters of the items in eventVisualizations, and query criteria of
 *   eventFilters.
 *
 * Order: options (through temporary codes when a target code is still held by another option of
 * the set, which DHIS2 rejects), metadata, then data (the tracker validates values against the
 * current option codes). The initial state is saved to disk before any change, and restored if a
 * step fails.
 *
 * Not recoded (reported in the summary for manual review): tracked entity attribute values, codes in
 * free texts (programRuleAction content, sqlView queries and custom form code that mention an item
 * of the set) or in expressions out of a comparison with an item, `like` filters, and mapViews: on DHIS2 2.40 a mapView posted on its own is accepted but not saved, and
 * a map PUT recreates its mapViews without their dimension filters.
 */
export class OptionSetRecodeD2Repository implements OptionSetRecodeRepository {
    /**
     * - `backupDir`: where the initial state of each option set is saved before it is recoded.
     * - `eventsPerWindow`: largest window of events read with offset paging (default EVENTS_PER_WINDOW).
     */
    constructor(private api: D2Api, private options: { backupDir: string; eventsPerWindow?: number }) {}

    /** Events to recode, by option set, found by `prepare` in a single scan of the stages. */
    private preparedCandidates = new Map<Id, Set<Id>>();

    /**
     * Scan the stages once for all the plans, instead of once per option set: a stage shared by
     * several option sets (on a central server, millions of events) is read only once. Only the uids
     * of the matching events are kept, by option set.
     *
     * A data element belongs to a single option set, so recoding one set does not change the
     * candidates of another. Events entered during the run are not seen (data entry must be stopped).
     */
    async prepare(plans: OptionSetRecodePlan[]): Async<void> {
        const planByDataElement = new Map<Id, OptionSetRecodePlan>();
        for (const plan of plans) {
            const items = await this.getItems(plan.optionSet.id);
            getTrackerDataElements(items).forEach(dataElement => planByDataElement.set(dataElement.id, plan));
        }

        const candidates = await this.scanStages(planByDataElement);
        this.preparedCandidates = new Map(
            plans.map(plan => [plan.optionSet.id, candidates.get(plan.optionSet.id) ?? new Set<Id>()])
        );
    }

    async recode(plan: OptionSetRecodePlan, options: { dryRun: boolean }): Async<RecodeSummary> {
        const { optionSet } = plan;
        const items = await this.getItems(optionSet.id);
        const initial = await this.getInitialState(plan, items);
        const { state: recoded, review } = this.recodeState(initial, plan, items);

        items.attributes.forEach(attribute =>
            review.push({
                model: "trackedEntityAttribute",
                id: attribute.id,
                name: attribute.name,
                field: "values",
                detail: "values are not recoded",
            })
        );

        const summary: RecodeSummary = {
            optionSetId: optionSet.id,
            optionSetName: optionSet.name,
            counts: getCounts(recoded),
            review: review,
        };
        logger.info(`[${optionSet.name}] ${JSON.stringify(summary.counts)}`);
        review.forEach(item => logger.warn(`[${optionSet.name}] Review: ${formatReviewItem(item)}`));

        if (options.dryRun) {
            await this.validate(plan, initial, recoded);
            return summary;
        }

        const backupPath = saveJsonToDisk(`recode_${optionSet.id}`, initial, this.options.backupDir);
        logger.info(`[${optionSet.name}] Initial state saved: ${backupPath}`);

        try {
            await this.apply(plan, recoded);
        } catch (err) {
            logger.error(`[${optionSet.name}] Error, rolling back: ${getErrorMessage(err)}`);
            await this.rollback(plan, initial, recoded);
            throw new Error(getErrorMessage(err));
        }

        return { ...summary, backupPath };
    }

    /* Items bound to the option set */

    private async getItems(optionSetId: Id): Async<Items> {
        const filter = `optionSet.id:eq:${optionSetId}`;
        const [dataElements, attributes] = await Promise.all([
            this.getObjects<DataElement>("dataElements", [filter], "id,name,domainType"),
            this.getObjects<NamedRef>("trackedEntityAttributes", [filter], "id,name"),
        ]);

        const variables = _.uniqBy(
            [
                ...(await this.getObjects<Variable>(
                    "programRuleVariables",
                    [`dataElement.id:in:[${ids(dataElements)}]`],
                    "id,name,program[id]",
                    { skipIfEmpty: dataElements }
                )),
                ...(await this.getObjects<Variable>(
                    "programRuleVariables",
                    [`trackedEntityAttribute.id:in:[${ids(attributes)}]`],
                    "id,name,program[id]",
                    { skipIfEmpty: attributes }
                )),
            ],
            variable => variable.id
        );

        return { dataElements, attributes, variables };
    }

    /* Initial state: the objects that reference a code of the mapping */

    private async getInitialState(plan: OptionSetRecodePlan, items: Items): Async<State> {
        const refs = getItemRefs(items, []);
        const itemIds = [...ids(items.dataElements), ...ids(items.attributes)];
        const likeFilters = itemIds.flatMap(id => [`expression:like:${id}`, `filter:like:${id}`]);
        const programIds = _.uniq(items.variables.map(variable => variable.program.id));

        const programIndicators = await this.getObjects<D2Object>(
            "programIndicators",
            likeFilters,
            ":owner",
            {
                skipIfEmpty: itemIds,
                rootJunction: "OR",
            }
        );
        const programRules = await this.getObjects<D2Object>(
            "programRules",
            [`program.id:in:[${programIds.join(",")}]`],
            ":owner",
            { skipIfEmpty: programIds }
        );
        const programRuleActions = _.uniqBy(
            [
                ...(await this.getObjects<D2Object>(
                    "programRuleActions",
                    [`programRule.id:in:[${ids(programRules)}]`],
                    ":owner",
                    { skipIfEmpty: programRules }
                )),
                ...(await this.getObjects<D2Object>(
                    "programRuleActions",
                    [`dataElement.id:in:[${ids(items.dataElements)}]`],
                    ":owner",
                    { skipIfEmpty: items.dataElements }
                )),
            ],
            action => action.id
        );

        const dataElementIds = ids(items.dataElements);
        const like = (fields: string[], values: Id[]) =>
            values.flatMap(value => fields.map(field => `${field}:like:${value}`));
        const getByText = (model: string, fields: string[], values: Id[], fieldsParam = ":owner") =>
            this.getObjects<D2Object>(model, like(fields, values), fieldsParam, {
                skipIfEmpty: values,
                rootJunction: "OR",
            });

        const [indicators, validationRules, predictors, sqlViews, dataEntryForms] = await Promise.all([
            getByText("indicators", ["numerator", "denominator"], dataElementIds),
            getByText("validationRules", ["leftSide.expression", "rightSide.expression"], dataElementIds),
            getByText("predictors", ["generator.expression", "sampleSkipTest.expression"], dataElementIds),
            getByText("sqlViews", ["sqlQuery"], [...itemIds, plan.optionSet.id], "id,name,sqlQuery"),
            getByText("dataEntryForms", ["htmlCode"], itemIds, "id,name,htmlCode"),
        ]);

        // A programIndicator dimension holds a code only when the indicator returns an item of the set.
        const valueIndicatorIds = programIndicators
            .filter(indicator => referencesItems(indicator.expression as string | undefined, refs))
            .map(indicator => indicator.id);
        const dimensionIds = { ...pick(items), programIndicatorIds: valueIndicatorIds };

        const [eventVisualizations, mapViews, eventFilters] = await Promise.all([
            this.getByDimensions("eventVisualizations", dimensionIds, ":owner"),
            // A mapView is embedded in a map, so :owner returns no fields for it.
            this.getByDimensions("mapViews", dimensionIds, "*"),
            this.getObjects<D2Object>(
                "eventFilters",
                [`eventQueryCriteria.dataFilters.dataItem:in:[${ids(items.dataElements)}]`],
                ":owner",
                { skipIfEmpty: items.dataElements }
            ),
        ]);

        const [dataValues, events] = await Promise.all([
            this.getDataValues(plan, items),
            this.getEvents(plan, items),
        ]);

        return {
            options: await this.getObjects<D2Object>(
                "options",
                [`id:in:[${plan.changes.map(change => change.optionId).join(",")}]`],
                ":owner"
            ),
            dataValues,
            events,
            programIndicators,
            programRules,
            programRuleActions,
            indicators,
            validationRules,
            predictors,
            eventVisualizations,
            mapViews,
            eventFilters,
            sqlViews,
            dataEntryForms,
        };
    }

    private async getDataValues(plan: OptionSetRecodePlan, items: Items): Async<DataValue[]> {
        const aggregated = items.dataElements.filter(dataElement => dataElement.domainType === "AGGREGATE");
        if (aggregated.length === 0) return [];

        const rootOrgUnits = await this.getObjects<NamedRef>("organisationUnits", ["level:eq:1"], "id,name");
        const { dataValues = [] } = await this.api
            .get<{ dataValues?: DataValue[] }>("/dataValueSets", {
                dataElement: ids(aggregated),
                orgUnit: ids(rootOrgUnits),
                children: true,
                startDate: "1900-01-01",
                endDate: `${new Date().getFullYear() + 100}-12-31`,
            })
            .getData();

        const dataElementIds = new Set(ids(aggregated));
        return dataValues.filter(
            dataValue => dataElementIds.has(dataValue.dataElement) && hasCode(plan, dataValue.value)
        );
    }

    /**
     * Events are not searched with a tracker `filter`: for option set data elements it matches the
     * option name, whose escaping is not reliable (on 2.40 `/` must not be escaped, against the docs),
     * and a missed event is a silent miss. Instead, the events of the stages that hold the data
     * elements are scanned with only their values, and the matching ones are then fetched in full.
     */
    private async getEvents(plan: OptionSetRecodePlan, items: Items): Async<D2Event[]> {
        const trackerDataElements = getTrackerDataElements(items);
        const dataElementIds = new Set(ids(trackerDataElements));
        const isRecoded = (dataValue: D2DataValue) =>
            dataElementIds.has(dataValue.dataElement) && hasCode(plan, dataValue.value);

        const candidates =
            this.preparedCandidates.get(plan.optionSet.id) ??
            (
                await this.scanStages(new Map(trackerDataElements.map(dataElement => [dataElement.id, plan])))
            ).get(plan.optionSet.id) ??
            new Set<Id>();
        const candidateIds = Array.from(candidates);

        const events: D2Event[] = [];
        for (const chunk of _.chunk(_.uniq(candidateIds), EVENTS_BY_ID_CHUNK_SIZE)) {
            // `event` on 2.40, `events` on later versions: send both, keep only the requested uids.
            const eventIds = chunk.join(";");
            const fetched = await this.getEventsPaged({ event: eventIds, events: eventIds }, "*");
            events.push(...fetched.filter(event => candidates.has(event.event)));
        }

        const missing = candidateIds.length - _.uniqBy(events, event => event.event).length;
        if (missing !== 0) throw new Error(`${missing} events found by scan could not be fetched in full`);

        return _(events)
            .uniqBy(event => event.event)
            .map(event => ({
                ...(_.omit(event, ["notes", "relationships"]) as D2Event),
                dataValues: event.dataValues.filter(isRecoded),
            }))
            .value();
    }

    /**
     * Read the values of every event of the stages that hold the given data elements, and return the
     * uids of the events with a value to recode, by option set. Values are compared against the plan
     * of their data element, so a stage shared by several option sets is read once.
     */
    private async scanStages(planByDataElement: Map<Id, OptionSetRecodePlan>): Async<Map<Id, Set<Id>>> {
        const dataElementIds = Array.from(planByDataElement.keys());
        const stages = _.uniqBy(
            _.flatten(
                await promiseMapSerial(_.chunk(dataElementIds, IDS_PER_FILTER), chunk =>
                    this.getObjects<{ id: Id; name: string; program: Ref }>(
                        "programStages",
                        [`programStageDataElements.dataElement.id:in:[${chunk.join(",")}]`],
                        "id,name,program[id]"
                    )
                )
            ),
            stage => stage.id
        );

        const candidates = new Map<Id, Set<Id>>();
        const end = await this.getScanEnd();

        for (const [index, stage] of stages.entries()) {
            const start = Date.now();
            const matched = new Set<Id>();

            const total = await this.scanStage(stage, end, events => {
                for (const event of events) {
                    for (const dataValue of event.dataValues) {
                        const plan = planByDataElement.get(dataValue.dataElement);
                        if (!plan || !hasCode(plan, dataValue.value)) continue;
                        const setCandidates = candidates.get(plan.optionSet.id) ?? new Set<Id>();
                        candidates.set(plan.optionSet.id, setCandidates.add(event.event));
                        matched.add(event.event);
                    }
                }
            });

            const seconds = ((Date.now() - start) / 1000).toFixed(1);
            logger.info(
                `Scanned stage ${index + 1}/${stages.length} ${stage.name} [${stage.id}]: ` +
                    `${total} events, ${matched.size} to recode (${seconds}s)`
            );
        }

        return candidates;
    }

    /**
     * Read the values of every event of a stage, page by page, passing each page to `visit` (a stage
     * may hold millions of events, which are not kept in memory). Returns the number of events.
     *
     * A large stage is read in windows of `updatedAt` (every event has one, unlike `occurredAt`),
     * halved until each one holds at most `eventsPerWindow` events: with offset paging, the deep
     * pages of a stage with millions of events get slower and slower. The windows are half-open
     * (`updatedAfter` is inclusive and `updatedBefore` exclusive), so they cover the whole range with
     * no gap nor overlap. In any case, the events read must add up to the count of the stage, or the
     * scan fails: an event missed would keep its old code.
     */
    private async scanStage(
        stage: { id: Id; name: string; program: Ref },
        end: number,
        visit: (events: D2Event[]) => void
    ): Async<number> {
        const base = { program: stage.program.id, programStage: stage.id };
        const perWindow = this.options.eventsPerWindow ?? EVENTS_PER_WINDOW;
        const total = await this.countEvents(base);
        if (total === 0) return 0;

        const seen = new Set<Id>();
        const visitNew = (events: D2Event[]) => {
            const fresh = events.filter(event => !seen.has(event.event));
            fresh.forEach(event => seen.add(event.event));
            visit(fresh);
        };

        const scanWindow = async (from: number, to: number): Async<void> => {
            const params = { ...base, updatedAfter: formatDate(from), updatedBefore: formatDate(to) };
            const count = await this.countEvents(params);
            if (count === 0) return;
            if (count <= perWindow || to - from <= MIN_WINDOW_MS) {
                await this.forEachEventPage(params, SCAN_FIELDS, visitNew);
            } else {
                const middle = from + Math.floor((to - from) / 2);
                await scanWindow(from, middle);
                await scanWindow(middle, to);
            }
        };

        if (total <= perWindow) {
            await this.forEachEventPage(base, SCAN_FIELDS, visitNew);
        } else {
            await scanWindow(await this.getFirstUpdatedAt(base), end);
        }

        if (seen.size !== total)
            throw new Error(
                `Stage ${stage.name} [${stage.id}]: ${seen.size} events read, ${total} expected ` +
                    `(were events entered during the scan?)`
            );
        return total;
    }

    /** End of the scan windows: a day after the server date, in the server time zone like `updatedAt`. */
    private async getScanEnd(): Async<number> {
        const { serverDate } = await this.api.get<{ serverDate: string }>("/system/info").getData();
        return parseDate(serverDate) + DAY_MS;
    }

    private async getFirstUpdatedAt(params: Record<string, string>): Async<number> {
        const { instances = [] } = await this.api
            .get<{ instances?: Array<{ updatedAt: string }> }>("/tracker/events", {
                ...params,
                fields: "updatedAt",
                ouMode: "ACCESSIBLE",
                order: "updatedAt:asc",
                pageSize: 1,
            })
            .getData();
        const first = instances[0]?.updatedAt;
        if (!first) throw new Error(`No updatedAt for the first event of ${JSON.stringify(params)}`);
        return parseDate(first);
    }

    private async countEvents(params: Record<string, string>): Async<number> {
        const res = await this.api
            .get<{ total?: number; pager?: { total?: number } }>("/tracker/events", {
                ...params,
                fields: "event",
                ouMode: "ACCESSIBLE",
                pageSize: 1,
                totalPages: true,
            })
            .getData();
        const total = res.total ?? res.pager?.total;
        if (total === undefined) throw new Error(`No event count for ${JSON.stringify(params)}`);
        return total;
    }

    private async forEachEventPage(
        params: Record<string, string>,
        fields: string,
        visit: (events: D2Event[]) => void
    ): Async<void> {
        for (let page = 1; ; page++) {
            const instances = await this.getEventsPage(params, fields, page);
            visit(instances);
            if (instances.length < EVENTS_PAGE_SIZE) return;
        }
    }

    private async getEventsPaged(params: Record<string, string>, fields: string): Async<D2Event[]> {
        const events: D2Event[] = [];
        await this.forEachEventPage(params, fields, instances => events.push(...instances));
        return events;
    }

    private async getEventsPage(
        params: Record<string, string>,
        fields: string,
        page: number
    ): Async<D2Event[]> {
        const { instances = [] } = await this.api
            .get<{ instances?: D2Event[] }>("/tracker/events", {
                ...params,
                fields,
                ouMode: "ACCESSIBLE",
                // Without an explicit unique order, pages may skip or repeat events.
                order: "event:asc",
                page,
                pageSize: EVENTS_PAGE_SIZE,
            })
            .getData();
        return instances;
    }

    private async getByDimensions(
        model: string,
        dimensionIds: { dataElementIds: Id[]; attributeIds: Id[]; programIndicatorIds: Id[] },
        fields: string
    ): Async<D2Object[]> {
        const queries = [
            { field: "dataElementDimensions.dataElement.id", ids: dimensionIds.dataElementIds },
            { field: "attributeDimensions.attribute.id", ids: dimensionIds.attributeIds },
            {
                field: "programIndicatorDimensions.programIndicator.id",
                ids: dimensionIds.programIndicatorIds,
            },
        ];

        const objects = await Promise.all(
            queries.map(({ field, ids }) =>
                this.getObjects<D2Object>(model, [`${field}:in:[${ids.join(",")}]`], fields, {
                    skipIfEmpty: ids,
                })
            )
        );

        return _.uniqBy(_.flatten(objects), object => object.id);
    }

    /* Recode */

    private recodeState(
        initial: State,
        plan: OptionSetRecodePlan,
        items: Items
    ): { state: State; review: ReviewItem[] } {
        const { mapping } = plan;
        const review: ReviewItem[] = [];
        const itemIds = pick(items);
        const ruleProgram = _(initial.programRules)
            .map(rule => [rule.id, (rule.program as Ref | undefined)?.id ?? ""] as const)
            .fromPairs()
            .value();
        const refsForProgram = (programId: Id | undefined) =>
            getItemRefs(
                items,
                items.variables
                    .filter(variable => variable.program.id === programId)
                    .map(variable => variable.name)
            );

        const recodeFields = (
            object: D2Object,
            fields: string[],
            refs: ItemRefs,
            model: ReviewItem["model"],
            isAssigned = false
        ) =>
            fields.reduce((acc, field) => {
                const result = recodeExpression(acc[field] as string | undefined, refs, mapping, {
                    isAssignedToItem: isAssigned,
                });
                if (result.review.length > 0)
                    review.push({
                        model,
                        id: object.id,
                        name: String(object.name ?? ""),
                        field,
                        detail: result.review.join(", "),
                    });
                return result.value === (acc[field] ?? "") ? acc : { ...acc, [field]: result.value };
            }, object);

        const programIndicators = initial.programIndicators.map(indicator =>
            recodeFields(indicator, ["expression", "filter"], getItemRefs(items, []), "programIndicator")
        );

        const programRules = initial.programRules.map(rule =>
            recodeFields(
                rule,
                ["condition"],
                refsForProgram((rule.program as Ref | undefined)?.id),
                "programRule"
            )
        );

        const programRuleActions = initial.programRuleActions.map(action => {
            const ruleId = (action.programRule as Ref | undefined)?.id ?? "";
            const refs = refsForProgram(ruleProgram[ruleId]);
            const target =
                (action.dataElement as Ref | undefined)?.id ??
                (action.trackedEntityAttribute as Ref | undefined)?.id;
            const isAssigned = Boolean(
                target && [...itemIds.dataElementIds, ...itemIds.attributeIds].includes(target)
            );
            const recoded = recodeFields(action, ["data"], refs, "programRuleAction", isAssigned);
            const contentCodes = findQuotedCodes(action.content as string | undefined, mapping);
            if (contentCodes.length > 0 && (isAssigned || recoded !== action))
                review.push({
                    model: "programRuleAction",
                    id: action.id,
                    name: "",
                    field: "content",
                    detail: contentCodes.join(", "),
                });
            return recoded;
        });

        // Aggregate expressions: the items are the data elements (`#{de}`, `#{de.coc}`).
        const aggregateRefs = getItemRefs(items, []);
        const recodeNested = (object: D2Object, paths: Array<[string, string]>, model: ReviewItem["model"]) =>
            paths.reduce((acc, [parent, field]) => {
                const container = acc[parent] as Record<string, unknown> | undefined;
                if (!container) return acc;
                // Recoded under its full path, so that a review item names `leftSide.expression`.
                const path = `${parent}.${field}`;
                const flat = { id: object.id, name: object.name, [path]: container[field] };
                const recoded = recodeFields(flat, [path], aggregateRefs, model);
                return recoded === flat
                    ? acc
                    : { ...acc, [parent]: { ...container, [field]: recoded[path] } };
            }, object);

        const indicators = initial.indicators.map(indicator =>
            recodeFields(indicator, ["numerator", "denominator"], aggregateRefs, "indicator")
        );
        const validationRules = initial.validationRules.map(rule =>
            recodeNested(
                rule,
                [
                    ["leftSide", "expression"],
                    ["rightSide", "expression"],
                ],
                "validationRule"
            )
        );
        const predictors = initial.predictors.map(predictor =>
            recodeNested(
                predictor,
                [
                    ["generator", "expression"],
                    ["sampleSkipTest", "expression"],
                ],
                "predictor"
            )
        );

        // Free texts (SQL, HTML/JS): reported when they mention an item of the set and a quoted code.
        const reportText = (objects: D2Object[], field: string, model: ReviewItem["model"]) =>
            objects.forEach(object => {
                const codes = findQuotedCodes(object[field] as string | undefined, mapping);
                if (codes.length > 0)
                    review.push({
                        model,
                        id: object.id,
                        name: String(object.name ?? ""),
                        field,
                        detail: codes.join(", "),
                    });
            });
        reportText(initial.sqlViews, "sqlQuery", "sqlView");
        reportText(initial.dataEntryForms, "htmlCode", "dataEntryForm");

        const valueIndicatorIds = initial.programIndicators
            .filter(indicator =>
                referencesItems(indicator.expression as string | undefined, getItemRefs(items, []))
            )
            .map(indicator => indicator.id);
        const dimensionItemIds = [...itemIds.dataElementIds, ...itemIds.attributeIds, ...valueIndicatorIds];
        const recodeDimensions = (object: D2Object) =>
            recodeDimensionCollections(object, DIMENSION_COLLECTIONS, dimensionItemIds, mapping);

        const eventFilters = initial.eventFilters.map(eventFilter => {
            findLikeFilters(eventFilter.eventQueryCriteria, itemIds).forEach(filter =>
                review.push({
                    model: "eventFilter",
                    id: eventFilter.id,
                    name: String(eventFilter.name ?? ""),
                    field: "eventQueryCriteria",
                    detail: `like: ${filter.like}`,
                })
            );
            const criteria = recodeQueryCriteria(eventFilter.eventQueryCriteria, itemIds, mapping);
            return criteria === eventFilter.eventQueryCriteria
                ? eventFilter
                : { ...eventFilter, eventQueryCriteria: criteria };
        });

        const changedOnly = <T>(objects: T[], originals: T[]) =>
            objects.filter((object, index) => object !== originals[index]);
        const recodeData = <T extends { value: string }>(value: T): T => ({
            ...value,
            value: recodeValue(value.value, mapping),
        });

        const state: State = {
            options: initial.options.map(option => {
                const change = plan.changes.find(change => change.optionId === option.id);
                return change ? { ...option, code: change.toCode } : option;
            }),
            dataValues: initial.dataValues.map(recodeData),
            events: initial.events.map(event => ({ ...event, dataValues: event.dataValues.map(recodeData) })),
            programIndicators: changedOnly(programIndicators, initial.programIndicators),
            programRules: changedOnly(programRules, initial.programRules),
            programRuleActions: changedOnly(programRuleActions, initial.programRuleActions),
            indicators: changedOnly(indicators, initial.indicators),
            validationRules: changedOnly(validationRules, initial.validationRules),
            predictors: changedOnly(predictors, initial.predictors),
            eventVisualizations: changedOnly(
                initial.eventVisualizations.map(recodeDimensions),
                initial.eventVisualizations
            ),
            mapViews: changedOnly(initial.mapViews.map(recodeDimensions), initial.mapViews),
            eventFilters: changedOnly(eventFilters, initial.eventFilters),
            sqlViews: [],
            dataEntryForms: [],
        };

        state.mapViews.forEach(mapView =>
            review.push({
                model: "mapView",
                id: mapView.id,
                name: "",
                field: "filters",
                detail: "update by hand in the Maps app",
            })
        );

        return { state, review: _.uniqWith(review, _.isEqual) };
    }

    /* Persist */

    private async apply(plan: OptionSetRecodePlan, state: State): Async<void> {
        const name = plan.optionSet.name;
        await this.saveOptions(plan, state.options);
        await this.postMetadata(name, "expression metadata", _.pick(state, EXPRESSION_MODELS));
        await this.postMetadata(name, "analytics metadata", _.pick(state, ANALYTICS_MODELS));
        await this.postDataValues(name, state.dataValues);
        await this.postEvents(name, state.events);
    }

    /**
     * Dry run: ask the server to validate every import of the option set, without saving, so that a
     * rejection (an event whose org unit is no longer in the program, a locked period...) shows up
     * before the update. Every step is validated and all failures are reported together.
     *
     * - Options: when the plan needs temporary codes, the target codes are still held on the server,
     *   so the temporary step is validated (the uniqueness of the final codes is checked in the plan).
     * - Data values and events are validated with their current values: the recoded ones are not
     *   option codes yet, so they would be rejected for that reason alone. Any other reason for a
     *   rejection is the same with either value.
     */
    private async validate(plan: OptionSetRecodePlan, initial: State, recoded: State): Async<void> {
        const name = plan.optionSet.name;
        const options = needsTemporaryCodes(plan) ? withTemporaryCodes(recoded.options) : recoded.options;
        const mode = "VALIDATE";
        const steps: Array<[string, () => Async<void>]> = [
            ["options", () => this.postMetadata(name, "options", { options }, mode)],
            [
                "expression metadata",
                () =>
                    this.postMetadata(name, "expression metadata", _.pick(recoded, EXPRESSION_MODELS), mode),
            ],
            [
                "analytics metadata",
                () => this.postMetadata(name, "analytics metadata", _.pick(recoded, ANALYTICS_MODELS), mode),
            ],
            ["dataValues", () => this.postDataValues(name, initial.dataValues, mode)],
            ["events", () => this.postEvents(name, initial.events, mode)],
        ];

        const failures: string[] = [];
        for (const [step, run] of steps) {
            await run().catch(err => failures.push(`${step}: ${getErrorMessage(err)}`));
        }
        if (failures.length > 0) throw new Error(`Validation failed. ${failures.join(" / ")}`);
        logger.info(`[${name}] Validated on the server`);
    }

    /**
     * Restore the initial state of the objects that were changed. Every step is attempted, even if a
     * previous one fails.
     */
    private async rollback(plan: OptionSetRecodePlan, initial: State, recoded: State): Async<void> {
        const name = plan.optionSet.name;
        const originals = (models: ReadonlyArray<MetadataModel>) =>
            _.fromPairs(
                models.map(model => {
                    const changedIds = new Set(recoded[model].map(object => object.id));
                    return [model, initial[model].filter(object => changedIds.has(object.id))];
                })
            );
        const steps: Array<[string, () => Async<void>]> = [
            ["events", () => this.postEvents(name, initial.events)],
            ["dataValues", () => this.postDataValues(name, initial.dataValues)],
            [
                "analytics metadata",
                () => this.postMetadata(name, "analytics metadata", originals(ANALYTICS_MODELS)),
            ],
            [
                "expression metadata",
                () => this.postMetadata(name, "expression metadata", originals(EXPRESSION_MODELS)),
            ],
            ["options", () => this.saveOptions(plan, initial.options)],
        ];

        for (const [step, run] of steps) {
            await run().catch(err =>
                logger.error(`[${name}] Rollback of ${step} failed: ${getErrorMessage(err)}`)
            );
        }
        logger.info(`[${name}] Rollback completed`);
    }

    private async saveOptions(plan: OptionSetRecodePlan, options: D2Object[]): Async<void> {
        if (needsTemporaryCodes(plan)) {
            const temporary = withTemporaryCodes(options);
            await this.postMetadata(plan.optionSet.name, "options (temporary codes)", { options: temporary });
        }
        await this.postMetadata(plan.optionSet.name, "options", { options });
    }

    private async postMetadata(
        name: string,
        label: string,
        payload: Record<string, unknown[]>,
        importMode: ImportMode = "COMMIT"
    ): Async<void> {
        const count = _.sumBy(_.values(payload), objects => objects.length);
        if (count === 0) return;

        const res = await this.api
            .post<{ status: string }>("/metadata", { atomicMode: "ALL", importMode }, payload, IMPORT_REQUEST)
            .getData();
        logger.debug(`[${name}] Post ${label} (${count}, ${importMode}): ${res.status}`);
        if (res.status !== "OK") throw new Error(`Failed to save ${label}: ${truncate(JSON.stringify(res))}`);
    }

    private async postDataValues(
        name: string,
        dataValues: DataValue[],
        importMode: ImportMode = "COMMIT"
    ): Async<void> {
        const params = { dryRun: importMode === "VALIDATE" };
        for (const chunk of _.chunk(dataValues, DATA_VALUES_CHUNK_SIZE)) {
            const res = await this.api
                .post<DataValuesResponse>("/dataValueSets", params, { dataValues: chunk }, IMPORT_REQUEST)
                .getData();
            const response = res.response ?? res;
            logger.debug(
                `[${name}] Post dataValues (${chunk.length}): ${JSON.stringify(response.importCount)}`
            );
            // A value posted unchanged counts as `ignored` without a conflict (2.40): not an error.
            if (response.status === "ERROR" || (response.conflicts ?? []).length > 0)
                throw new Error(
                    `Failed to save data values: ${truncate(JSON.stringify(response.conflicts ?? response))}`
                );
        }
    }

    private async postEvents(
        name: string,
        events: D2Event[],
        importMode: ImportMode = "COMMIT"
    ): Async<void> {
        const params = {
            importMode,
            async: false,
            importStrategy: "UPDATE",
            skipRuleEngine: true,
            skipSideEffects: true,
        };

        for (const chunk of _.chunk(events, EVENTS_CHUNK_SIZE)) {
            const res = await this.api
                .post<TrackerResponse>("/tracker", params, { events: chunk }, IMPORT_REQUEST)
                .getData();
            logger.debug(`[${name}] Post events (${chunk.length}): ${JSON.stringify(res.stats)}`);
            if (res.status !== "OK") throw new Error(`Failed to save events: ${summarizeTrackerErrors(res)}`);
        }
    }

    private async getObjects<T>(
        model: string,
        filter: string[],
        fields: string,
        options: { skipIfEmpty?: unknown[]; rootJunction?: "AND" | "OR" } = {}
    ): Async<T[]> {
        if (options.skipIfEmpty && options.skipIfEmpty.length === 0) return [];

        const response = await this.api
            .get<Record<string, T[]>>(`/${model}`, {
                fields,
                filter,
                paging: false,
                ...(options.rootJunction ? { rootJunction: options.rootJunction } : {}),
            })
            .getData();

        return response[model] ?? [];
    }
}

/** Count per error code, with a sample message and event, instead of the whole validation report. */
function summarizeTrackerErrors(res: TrackerResponse): string {
    const errors = res.validationReport?.errorReports ?? [];
    if (errors.length === 0) return truncate(JSON.stringify(res));

    return _(errors)
        .groupBy(error => error.errorCode ?? "unknown")
        .map((group, code) => `${code} x${group.length} (e.g. ${group[0]?.uid}: ${group[0]?.message})`)
        .join("; ");
}

function withTemporaryCodes(options: D2Object[]): D2Object[] {
    return options.map(option => ({ ...option, code: `${TEMPORARY_CODE_PREFIX}${option.id}` }));
}

/** DHIS2 dates have no time zone (server time): they are handled as UTC to compute the windows. */
function parseDate(value: string): number {
    const time = Date.parse(`${value.replace(/Z$/, "")}Z`);
    if (Number.isNaN(time)) throw new Error(`Invalid date: ${value}`);
    return time;
}

function formatDate(time: number): string {
    return new Date(time).toISOString().replace(/Z$/, "");
}

function getTrackerDataElements(items: Items): DataElement[] {
    return items.dataElements.filter(dataElement => dataElement.domainType === "TRACKER");
}

async function promiseMapSerial<T, U>(values: T[], fn: (value: T) => Promise<U>): Promise<U[]> {
    const results: U[] = [];
    for (const value of values) results.push(await fn(value));
    return results;
}

function getItemRefs(items: Items, variableNames: string[]): ItemRefs {
    return { ...pick(items), variableNames };
}

function pick(items: Items): { dataElementIds: Id[]; attributeIds: Id[] } {
    return { dataElementIds: ids(items.dataElements), attributeIds: ids(items.attributes) };
}

function ids(objects: Array<{ id: Id }>): Id[] {
    return objects.map(object => object.id);
}

function hasCode(plan: OptionSetRecodePlan, value: string): boolean {
    return Object.prototype.hasOwnProperty.call(plan.mapping, value);
}

function getCounts(state: State): RecodeCounts {
    return {
        options: state.options.length,
        dataValues: state.dataValues.length,
        events: state.events.length,
        programIndicators: state.programIndicators.length,
        programRules: state.programRules.length,
        programRuleActions: state.programRuleActions.length,
        indicators: state.indicators.length,
        validationRules: state.validationRules.length,
        predictors: state.predictors.length,
        eventVisualizations: state.eventVisualizations.length,
        mapViews: state.mapViews.length,
        eventFilters: state.eventFilters.length,
    };
}

/** d2-api errors keep the DHIS2 response in `response.data`, often with an empty `message`. */
function formatReviewItem(item: ReviewItem): string {
    const name = item.name ? ` ${item.name}` : "";
    return `${item.model}${name} [${item.id}] ${item.field}: ${item.detail}`;
}

function getErrorMessage(err: unknown): string {
    const data = (err as { response?: { data?: unknown } } | undefined)?.response?.data;
    const detail = data ? JSON.stringify(data).slice(0, ERROR_DETAIL_LENGTH) : "";
    const message = err instanceof Error ? err.message : "";
    return [message, detail].filter(Boolean).join(" ") || JSON.stringify(err);
}

/**
 * DHIS2 answers a rejected import with 409 and the import report in the body. Accepting it reads the
 * report from the response (each caller checks its status) instead of a thrown error, which d2-api
 * also dumps to the console with the whole request (event payloads included).
 */
const IMPORT_REQUEST = {
    validateStatus: (status: number) => (status >= 200 && status < 300) || status === 409,
};

function truncate(text: string): string {
    return text.length > ERROR_DETAIL_LENGTH ? `${text.slice(0, ERROR_DETAIL_LENGTH)}...` : text;
}

const TEMPORARY_CODE_PREFIX = "TMP_";
const IDS_PER_FILTER = 100;
const SCAN_FIELDS = "event,dataValues[dataElement,value]";
/** Largest window read with offset paging (50 pages): deeper pages get slower on large stages. */
const EVENTS_PER_WINDOW = 50_000;
/** A window is not split below this, even when it holds more events (they are then paged deeper). */
const MIN_WINDOW_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ERROR_DETAIL_LENGTH = 2000;
const EVENTS_PAGE_SIZE = 1000;
const EVENTS_CHUNK_SIZE = 500;
const EVENTS_BY_ID_CHUNK_SIZE = 50;
const DATA_VALUES_CHUNK_SIZE = 1000;
const DIMENSION_COLLECTIONS = ["dataElementDimensions", "attributeDimensions", "programIndicatorDimensions"];
const EXPRESSION_MODELS = [
    "programIndicators",
    "programRules",
    "programRuleActions",
    "indicators",
    "validationRules",
    "predictors",
] as const;
// mapViews are only reported (see the class comment).
const ANALYTICS_MODELS = ["eventVisualizations", "eventFilters"] as const;
type MetadataModel = typeof EXPRESSION_MODELS[number] | typeof ANALYTICS_MODELS[number];

/** COMMIT saves; VALIDATE only checks the payload against the server (dry run). */
type ImportMode = "COMMIT" | "VALIDATE";
type Ref = { id: Id };
type NamedRef = { id: Id; name: string };
type DataElement = NamedRef & { domainType: "AGGREGATE" | "TRACKER" };
type Variable = NamedRef & { program: Ref };
type Items = { dataElements: DataElement[]; attributes: NamedRef[]; variables: Variable[] };
type D2Object = { id: Id; [key: string]: unknown };
type DataValue = { dataElement: Id; value: string; [key: string]: unknown };
type D2DataValue = { dataElement: Id; value: string };
type D2Event = { event: Id; dataValues: D2DataValue[]; [key: string]: unknown };

type State = {
    options: D2Object[];
    dataValues: DataValue[];
    events: D2Event[];
    programIndicators: D2Object[];
    programRules: D2Object[];
    programRuleActions: D2Object[];
    indicators: D2Object[];
    validationRules: D2Object[];
    predictors: D2Object[];
    eventVisualizations: D2Object[];
    mapViews: D2Object[];
    eventFilters: D2Object[];
    /** Only read, to report the codes in their free text. */
    sqlViews: D2Object[];
    dataEntryForms: D2Object[];
};

type ImportSummary = {
    status?: string;
    importCount?: { imported: number; updated: number; ignored: number; deleted: number };
    conflicts?: unknown[];
};
type DataValuesResponse = ImportSummary & { response?: ImportSummary };
type TrackerError = { errorCode?: string; message?: string; uid?: string };
type TrackerResponse = {
    status: string;
    stats?: unknown;
    validationReport?: { errorReports?: TrackerError[] };
};
