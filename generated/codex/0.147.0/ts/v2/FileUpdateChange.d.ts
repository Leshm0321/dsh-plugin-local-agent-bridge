import type { PatchChangeKind } from "./PatchChangeKind";
export type FileUpdateChange = {
    path: string;
    kind: PatchChangeKind;
    diff: string;
};
