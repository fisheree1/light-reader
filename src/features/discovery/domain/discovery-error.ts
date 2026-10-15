import { translate, type MessageKey } from '../../../i18n/i18n';

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

export function discoveryErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return translate('discovery.errorInvalid');
}
