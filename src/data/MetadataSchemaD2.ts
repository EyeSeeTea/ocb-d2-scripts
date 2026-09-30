import { D2Api } from "../types/d2-api";
import { Async } from "domain/entities/Async";

export type UnorderedCollectionsByModel = Readonly<Record<string, ReadonlyArray<string>>>;

export async function getUnorderedCollectionsByModel(api: D2Api): Async<UnorderedCollectionsByModel> {
    const { schemas } = await api
        .get<D2SchemasResponse>("/schemas", {
            fields: "plural,properties[collectionName,fieldName,collection,ordered]",
        })
        .getData();

    return Object.fromEntries(
        schemas.map(schema => [
            schema.plural,
            schema.properties
                .filter(property => property.collection && !property.ordered)
                .map(property => property.collectionName ?? property.fieldName),
        ])
    );
}

type D2SchemasResponse = {
    schemas: Array<{
        plural: string;
        properties: Array<{
            collectionName?: string;
            fieldName: string;
            collection: boolean;
            ordered: boolean;
        }>;
    }>;
};
