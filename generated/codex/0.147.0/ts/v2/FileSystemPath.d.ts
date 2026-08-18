import type { LegacyAppPathString } from "../LegacyAppPathString";
import type { FileSystemSpecialPath } from "./FileSystemSpecialPath";
export type FileSystemPath = {
    "type": "path";
    path: LegacyAppPathString;
} | {
    "type": "glob_pattern";
    pattern: string;
} | {
    "type": "special";
    value: FileSystemSpecialPath;
};
