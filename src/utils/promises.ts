export function promiseMap<T, S>(inputValues: T[], mapper: (value: T) => Promise<S>): Promise<S[]> {
    return inputValues.reduce<Promise<S[]>>(
        (acc$, inputValue) => acc$.then(acc => mapper(inputValue).then(result => [...acc, result])),
        Promise.resolve([])
    );
}
