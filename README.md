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
    --report-path='report-name.csv' \  # default is option-report.csv
    --unknown-report-path='unknown-optionset-report.csv' # default is unknown-optionset-report.csv
    --update # persist changes
```

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
    --update # persist changes
```

#### Renaming an option code

With `--update`, changing an option code also recodes everything that references the old code:

-   `dataValues` and tracker `events`, where the code is used as a value.
-   `programIndicators` (`expression`, `filter`), `programRules` (`condition`) and
    `programRuleActions` (`data`, `content`), where the code is referenced as a quoted literal inside
    an expression. References by uid, such as `programRuleActions.option`, are not affected by a code
    change and are left untouched.
-   `eventVisualizations` and `mapViews`, where the code is a filter item of a dimension
    (`IN:CODE1;CODE2`), and `eventFilters`, where it is a value of `eventQueryCriteria.dataFilters`.
    These are located through the data elements and tracked entity attributes bound to the option
    set, the same chain used for dataValues and events. Maps are not posted: a mapView belongs to a
    single map, so updating the mapView updates what `maps.mapViews` shows. `eventReports` and
    `eventCharts` need no separate handling, since they are legacy views over the same
    `eventVisualizations`.

Before anything is modified, the initial state is written to disk as `dataValues_<optionId>_<date>.json`,
`events_<optionId>_<date>.json`, `programMetadata_<optionId>_<date>.json` and
`analyticsMetadata_<optionId>_<date>.json`. Each metadata backup contains the complete objects, so it
can be posted back as it is. If any step fails, the script rolls back the option code and every
collection it had already updated.

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
