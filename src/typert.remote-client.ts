import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type {
  BridgeCatalogRequest,
  BridgeCatalogResult,
  BridgeCompletionsResult,
  BridgeDirectoryAddRequest,
  BridgeDirectoryPublishRequest,
  BridgeDirectoryRequest,
  BridgeWorkspaceView,
  BridgeInteractionRespondRequest,
  BridgeModelRequest,
  BridgeModelsResult,
  BridgeNativeSessionsRequest,
  BridgeNativeSessionsResult,
  BridgeFileSearchRequest,
  BridgeFileSearchResult,
  BridgePermissionModeRequest,
  BridgePrivacyClearRequest,
  BridgePrivacyPasswordRequest,
  BridgePrivacyState,
  BridgePrivacyUnlockRequest,
  BridgePrivacyUnlockResult,
  BridgeSessionsListRequest,
  BridgeInteractionRespondResult,
  BridgeSendResult,
  BridgeSessionArchiveRequest,
  BridgeSessionPinRequest,
  BridgeSessionRenameRequest,
  BridgeSessionCreateRequest,
  BridgeSessionIdRequest,
  BridgeSessionReadRequest,
  BridgeSessionReadResult,
  BridgeSessionSendRequest,
  BridgeSessionView,
  BridgeHostListRequest,
  BridgeHostListing,
  BridgeRepository,
  BridgeUploadRequest,
  BridgeWorkspaceFile,
  BridgeDiffHunk,
  BridgeWorkspaceCreateRequest,
  BridgeWorkspaceFileRequest,
  BridgeWorkspaceRenameRequest,
  BridgeWorkspaceWriteRequest,
  BridgeWorkspaceListRequest,
  BridgeWorkspaceDiff,
  BridgeWorkspaceListing,
  BridgeUploadResult,
} from './types.ts'
import { LOCAL_AGENT_BRIDGE_INVOCATIONS } from './typert.shared.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$6c6f63616c4167656e74427269646765 {
    catalog: (request: BridgeCatalogRequest) => Promise<RemoteResult<BridgeCatalogResult>>
    sessionsList: (request: BridgeSessionsListRequest) => Promise<RemoteResult<BridgeSessionView[]>>
    sessionCreate: (request: BridgeSessionCreateRequest) => Promise<RemoteResult<BridgeSessionView>>
    sessionRead: (
      request: BridgeSessionReadRequest,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<BridgeSessionReadResult>>
    sessionSend: (request: BridgeSessionSendRequest) => Promise<RemoteResult<BridgeSendResult>>
    sessionCancel: (request: BridgeSessionIdRequest) => Promise<RemoteResult<void>>
    sessionArchive: (request: BridgeSessionArchiveRequest) => Promise<RemoteResult<BridgeSessionView>>
    sessionRename: (request: BridgeSessionRenameRequest) => Promise<RemoteResult<BridgeSessionView>>
    sessionPin: (request: BridgeSessionPinRequest) => Promise<RemoteResult<BridgeSessionView>>
    interactionRespond: (
      request: BridgeInteractionRespondRequest,
    ) => Promise<RemoteResult<BridgeInteractionRespondResult>>
    sessionCompletions: (request: BridgeSessionIdRequest) => Promise<RemoteResult<BridgeCompletionsResult>>
    nativeSessions: (
      request: BridgeNativeSessionsRequest,
    ) => Promise<RemoteResult<BridgeNativeSessionsResult>>
    directoryAdd: (request: BridgeDirectoryAddRequest) => Promise<RemoteResult<BridgeWorkspaceView>>
    directoryRemove: (request: BridgeDirectoryRequest) => Promise<RemoteResult<void>>
    directoryPublish: (request: BridgeDirectoryPublishRequest) => Promise<RemoteResult<BridgeWorkspaceView>>
    sessionPermissionMode: (request: BridgePermissionModeRequest) => Promise<RemoteResult<BridgeSessionView>>
    sessionFiles: (request: BridgeFileSearchRequest) => Promise<RemoteResult<BridgeFileSearchResult>>
    sessionModels: (request: BridgeSessionIdRequest) => Promise<RemoteResult<BridgeModelsResult>>
    sessionModel: (request: BridgeModelRequest) => Promise<RemoteResult<BridgeSessionView>>
    sessionUpload: (request: BridgeUploadRequest) => Promise<RemoteResult<BridgeUploadResult>>
    sessionRepository: (request: BridgeSessionIdRequest) => Promise<RemoteResult<BridgeRepository | null>>
    hostList: (request: BridgeHostListRequest) => Promise<RemoteResult<BridgeHostListing>>
    workspaceList: (request: BridgeWorkspaceListRequest) => Promise<RemoteResult<BridgeWorkspaceListing>>
    workspaceFile: (request: BridgeWorkspaceFileRequest) => Promise<RemoteResult<BridgeWorkspaceFile>>
    workspaceWrite: (request: BridgeWorkspaceWriteRequest) => Promise<RemoteResult<BridgeWorkspaceFile>>
    workspaceDiff: (request: BridgeSessionIdRequest) => Promise<RemoteResult<BridgeWorkspaceDiff>>
    workspaceFileDiff: (request: BridgeWorkspaceFileRequest) => Promise<RemoteResult<readonly BridgeDiffHunk[]>>
    workspaceCreate: (request: BridgeWorkspaceCreateRequest) => Promise<RemoteResult<void>>
    workspaceRename: (request: BridgeWorkspaceRenameRequest) => Promise<RemoteResult<void>>
    workspaceDelete: (request: BridgeWorkspaceFileRequest) => Promise<RemoteResult<void>>
    privacyState: (request: BridgeCatalogRequest) => Promise<RemoteResult<BridgePrivacyState>>
    privacyUnlock: (request: BridgePrivacyUnlockRequest) => Promise<RemoteResult<BridgePrivacyUnlockResult>>
    privacyPassword: (request: BridgePrivacyPasswordRequest) => Promise<RemoteResult<BridgePrivacyState>>
    privacyClear: (request: BridgePrivacyClearRequest) => Promise<RemoteResult<BridgePrivacyState>>
    privacyLock: (request: BridgeCatalogRequest) => Promise<RemoteResult<void>>
  }

  interface TypertRemoteMap {
    'localAgentBridge/catalog': (request: BridgeCatalogRequest) => Promise<RemoteResult<BridgeCatalogResult>>
    'localAgentBridge/sessionsList': (request: BridgeSessionsListRequest) => Promise<RemoteResult<BridgeSessionView[]>>
    'localAgentBridge/sessionCreate': (
      request: BridgeSessionCreateRequest,
    ) => Promise<RemoteResult<BridgeSessionView>>
    'localAgentBridge/sessionRead': (
      request: BridgeSessionReadRequest,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<BridgeSessionReadResult>>
    'localAgentBridge/sessionSend': (
      request: BridgeSessionSendRequest,
    ) => Promise<RemoteResult<BridgeSendResult>>
    'localAgentBridge/sessionCancel': (request: BridgeSessionIdRequest) => Promise<RemoteResult<void>>
    'localAgentBridge/sessionArchive': (
      request: BridgeSessionArchiveRequest,
    ) => Promise<RemoteResult<BridgeSessionView>>
    'localAgentBridge/sessionRename': (
      request: BridgeSessionRenameRequest,
    ) => Promise<RemoteResult<BridgeSessionView>>
    'localAgentBridge/sessionPin': (
      request: BridgeSessionPinRequest,
    ) => Promise<RemoteResult<BridgeSessionView>>
    'localAgentBridge/interactionRespond': (
      request: BridgeInteractionRespondRequest,
    ) => Promise<RemoteResult<BridgeInteractionRespondResult>>
    'localAgentBridge/sessionCompletions': (
      request: BridgeSessionIdRequest,
    ) => Promise<RemoteResult<BridgeCompletionsResult>>
    'localAgentBridge/nativeSessions': (
      request: BridgeNativeSessionsRequest,
    ) => Promise<RemoteResult<BridgeNativeSessionsResult>>
    'localAgentBridge/directoryAdd': (
      request: BridgeDirectoryAddRequest,
    ) => Promise<RemoteResult<BridgeWorkspaceView>>
    'localAgentBridge/directoryRemove': (request: BridgeDirectoryRequest) => Promise<RemoteResult<void>>
    'localAgentBridge/directoryPublish': (
      request: BridgeDirectoryPublishRequest,
    ) => Promise<RemoteResult<BridgeWorkspaceView>>
    'localAgentBridge/sessionPermissionMode': (
      request: BridgePermissionModeRequest,
    ) => Promise<RemoteResult<BridgeSessionView>>
    'localAgentBridge/sessionFiles': (
      request: BridgeFileSearchRequest,
    ) => Promise<RemoteResult<BridgeFileSearchResult>>
    'localAgentBridge/sessionModels': (
      request: BridgeSessionIdRequest,
    ) => Promise<RemoteResult<BridgeModelsResult>>
    'localAgentBridge/sessionModel': (
      request: BridgeModelRequest,
    ) => Promise<RemoteResult<BridgeSessionView>>
    'localAgentBridge/sessionUpload': (
      request: BridgeUploadRequest,
    ) => Promise<RemoteResult<BridgeUploadResult>>
    'localAgentBridge/sessionRepository': (
      request: BridgeSessionIdRequest,
    ) => Promise<RemoteResult<BridgeRepository | null>>
    'localAgentBridge/hostList': (
      request: BridgeHostListRequest,
    ) => Promise<RemoteResult<BridgeHostListing>>
    'localAgentBridge/workspaceList': (
      request: BridgeWorkspaceListRequest,
    ) => Promise<RemoteResult<BridgeWorkspaceListing>>
    'localAgentBridge/workspaceFile': (
      request: BridgeWorkspaceFileRequest,
    ) => Promise<RemoteResult<BridgeWorkspaceFile>>
    'localAgentBridge/workspaceWrite': (
      request: BridgeWorkspaceWriteRequest,
    ) => Promise<RemoteResult<BridgeWorkspaceFile>>
    'localAgentBridge/workspaceDiff': (
      request: BridgeSessionIdRequest,
    ) => Promise<RemoteResult<BridgeWorkspaceDiff>>
    'localAgentBridge/workspaceFileDiff': (
      request: BridgeWorkspaceFileRequest,
    ) => Promise<RemoteResult<readonly BridgeDiffHunk[]>>
    'localAgentBridge/workspaceCreate': (
      request: BridgeWorkspaceCreateRequest,
    ) => Promise<RemoteResult<void>>
    'localAgentBridge/workspaceRename': (
      request: BridgeWorkspaceRenameRequest,
    ) => Promise<RemoteResult<void>>
    'localAgentBridge/workspaceDelete': (
      request: BridgeWorkspaceFileRequest,
    ) => Promise<RemoteResult<void>>
    'localAgentBridge/privacyState': (request: BridgeCatalogRequest) => Promise<RemoteResult<BridgePrivacyState>>
    'localAgentBridge/privacyUnlock': (
      request: BridgePrivacyUnlockRequest,
    ) => Promise<RemoteResult<BridgePrivacyUnlockResult>>
    'localAgentBridge/privacyPassword': (
      request: BridgePrivacyPasswordRequest,
    ) => Promise<RemoteResult<BridgePrivacyState>>
    'localAgentBridge/privacyClear': (
      request: BridgePrivacyClearRequest,
    ) => Promise<RemoteResult<BridgePrivacyState>>
    'localAgentBridge/privacyLock': (request: BridgeCatalogRequest) => Promise<RemoteResult<void>>
  }

  interface TypertRemoteNamespaceMap {
    localAgentBridge: TypertRemoteNamespace$6c6f63616c4167656e74427269646765
  }
}

export const TYPERT_REMOTE: TypertRemoteContribution = {
  package: 'dsh-plugin-local-agent-bridge',
  descriptors: LOCAL_AGENT_BRIDGE_INVOCATIONS,
}

export default TYPERT_REMOTE

