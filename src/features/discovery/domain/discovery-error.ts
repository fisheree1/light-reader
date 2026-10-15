import { translate, type MessageKey } from '../../../i18n/i18n';
import { isAppError } from '../../../lib/app-error';

export const discoveryErrorKeys = {
  SOURCE_UNAVAILABLE: 'discovery.errorUnavailable',
  SOURCE_ACCESS_DENIED: 'discovery.errorAccess',
  SOURCE_TIMEOUT: 'discovery.errorTimeout',
  SOURCE_INVALID: 'discovery.errorInvalid',
  SOURCE_INCOMPLETE: 'discovery.errorIncomplete',
  SOURCE_TOO_LARGE: 'discovery.errorTooLarge',
  SOURCE_IMAGE_FAILED: 'discovery.errorImage',
  SOURCE_BUSY: 'discovery.errorBusy',
  SOURCE_SELECT_BOOK: 'discovery.errorSelectBook',
  SOURCE_RATE_LIMITED: 'discovery.errorRateLimited',
  SOURCE_COOLING_DOWN: 'discovery.errorCoolingDown',
  SOURCE_BUILD_INVALID: 'discovery.errorBuildInvalid',
} as const satisfies Record<string, MessageKey>;

export type DiscoveryErrorCode = keyof typeof discoveryErrorKeys;

export class DiscoveryError extends Error {
  readonly code: DiscoveryErrorCode;
  constructor(code: DiscoveryErrorCode, options?: ErrorOptions) {
    super(translate(discoveryErrorKeys[code]), options);
    this.code = code;
  }
}

export function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
}

/** Errors that mean the source refused us: stop instead of trying more pages. */
export function isSourceRefusal(error: unknown): boolean {
  return (
    error instanceof DiscoveryError &&
    (error.code === 'SOURCE_ACCESS_DENIED' ||
      error.code === 'SOURCE_RATE_LIMITED' ||
      error.code === 'SOURCE_COOLING_DOWN')
  );
}

/**
 * A user-facing message. Only errors that carry a translated message are shown
 * as is; anything else (a TypeError, a native string) gets a generic message.
 */
export function discoveryErrorMessage(error: unknown): string {
  if (error instanceof DiscoveryError) return error.message;
  if (isAppError(error)) return error.userMessage;
  return translate('discovery.errorUnexpected');
}
