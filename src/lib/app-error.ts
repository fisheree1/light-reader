export const appErrorMessages = {
  USER_CANCELLED: '',
  UNSUPPORTED_FILE_TYPE: '目前只支持导入 EPUB 文件。',
  INVALID_EPUB: '这个文件不是有效的 EPUB，或文件已经损坏。',
  DUPLICATE_BOOK: '这本书已经在书架中了。',
  FILE_READ_FAILED: '无法读取所选文件，请检查文件是否仍然可用。',
  FILE_WRITE_FAILED: '无法保存图书文件，请检查磁盘空间后重试。',
  METADATA_PARSE_FAILED: '无法解析这本 EPUB 的图书信息。',
  DATABASE_READ_FAILED: '无法加载书架，请稍后重试。',
  DATABASE_WRITE_FAILED: '无法保存书籍信息，请稍后重试。',
  BOOK_NOT_FOUND: '这本书不在书架中，可能已经被移除。',
  READER_OPEN_FAILED: '无法打开这本 EPUB，请确认文件仍然完整。',
  READER_NAVIGATION_FAILED: '无法跳转到指定阅读位置。',
  READER_SETTINGS_READ_FAILED: '无法加载阅读设置，将使用默认排版。',
  READER_SETTINGS_WRITE_FAILED: '无法保存阅读设置，请稍后重试。',
  READING_STATE_WRITE_FAILED: '无法保存当前阅读位置。',
  UNKNOWN: '发生了意外错误，请重试。',
} as const;

export type AppErrorCode = keyof typeof appErrorMessages;

interface AppErrorOptions {
  cause?: unknown;
  message?: string;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;

  constructor(code: AppErrorCode, options: AppErrorOptions = {}) {
    const userMessage = options.message ?? appErrorMessages[code];
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
