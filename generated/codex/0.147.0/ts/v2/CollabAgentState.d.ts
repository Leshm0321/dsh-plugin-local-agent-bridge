import type { CollabAgentStatus } from "./CollabAgentStatus";
export type CollabAgentState = {
    status: CollabAgentStatus;
    message: string | null;
};
