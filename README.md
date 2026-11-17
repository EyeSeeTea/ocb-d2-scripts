## Setup

The required node version is v18.20.8. Alternatively, you can run:

```shell
nvm use
```

To build the script run:

```shell
yarn install
yarn build
```

## How to run

The entry point CLI is executed with `yarn start`. Pass `--help` to show commands and arguments to commands:

```shell
yarn start --help
# ...
yarn start options --help
```

The default log level is `info`. Set the desired level using env variable `LOG_LEVEL`:

```shell
LOG_LEVEL=debug yarn start options
```

Available levels: 'debug' | 'info' | 'warn' | 'error'

## Options

### analyze

Analyze optionSet code/name and generates a csv report if:

Option Sets Name and Option Name:

-   Errors: commas and back and forward slashes

Option Sets code and Option code:

-   Accepted: Upper case and underscore
-   Errors: All the other characters. Name and code uniques across option sets.

Additional patterns can be found in the folder src/domain/entities/options (files ending with Strategy).

```shell
yarn start options analyze \
    --url='http://localhost:8080' \
    --auth='username:password or PAT token' \
    --services-path=services.csv \
    --projects-path=projects.csv \
    --exceptions-path=exceptions.csv \
    --report-path='optionset-report.csv' \
    --unknown-report-path='unknown-optionset-report.csv' \
    --mapping-path='option-code-changes.csv' \
    --update
```

The paths shown are the defaults. `--update` persists the option set codes.

Option codes are never saved by `analyze`: renaming a code must also recode its data and metadata
references. The proposed option code changes are written to `--mapping-path`, in the format read by
[recode](#recode), to be reviewed and applied with it. `--update` only saves option set codes.

#### Square brackets mode

`--square-brackets` sets the code of every option to the content of the square brackets of its name.
An option whose name has no square brackets is left as it is, whatever its code:

| option name                          | option code | result                             |
| ------------------------------------ | ----------- | ---------------------------------- |
| `[O-MEN] Outbreak case - meningitis` | `TOP`       | `O-MEN`                            |
| `[O-MEN] Outbreak case - meningitis` | `O-MEN`     | not reported, already matches      |
| `Vaginal delivery (MAT)`             | `[VD]`      | untouched, no brackets in the name |
| `[] No content`                      | `ABC`       | untouched, blank group             |
| `[A] Text [B]`                       | `X`         | `A`, the first group               |

The content is taken literally, without normalizing it, so the resulting code can contain characters
such as `-`.

It is an exclusive mode: it replaces the category conventions instead of complementing them, applies
to every option set including the ones without a category, and needs neither `--services-path` nor
`--projects-path`. The report of unknown option sets is generated empty, since the category plays no
part here.

An option set cannot hold two options with the same code. When two options of the same set would end
up with the same one, they are reported with the rule `duplicated_code` and no value to update, and
none of them is modified.

```shell
yarn start options analyze \
    --url='http://localhost:8080' \
    --auth='username:password or PAT token' \
    --square-brackets \
    --report-path='report-name.csv' \
    --mapping-path='option-code-changes.csv'
```

Services must be a csv file with the following format:

```csv
SE1
SE2
SE3
```

Same for exceptions:

```csv
Another
List
Of
Words
```

Projects must be a csv with [name,code] format:

```csv
PCode-1,Project Code1
PCode-2,Project Code2
PCode-3,Project Code3
```

### recode

Recode option codes from a mapping CSV, together with every reference to them. The CSV is read by
header name, so the client file (`option-code-changes.csv`) or the one written by `analyze` can be used
as they are; other columns are ignored:

| column            | required | description                      |
| ----------------- | -------- | -------------------------------- |
| `option_set_id`   | yes      | option set of the option         |
| `option_id`       | yes      | option to recode                 |
| `current_code`    | yes      | expected code on the server      |
| `proposed_code`   | yes      | new code                         |
| `change_type`     | no       | see below; empty means a recode  |
| `option_set_name` | no       | label for the reviewer, not used |
| `option_name`     | no       | label for the reviewer, not used |

`change_type`: `RECODE`, `BRACKETS_ONLY` and `PROPOSED` (written by `analyze`) are applied, `RECODE_TBC`
only with `--include-to-be-confirmed`, and `NO_CHANGE` is skipped. Any other value rejects the whole file
before any change, listing its rows.

```shell
yarn start options recode \
    --url='http://localhost:8080' \
    --auth='username:password or PAT token' \
    --mapping-path='option-code-changes.csv' \
    --report-path='option-recode-report.csv' \
    --backup-dir='.' \
    --include-to-be-confirmed \
    --update
```

Without `--update` it is a dry run: nothing is saved, but every import of each option set is validated by
the server (metadata and events with `importMode=VALIDATE`, data values with `dryRun=true`), so a rejection
(e.g. an event whose org unit is no longer assigned to its program) is reported as `error` before the
update. Data values and events are validated with their current values, since the new ones are not option
codes yet. `--include-to-be-confirmed` also applies the `RECODE_TBC` rows. The
report path and backup directory shown are the defaults. Next to the report, a `-summary.csv` has the counts
per option set, the number of items to review and the backup file, and a `-review.csv` lists the items to
review, one per row (`model`, `id`, `name`, `field`, `detail`).

Every row is validated against the server before any change, and reported with a status (`pending`
in a dry run, `applied`, `already_applied`, `skipped`, `error`) and a reason:

-   The option must exist, belong to the option set and still have `current_code`. An option already at
    `proposed_code` is `already_applied`, so running the same mapping again is a no-op.
-   The final codes of the option set must be unique, counting the options not in the mapping (DHIS2
    rejects two options with the same code in a set). A change whose code is held by an option that
    keeps it is rejected, and so are the changes that depend on it.

Each option set is recoded as a whole: every value is mapped once from its original code, so chained
(`13 -> 1` while `1 -> 2`) and cyclic mappings give the right result whatever the order of the rows.
When a target code is still held by another option of the set, the options go through temporary codes
(`TMP_<optionId>`) first. The script recodes:

-   `dataValues` and tracker `events` of the data elements of the option set. Events are found by reading
    the values of every event of the stages that hold the data elements: each stage is read once for all
    the option sets of the mapping, a large stage in windows of `updatedAt` (at most 50,000 events each),
    and the events read must add up to the count of the stage, or the run fails. Data entry must be
    stopped while it runs.
-   `programIndicators` (`expression`, `filter`), `programRules` (`condition`) and
    `programRuleActions` (`data`): a quoted code is recoded only when it is compared with an item of
    the option set (`#{stage.de} == 'CODE'`, `'CODE' != A{tea}`, `d2:countIfValue(#{de}, 'CODE')`, or a
    program rule variable bound to them), since the same code may belong to other option sets.
-   `indicators` (`numerator`, `denominator`), `validationRules` (`leftSide`, `rightSide`) and
    `predictors` (`generator`, `sampleSkipTest`), whose aggregate expressions may compare a data element of
    the option set with a code (`if(#{de.coc} == 'CODE', 1, 0)`), with the same rule.
-   `eventVisualizations` dimension filters (`IN:CODE1;CODE2`, `EQ:CODE`) of the items of the option set
    (data elements, attributes and program indicators returning them), and `eventFilters` criteria
    (`eventQueryCriteria.dataFilters`). `eventReports` and `eventCharts` are legacy views over the same
    `eventVisualizations`.

Listed in the `-review.csv` for manual review, never changed: codes in free texts
(`programRuleActions.content`, and `sqlViews` queries and custom forms that mention an item of the
option set) or out of a comparison with an item, `like` filters, tracked entity attribute values, and
`mapViews` (on DHIS2 2.40 a mapView posted on its own is accepted but not saved, and a map PUT recreates
its mapViews without their dimension filters).

Not affected by design: references by uid (`programRuleActions.option`, option groups, program rule
variables) and aggregate visualizations (a program data element item cannot filter by option). Not
handled: tracker and program stage working lists (`trackedEntityInstanceFilters`,
`programStageWorkingLists`); application data in the `dataStore` must be checked by hand.

Order: options, metadata, then data (the tracker validates values against the current option codes).
Before any change, the initial state of each option set is written to
`<backup-dir>/recode_<optionSetId>_<date>.json` (the directory is created if needed).
If a step fails, the objects already changed are restored, the rows of that option set are reported as
`error`, and the next option set is processed.

## Metadata

### sync

Get a comparison between a main server and multiple replicas:

-   Identify metadata objects that exist only in one of the instances (based on IDs).
-   Detect objects with the same ID but different codes to flag discrepancies.
-   Detect objects with the same ID but different in any fields.

\*For users `OIDC` is being used as `ID`

```shell
yarn start metadata sync \
--check-models=users,indicators \
--ignore-models=ignore-models.csv \ # metadata you want to exclude
--server-config=servers_msf.json \
--action=DELETE \
--persist
```

-   check-models: any valid DHIS2 metadata. Check the `getAllMetadataModels` function in the `sync.ts` file for the complete list
-   ignore-models: a csv file with the models you want to ignore
-   action: action to perform on metadata: CREATE, CREATE_AND_UPDATE, DELETE and DELETE_WITH_DATA. Metadata is **always** generated to disk even if no action is provided. DELETE_WITH_DATA is only supported for dataElements (aggregate/trackers)
-   persist: persist changes to the server. false if omitted

```csv
users
dashboards
visualizations
```

-   server-config: a json file with servers configuration:

```ts
{
    "servers": [
        {
            "url": "https://play.im.dhis2.org/stable-2-40-7-1",
            "auth": "admin:district",
            // you can use a PAT token as an alternative to user/passwod authentication
            "personalToken": "your_token_here",
            // isMain must be used for the METADATA server
            "isMain": true
        },
        {
            "url": "https://play.im.dhis2.org/stable-2-41-4",
            "auth": "admin:district"
        }
    ]
}
```
