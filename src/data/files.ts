import { writeFileSync } from "fs";

/** Save the content as `<prefix>_<date>.json` in the current directory and return the file name. */
export function saveJsonToDisk(prefixFileName: string, contentFile: unknown): string {
    const currentDate = new Date().toISOString().replace("T", "_").replaceAll(":", "-").replaceAll(".", "-");
    const fileName = `${prefixFileName}_${currentDate}.json`;

    writeFileSync(fileName, JSON.stringify(contentFile, null, 2));
    return fileName;
}
