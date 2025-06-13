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

And additional patterns you can find in folder src/domain/entities/options (files ends with Strategy)

```shell
yarn start options analyze \
    --url='http://localhost:8080' \
    --auth='username:password' \
    --services-path=services.csv \
    --projects-path=projects.csv \
    --exceptions-path=exceptions.csv \
    --report-path='report-name.csv' \  # default is option-report.csv
    --unknown-report-path='unknown-optionset-report.csv' # default is unknown-optionset-report.csv
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

## Metadata

### sync

Get a comparison between a main server and multiple replicas:

-   Identify metadata objects that exist only in one of the instances (based on IDs).
-   Detect objects with the same ID but different codes to flag discrepancies.
-   Detect objects with the same ID but different in any fields.

\*For users `openId` is being used as `ID`

```bash
yarn start metadata sync \
--check-models=users,indicators \
--ignore-models=ignore-models.csv \ # metadata you want to exclude
--server-config=servers_msf.json
```

-   check-models: any valid DHIS2 metadata. Check the `getAllMetadataModels` function in the `sync.ts` file for the complete list
-   ignore-models: a csv file with the models you want to ignore:

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
            // isMain must be use for the METADATA server
            "isMain": true
        },
        {
            "url": "https://play.im.dhis2.org/stable-2-41-4",
            "auth": "admin:district"
        }
    ]
}
```
