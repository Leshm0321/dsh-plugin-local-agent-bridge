import type { BridgeErrorCode } from '../types.ts'
import { redactText } from './redaction.ts'

const SAFE_MESSAGES: Record<BridgeErrorCode, string> = {
  EXECUTABLE_NOT_FOUND: 'The product is not installed on the host PATH.',
  UNSUPPORTED_VERSION: 'The installed product version is not supported by this bridge.',
  PROVIDER_START_FAILED: 'The product could not be started on the host.',
  HOST_AUTH_REQUIRED: 'The product login on the host has expired. Re-authenticate on the host, then refresh.',
  PROVIDER_PROTOCOL_ERROR: 'The native product returned an incompatible protocol response.',
  WORKSPACE_NOT_AVAILABLE: 'The selected DeepSeek Harness workspace is not available.',
  SESSION_NOT_FOUND: 'The bridge session does not exist.',
  NATIVE_SESSION_ORPHANED: 'The native product session can no longer be resumed.',
  TURN_CONFLICT: 'This session already has an active turn.',
  INTERACTION_EXPIRED: 'This approval or question is no longer active.',
  USER_CANCELLED: 'The turn was cancelled.',
  CONTEXT_LIMIT: 'The native product reached its context limit.',
  CONNECTION_LOST: 'The connection to the native product was lost.',
  CLEANUP_FAILED: 'The native product process did not shut down cleanly.',
  INVALID_REQUEST: 'The request is invalid.',
}

export class BridgeError extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string = SAFE_MESSAGES[code],
    readonly causeDetail?: unknown,
  ) {
    super(redactText(message))
    this.name = 'BridgeError'
  }
}

export function bridgeError(error: unknown, fallback: BridgeErrorCode): BridgeError {
  if (error instanceof BridgeError) return error
  const message = error instanceof Error ? error.message : String(error)
  if (/auth|login|oauth|unauthori[sz]ed|credential/i.test(message)) {
    return new BridgeError('HOST_AUTH_REQUIRED', undefined, error)
  }
  if (/context window|context limit|max tokens/i.test(message)) {
    return new BridgeError('CONTEXT_LIMIT', undefined, error)
  }
  if (/abort|cancel|interrupt/i.test(message)) {
    return new BridgeError('USER_CANCELLED', undefined, error)
  }
  return new BridgeError(fallback, undefined, error)
}

export function safeMessage(error: unknown, fallback: BridgeErrorCode): string {
  return bridgeError(error, fallback).message
}

