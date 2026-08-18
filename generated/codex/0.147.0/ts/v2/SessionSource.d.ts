import type { SubAgentSource } from "../SubAgentSource";
export type SessionSource = "cli" | "vscode" | "exec" | "appServer" | {
    "custom": string;
} | {
    "subAgent": SubAgentSource;
} | "unknown";
