import type { AdditionalFileSystemPermissions } from "./AdditionalFileSystemPermissions";
import type { AdditionalNetworkPermissions } from "./AdditionalNetworkPermissions";
export type AdditionalPermissionProfile = {
    /**
     * Partial overlay used for per-command permission requests.
     */
    network: AdditionalNetworkPermissions | null;
    fileSystem: AdditionalFileSystemPermissions | null;
};
