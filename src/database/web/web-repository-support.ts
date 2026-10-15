import type { z } from 'zod';

import { AppError, isAppError, type AppErrorCode } from '../../lib/app-error';

/** Runs a Web Repository action and maps unexpected failures to `code`. */
export async function withAppError<T>(
  code: AppErrorCode,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw isAppError(error) ? error : new AppError(code, { cause: error });
  }
}

/** Validates records read back from IndexedDB before they reach the domain. */
export function parseRecords<T>(schema: z.ZodType<T>, values: unknown[]): T[] {
  return values.map((value) => schema.parse(value));
}

export function isConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'ConstraintError'
  );
}
