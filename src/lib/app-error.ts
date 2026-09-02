export const appErrorMessages = {
  USER_CANCELLED: '',
  UNSUPPORTED_FILE_TYPE: '目前只支持导入 EPUB 或 PDF 文件。',
  INVALID_EPUB: '这个文件不是有效的 EPUB，或文件已经损坏。',
  INVALID_PDF: '这个文件不是有效的 PDF，或文件已经损坏。',
  EPUB_TOO_LARGE: 'EPUB 文件过大或压缩结构异常，无法安全导入。',
  PDF_TOO_LARGE: 'PDF 文件过大，无法安全导入。',
  DUPLICATE_BOOK: '这本书已经在书架中了。',
  FILE_READ_FAILED: '无法读取所选文件，请检查文件是否仍然可用。',
  FILE_WRITE_FAILED: '无法保存图书文件，请检查磁盘空间后重试。',
  METADATA_PARSE_FAILED: '无法解析这本 EPUB 的图书信息。',
  DATABASE_READ_FAILED: '无法加载书架，请稍后重试。',
  DATABASE_WRITE_FAILED: '无法保存书籍信息，请稍后重试。',
  BOOK_NOT_FOUND: '这本书不在书架中，可能已经被移除。',
  BOOK_UPDATE_FAILED: '无法更新书籍信息，请稍后重试。',
  BOOK_DELETE_FAILED: '无法安全删除这本书，原有数据已尽量恢复。',
  BOOK_FILE_DELETE_FAILED: '无法清理书籍文件，请检查文件权限后重试。',
  BOOK_FILE_RESTORE_FAILED: '删除失败，且书籍文件无法自动恢复。',
  READER_OPEN_FAILED: '无法打开这本电子书，请确认文件仍然完整。',
  READER_NAVIGATION_FAILED: '无法跳转到指定阅读位置。',
  READER_SETTINGS_READ_FAILED: '无法加载阅读设置，将使用默认排版。',
  READER_SETTINGS_WRITE_FAILED: '无法保存阅读设置，请稍后重试。',
  READING_STATE_WRITE_FAILED: '无法保存当前阅读位置。',
  BOOKMARK_READ_FAILED: '无法加载书签，请稍后重试。',
  BOOKMARK_WRITE_FAILED: '无法保存书签，请稍后重试。',
  BOOKMARK_NOT_FOUND: '这个书签已经不存在。',
  READING_ACTIVITY_FAILED: '无法记录阅读时长，但不会影响继续阅读。',
  ANNOTATION_READ_FAILED: '无法加载高亮和批注，请稍后重试。',
  ANNOTATION_WRITE_FAILED: '无法保存高亮或批注，请稍后重试。',
  ANNOTATION_NOT_FOUND: '这条高亮已经不存在。',
  ANNOTATION_SELECTION_EMPTY: '请先选择一段正文。',
  ANNOTATION_RENDER_FAILED: '高亮已保存，但暂时无法定位原文。',
  ANNOTATION_LOCATE_FAILED: '无法定位原文，电子书内容可能已发生变化。',
  ANNOTATION_RESTORE_PARTIAL: '部分高亮无法定位原文，数据仍已保留。',
  NOTE_READ_FAILED: '无法加载笔记，请稍后重试。',
  NOTE_WRITE_FAILED: '无法保存笔记，编辑内容已保留。',
  NOTE_NOT_FOUND: '这条笔记已经不存在。',
  NOTE_DOCUMENT_INVALID: '笔记内容损坏，已使用空白文档安全打开。',
  SEARCH_FAILED: '无法完成本地搜索，请稍后重试。',
  SEARCH_INDEX_FAILED: '无法更新本地搜索索引，请稍后重试。',
  BACKUP_EXPORT_FAILED: '无法创建备份，请检查磁盘空间后重试。',
  BACKUP_FILE_READ_FAILED: '无法读取所选备份文件。',
  BACKUP_FILE_WRITE_FAILED: '无法写入备份文件，请检查保存位置。',
  BACKUP_INVALID: '备份文件已损坏，或不是有效的 LightReader 备份。',
  BACKUP_VERSION_UNSUPPORTED: '此备份版本与当前 LightReader 不兼容。',
  BACKUP_RESTORE_FAILED: '无法恢复备份，原有数据已保留。',
  BACKUP_CAPACITY_INSUFFICIENT: '可用空间不足，无法完成这次备份操作。',
  EXPORT_CANCELLED: '',
  EXPORT_FAILED: '无法导出内容，请检查保存位置后重试。',
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
