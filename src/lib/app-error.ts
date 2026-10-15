import { translate } from '../i18n/i18n';
import { zhCN } from '../i18n/messages/zh-CN';

/** Simplified Chinese messages, kept for callers that need the raw catalog. */
export const appErrorMessages = zhCN.errors;

export type AppErrorCode = keyof typeof appErrorMessages;

interface AppErrorOptions {
  cause?: unknown;
  message?: string;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;

  constructor(code: AppErrorCode, options: AppErrorOptions = {}) {
    const userMessage = options.message ?? translate(`errors.${code}`);
    super(userMessage, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function asAppError(
  error: unknown,
  fallbackCode: AppErrorCode,
): AppError {
  return isAppError(error)
    ? error
    : new AppError(fallbackCode, { cause: error });
}
