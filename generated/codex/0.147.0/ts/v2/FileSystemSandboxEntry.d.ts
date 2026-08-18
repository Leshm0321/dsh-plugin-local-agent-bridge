import type { FileSystemAccessMode } from "./FileSystemAccessMode";
import type { FileSystemPath } from "./FileSystemPath";
export type FileSystemSandboxEntry = {
    path: FileSystemPath;
    access: FileSystemAccessMode;
};
