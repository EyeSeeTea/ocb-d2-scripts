import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

/** Save the content as `<dir>/<prefix>_<date>.json` (creating `dir` if needed) and return its path. */
export function saveJsonToDisk(prefixFileName: string, contentFile: unknown, dir = "."): string {
    const currentDate = new Date().toISOString().replace("T", "_").replaceAll(":", "-").replaceAll(".", "-");
    const filePath = join(dir, `${prefixFileName}_${currentDate}.json`);

    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(contentFile, null, 2));
    return filePath;
}
