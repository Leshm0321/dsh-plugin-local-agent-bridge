import type { LegacyAppPathString } from "../LegacyAppPathString";
import type { FileSystemSandboxEntry } from "./FileSystemSandboxEntry";
export type AdditionalFileSystemPermissions = {
    /**
     * This will be removed in favor of `entries`.
     */
    read: Array<LegacyAppPathString> | null;
    /**
     * This will be removed in favor of `entries`.
     */
    write: Array<LegacyAppPathString> | null;
    globScanMaxDepth?: number;
    entries?: Array<FileSystemSandboxEntry>;
};
