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

And additional patterns you can find in folder src/domain/entities/options

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
