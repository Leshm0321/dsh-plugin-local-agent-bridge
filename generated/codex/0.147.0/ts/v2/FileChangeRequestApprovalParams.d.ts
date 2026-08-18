export type FileChangeRequestApprovalParams = {
    threadId: string;
    turnId: string;
    itemId: string;
    /**
     * Unix timestamp (in milliseconds) when this approval request started.
     */
    startedAtMs: number;
    /**
     * Optional explanatory reason (e.g. request for extra write access).
     */
    reason?: string | null;
    /**
     * [UNSTABLE] When set, the agent is asking the user to allow writes under this root
     * for the remainder of the session (unclear if this is honored today).
     */
    grantRoot?: string | null;
};
