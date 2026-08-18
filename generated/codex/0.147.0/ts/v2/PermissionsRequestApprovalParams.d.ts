import type { AbsolutePathBuf } from "../AbsolutePathBuf";
import type { RequestPermissionProfile } from "./RequestPermissionProfile";
export type PermissionsRequestApprovalParams = {
    threadId: string;
    turnId: string;
    itemId: string;
    environmentId: string | null;
    /**
     * Unix timestamp (in milliseconds) when this approval request started.
     */
    startedAtMs: number;
    cwd: AbsolutePathBuf;
    reason: string | null;
    permissions: RequestPermissionProfile;
};
