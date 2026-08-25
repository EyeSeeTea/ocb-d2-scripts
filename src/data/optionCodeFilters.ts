/**
 * Pure logic to recode an option code used as a filter value in DHIS2 analytics favourites and
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
 * other codes (`RXTRA`), and a text replacement would corrupt them.
 */

// `OP:value[:OP:value]`, where the IN operator takes a `;` separated list of items.
const FILTER_PART_SEPARATOR = ":";
const IN_ITEM_SEPARATOR = ";";
const IN_OPERATOR = "IN";

export type DimensionWithFilter = { filter?: string };
export type ItemFilter = { in?: string[]; eq?: string };
export type QueryCriteria = { dataFilters?: ItemFilter[]; attributeValueFilters?: ItemFilter[] };

/**
 * Recode a dimension filter. A code containing `:` or `;` cannot be expressed in this syntax, so it
 * cannot be referenced by one of these filters either, and is left untouched.
 */
export function recodeAnalyticsFilter(filter: string, fromCode: string, toCode: string): string {
    if (!filter || !fromCode) return filter;

    const parts = filter.split(FILTER_PART_SEPARATOR);

    return parts
        .map((part, index) => {
            const isOperator = index % 2 === 0;
            if (isOperator) return part;

            return parts[index - 1]?.toUpperCase() === IN_OPERATOR
                ? part
                      .split(IN_ITEM_SEPARATOR)
                      .map(item => recodeItem(item, fromCode, toCode))
                      .join(IN_ITEM_SEPARATOR)
                : recodeItem(part, fromCode, toCode);
        })
        .join(FILTER_PART_SEPARATOR);
}

/**
 * Recode the `filter` of every dimension that has one, keeping the rest of each dimension as it is.
 * The collections are typed as `unknown[]` by d2-api for attribute dimensions, hence the guard.
 */
export function recodeDimensions<T>(
    dimensions: ReadonlyArray<T>,
    fromCode: string,
    toCode: string
): T[] {
    return dimensions.map(dimension => {
        if (!hasFilter(dimension)) return dimension;

        const filter = recodeAnalyticsFilter(dimension.filter, fromCode, toCode);
        return filter === dimension.filter ? dimension : { ...dimension, filter };
    });
}

/**
 * Recode the `filter` of the dimensions held in the given collections, keeping the rest of the
 * object as it is, because the object is posted back in full.
 */
export function recodeDimensionCollections<T extends object>(
    object: T,
    collections: ReadonlyArray<string>,
    fromCode: string,
    toCode: string
): T {
    return collections.reduce<T>((acc, collection) => {
        // The collections are named at runtime because d2-api types some of them as unknown[], and
        // because eventVisualizations and mapViews do not declare exactly the same set.
        const dimensions = (acc as Record<string, unknown>)[collection];
        if (!Array.isArray(dimensions)) return acc;

        const recodedDimensions = recodeDimensions(dimensions, fromCode, toCode);
        return recodedDimensions.every((dimension, index) => dimension === dimensions[index])
            ? acc
            : { ...acc, [collection]: recodedDimensions };
    }, object);
}

/**
 * Recode the values of the item filters of a working list criteria object. `eventQueryCriteria` and
 * its siblings are typed as `unknown` by d2-api, hence the guards.
 */
export function recodeQueryCriteria<T>(criteria: T, fromCode: string, toCode: string): T {
    if (!isQueryCriteria(criteria)) return criteria;

    return criteriaFilterProperties.reduce((acc, property) => {
        const filters = acc[property];
        if (!filters) return acc;

        const recodedFilters = filters.map(filter => recodeItemFilter(filter, fromCode, toCode));
        return recodedFilters.every((filter, index) => filter === filters[index])
            ? acc
            : { ...acc, [property]: recodedFilters };
    }, criteria);
}

const criteriaFilterProperties = ["dataFilters", "attributeValueFilters"] as const;

function recodeItemFilter(filter: ItemFilter, fromCode: string, toCode: string): ItemFilter {
    const values = filter.in;
    const recodedValues = values?.map(value => recodeItem(value, fromCode, toCode));
    const recodedEq = filter.eq === undefined ? undefined : recodeItem(filter.eq, fromCode, toCode);

    const hasChanged =
        recodedEq !== filter.eq || !recodedValues?.every((value, index) => value === values?.[index]);

    if (!hasChanged) return filter;

    return {
        ...filter,
        ...(recodedValues ? { in: recodedValues } : {}),
        ...(recodedEq === undefined ? {} : { eq: recodedEq }),
    };
}

function recodeItem(item: string, fromCode: string, toCode: string): string {
    return item === fromCode ? toCode : item;
}

function hasFilter<T>(value: T): value is T & { filter: string } {
    return typeof (value as DimensionWithFilter)?.filter === "string";
}

function isQueryCriteria<T>(value: T): value is T & QueryCriteria {
    return typeof value === "object" && value !== null;
}
