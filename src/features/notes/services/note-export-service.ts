import type { BookRepository } from '../../../database/repositories/book-repository';
import type { NoteRepository } from '../../../database/repositories/note-repository';
import { AppError } from '../../../lib/app-error';
import type { FileExportPlatform } from '../../../platform/export/file-export-platform';
import {
  bookQuoteReferenceSchema,
  type Note,
  type NoteContentNode,
} from '../domain/note';

export type NoteExportFormat = 'html' | 'markdown';

const encoder = new TextEncoder();

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'note';
}

function locatorLabel(locator: {
  cfi?: string;
  chapterHref?: string;
  progression?: number;
}): string {
  return [
    locator.chapterHref ? `章节 ${locator.chapterHref}` : null,
    locator.progression === undefined
      ? null
      : `进度 ${String(Math.round(locator.progression * 100))}%`,
    locator.cfi ? `CFI ${locator.cfi}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function renderMarkdownNode(
  node: NoteContentNode,
  bookTitles: Map<string, string>,
): string {
  if (node.type === 'text') {
    let text = node.text ?? '';
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') text = `**${text}**`;
      if (mark.type === 'italic') text = `*${text}*`;
      if (mark.type === 'code') text = `\`${text}\``;
    }
    return text;
  }
  if (node.type === 'bookQuote') {
    const parsed = bookQuoteReferenceSchema.safeParse(node.attrs);
    if (!parsed.success) return '';
    const reference = parsed.data;
    const source = [
      bookTitles.get(reference.bookId) ?? '未知书籍',
      reference.chapter,
      locatorLabel(reference.locator),
    ]
      .filter(Boolean)
      .join(' · ');
    return `> ${reference.quote.replaceAll('\n', '\n> ')}\n>\n> — ${source}\n\n`;
  }
  const content = (node.content ?? [])
    .map((child) => renderMarkdownNode(child, bookTitles))
    .join('');
  if (node.type === 'heading') {
    const level = Math.max(1, Math.min(6, Number(node.attrs?.level) || 2));
    return `${'#'.repeat(level)} ${content}\n\n`;
  }
  if (node.type === 'paragraph') return `${content}\n\n`;
  if (node.type === 'blockquote') {
    return `${content
      .trim()
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')}\n\n`;
  }
  if (node.type === 'listItem') return `- ${content.trim()}\n`;
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return `${content}\n`;
  }
  if (node.type === 'hardBreak') return '\n';
  return content;
}

function renderHtmlNode(
  node: NoteContentNode,
  bookTitles: Map<string, string>,
): string {
  if (node.type === 'text') {
    let text = escapeHtml(node.text ?? '');
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') text = `<strong>${text}</strong>`;
      if (mark.type === 'italic') text = `<em>${text}</em>`;
      if (mark.type === 'code') text = `<code>${text}</code>`;
    }
    return text;
  }
  if (node.type === 'bookQuote') {
    const parsed = bookQuoteReferenceSchema.safeParse(node.attrs);
    if (!parsed.success) return '';
    const reference = parsed.data;
    const source = [
      bookTitles.get(reference.bookId) ?? '未知书籍',
      reference.chapter,
      locatorLabel(reference.locator),
    ]
      .filter(Boolean)
      .join(' · ');
    return `<blockquote class="book-quote"><p>${escapeHtml(reference.quote)}</p><footer>— ${escapeHtml(source)}</footer></blockquote>`;
  }
  const content = (node.content ?? [])
    .map((child) => renderHtmlNode(child, bookTitles))
    .join('');
  if (node.type === 'heading') {
    const level = Math.max(1, Math.min(6, Number(node.attrs?.level) || 2));
    return `<h${String(level)}>${content}</h${String(level)}>`;
  }
  const tags: Record<string, string> = {
    paragraph: 'p',
    blockquote: 'blockquote',
    bulletList: 'ul',
    orderedList: 'ol',
    listItem: 'li',
  };
  if (node.type === 'hardBreak') return '<br>';
  const tag = tags[node.type];
  return tag ? `<${tag}>${content}</${tag}>` : content;
}

export function renderNoteMarkdown(
  note: Note,
  bookTitles: Map<string, string>,
): string {
  return `# ${note.title}\n\n${renderMarkdownNode(note.document.content, bookTitles).trim()}\n`;
}

export function renderNoteHtml(
  note: Note,
  bookTitles: Map<string, string>,
): string {
  const body = renderHtmlNode(note.document.content, bookTitles);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(note.title)}</title><style>body{max-width:48rem;margin:2rem auto;padding:0 1rem;font:16px/1.7 system-ui}.book-quote{border-left:4px solid #888;padding-left:1rem}footer{color:#666}</style></head><body><article><h1>${escapeHtml(note.title)}</h1>${body}</article></body></html>`;
}

export class NoteExportService {
  private readonly noteRepository: NoteRepository;
  private readonly bookRepository: BookRepository;
  private readonly platform: FileExportPlatform;

  constructor(
    noteRepository: NoteRepository,
    bookRepository: BookRepository,
    platform: FileExportPlatform,
  ) {
    this.noteRepository = noteRepository;
    this.bookRepository = bookRepository;
    this.platform = platform;
  }

  async exportOne(note: Note, format: NoteExportFormat): Promise<void> {
    await this.exportNotes([note], safeFileName(note.title), format);
  }

  async exportAll(format: NoteExportFormat): Promise<void> {
    const notes = await this.noteRepository.list();
    await this.exportNotes(notes, 'LightReader-笔记', format);
  }

  private async exportNotes(
    notes: Note[],
    fileName: string,
    format: NoteExportFormat,
  ): Promise<void> {
    try {
      const books = await this.bookRepository.list();
      const titles = new Map(books.map((book) => [book.id, book.title]));
      const content =
        format === 'markdown'
          ? notes
              .map((note) => renderNoteMarkdown(note, titles))
              .join('\n\n---\n\n')
          : `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>LightReader 笔记</title></head><body>${notes
              .map(
                (note) =>
                  `<article><h1>${escapeHtml(note.title)}</h1>${renderHtmlNode(note.document.content, titles)}</article>`,
              )
              .join('<hr>')}</body></html>`;
      const extension = format === 'markdown' ? 'md' : 'html';
      const result = await this.platform.save({
        data: encoder.encode(content),
        defaultFileName: `${fileName}.${extension}`,
        extension,
        mediaType: format === 'markdown' ? 'text/markdown' : 'text/html',
      });
      if (result === 'cancelled') throw new AppError('EXPORT_CANCELLED');
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('EXPORT_FAILED', { cause: error });
    }
  }
}
