import { Codec, GetType, number, string, array } from "purify-ts/Codec";

/*
type ErrorHttpResponse: check if error response from d2-api include import reports.

d2-api error response example:

    {
        message: "Request failed with status code 409",
        response: {
            data: {
                typeReports: [
                    {
                        klass: "org.hisp.dhis.dataset.DataSet",
                        stats: {
                            created: 0,
                            updated: 0,
                            deleted: 0,
                            ignored: 2,
                            total: 2
                        },
                        objectReports: [
                            {
                                uid: "obj.id",
                                errorReports: [
                                    {
                                        message: "No matching object for reference. Identifier was UID, and object was [obj.id] (DataSet)."
                                    }
                                ]
                            }
                        ]
                    }
                ]
            }
        }
    }
*/
export type ErrorHttpResponse = GetType<typeof ErrorResponseCodec>;

// 1. Stats
export const StatsCodec = Codec.interface({
    created: number,
    updated: number,
    deleted: number,
    ignored: number,
    total: number,
});

export type StatsMetadata = GetType<typeof StatsCodec>;

// 2. ErrorReport
export const ErrorReportCodec = Codec.interface({
    message: string,
});

export type ErrorReport = GetType<typeof ErrorReportCodec>;

// 3. ObjectReport
export const ObjectReportCodec = Codec.interface({
    uid: string,
    errorReports: array(ErrorReportCodec),
});
export type ObjectReport = GetType<typeof ObjectReportCodec>;

// 4. TypeReport
export const TypeReportCodec = Codec.interface({
    klass: string,
    stats: StatsCodec,
    objectReports: array(ObjectReportCodec),
});
export type TypeReport = GetType<typeof TypeReportCodec>;

const InnerResponseCodec = Codec.interface({
    stats: StatsCodec,
    typeReports: array(TypeReportCodec),
});

const DataCodec = Codec.interface({
    response: InnerResponseCodec,
});

const ResponseCodec = Codec.interface({
    data: DataCodec,
});

export const ErrorResponseCodec = Codec.interface({
    response: ResponseCodec,
});
