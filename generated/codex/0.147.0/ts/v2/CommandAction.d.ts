import type { LegacyAppPathString } from "../LegacyAppPathString";
export type CommandAction = {
    "type": "read";
    command: string;
    name: string;
    path: LegacyAppPathString;
} | {
    "type": "listFiles";
    command: string;
    path: string | null;
} | {
    "type": "search";
    command: string;
    query: string | null;
    path: string | null;
} | {
    "type": "unknown";
    command: string;
};
