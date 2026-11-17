import { Id } from "domain/entities/Base";
import { CodeMapping, recodeValue } from "domain/entities/OptionCodeMapping";

/**
 * Pure logic to recode option codes used as filter values in DHIS2 analytics favourites and
 * working lists.
 *
 * Unlike expressions, where the code appears as a quoted literal, here the code is a whole filter
 * item, in two shapes:
 *
 * - Dimension filters (eventVisualizations, mapViews): `IN:CODE1;CODE2`, `EQ:CODE`, and chained
 *   operators such as `GE:5:LE:10`.
 * - Query criteria (eventFilters and other working lists): `{ dataItem, in: [CODE1, CODE2] }`.
 *
 * Items are compared for equality and never replaced as text: codes such as `RX` are a substring of
 * other codes (`RXTRA`). Only the dimensions and filters of the items bound to the option set are
 * recoded, since the same code may belong to other option sets used in the same object.
 */

// `OP:value[:OP:value]`, where the IN operator takes a `;` separated list of items.
const FILTER_PART_SEPARATOR = ":";
const IN_ITEM_SEPARATOR = ";";
const IN_OPERATOR = "IN";

export type ItemFilter = { dataItem?: string; attribute?: string; in?: string[]; eq?: string; like?: string };
export type QueryCriteria = { dataFilters?: ItemFilter[]; attributeValueFilters?: ItemFilter[] };

/** Item ids of a dimension: `dataElement`, `attribute` or `programIndicator` reference. */
type Dimension = {
    filter?: string;
    dataElement?: { id: Id };
    attribute?: { id: Id };
    programIndicator?: { id: Id };
};

/**
 * Recode a dimension filter. A code containing `:` or `;` cannot be expressed in this syntax, so it
 * cannot be referenced by one of these filters either, and is left untouched.
 */
export function recodeAnalyticsFilter(filter: string, mapping: CodeMapping): string {
    if (!filter) return filter;

    const parts = filter.split(FILTER_PART_SEPARATOR);

    return parts
        .map((part, index) => {
            const isOperator = index % 2 === 0;
            if (isOperator) return part;

            return parts[index - 1]?.toUpperCase() === IN_OPERATOR
                ? part
                      .split(IN_ITEM_SEPARATOR)
                      .map(item => recodeValue(item, mapping))
                      .join(IN_ITEM_SEPARATOR)
                : recodeValue(part, mapping);
        })
        .join(FILTER_PART_SEPARATOR);
}

/**
 * Recode the `filter` of the dimensions of the given collections whose item is one of `itemIds`,
 * keeping the rest of the object as it is, because the object is posted back in full.
 */
export function recodeDimensionCollections<T extends object>(
    object: T,
    collections: ReadonlyArray<string>,
    itemIds: ReadonlyArray<Id>,
    mapping: CodeMapping
): T {
    const ids = new Set(itemIds);

    return collections.reduce<T>((acc, collection) => {
        // The collections are named at runtime because d2-api types some of them as unknown[], and
        // because eventVisualizations and mapViews do not declare exactly the same set.
        const dimensions = (acc as Record<string, unknown>)[collection];
        if (!Array.isArray(dimensions)) return acc;

        const recodedDimensions = dimensions.map((dimension: Dimension) => {
            const itemId = getDimensionItemId(dimension);
            if (typeof dimension?.filter !== "string" || !itemId || !ids.has(itemId)) return dimension;

            const filter = recodeAnalyticsFilter(dimension.filter, mapping);
            return filter === dimension.filter ? dimension : { ...dimension, filter };
        });

        return recodedDimensions.every((dimension, index) => dimension === dimensions[index])
            ? acc
            : { ...acc, [collection]: recodedDimensions };
    }, object);
}

/**
 * Recode the values of the item filters of a working list criteria object, for the filters on
 * `dataItemIds` (dataFilters) or `attributeIds` (attributeValueFilters). `eventQueryCriteria` and its
 * siblings are typed as `unknown` by d2-api, hence the guards.
 */
export function recodeQueryCriteria<T>(
    criteria: T,
    itemIds: { dataElementIds: ReadonlyArray<Id>; attributeIds: ReadonlyArray<Id> },
    mapping: CodeMapping
): T {
    if (!isQueryCriteria(criteria)) return criteria;

    const dataElementIds = new Set(itemIds.dataElementIds);
    const attributeIds = new Set(itemIds.attributeIds);
    const properties = [
        {
            property: "dataFilters" as const,
            applies: (f: ItemFilter) => dataElementIds.has(f.dataItem ?? ""),
        },
        {
            property: "attributeValueFilters" as const,
            applies: (f: ItemFilter) => attributeIds.has(f.attribute ?? ""),
        },
    ];

    return properties.reduce((acc, { property, applies }) => {
        const filters = acc[property];
        if (!filters) return acc;

        const recodedFilters = filters.map(filter =>
            applies(filter) ? recodeItemFilter(filter, mapping) : filter
        );
        return recodedFilters.every((filter, index) => filter === filters[index])
            ? acc
            : { ...acc, [property]: recodedFilters };
    }, criteria);
}

/** `like` filters on the items match a part of a code and cannot be recoded, only reported. */
export function findLikeFilters(
    criteria: unknown,
    itemIds: { dataElementIds: ReadonlyArray<Id>; attributeIds: ReadonlyArray<Id> }
): ItemFilter[] {
    if (!isQueryCriteria(criteria)) return [];
    const ids = new Set([...itemIds.dataElementIds, ...itemIds.attributeIds]);
    const filters = [...(criteria.dataFilters ?? []), ...(criteria.attributeValueFilters ?? [])];
    return filters.filter(
        filter => filter.like !== undefined && ids.has(filter.dataItem ?? filter.attribute ?? "")
    );
}

function recodeItemFilter(filter: ItemFilter, mapping: CodeMapping): ItemFilter {
    const values = filter.in;
    const recodedValues = values?.map(value => recodeValue(value, mapping));
    const recodedEq = filter.eq === undefined ? undefined : recodeValue(filter.eq, mapping);

    const hasChanged =
        recodedEq !== filter.eq || !recodedValues?.every((value, index) => value === values?.[index]);

    if (!hasChanged) return filter;

    return {
        ...filter,
        ...(recodedValues ? { in: recodedValues } : {}),
        ...(recodedEq === undefined ? {} : { eq: recodedEq }),
    };
}

function getDimensionItemId(dimension: Dimension): Id | undefined {
    return dimension?.dataElement?.id ?? dimension?.attribute?.id ?? dimension?.programIndicator?.id;
}

function isQueryCriteria<T>(value: T): value is T & QueryCriteria {
    return typeof value === "object" && value !== null;
}
