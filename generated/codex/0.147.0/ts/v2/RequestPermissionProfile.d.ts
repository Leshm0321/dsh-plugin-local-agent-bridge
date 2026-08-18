import type { AdditionalFileSystemPermissions } from "./AdditionalFileSystemPermissions";
import type { AdditionalNetworkPermissions } from "./AdditionalNetworkPermissions";
export type RequestPermissionProfile = {
    network: AdditionalNetworkPermissions | null;
    fileSystem: AdditionalFileSystemPermissions | null;
};
