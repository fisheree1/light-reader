import {
  BookText,
  Library,
  Highlighter,
  NotebookPen,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { EmptyState } from '../../components/common/empty-state';
import { Button } from '../../components/ui/button';
import type {
  AnnotationSearchResult,
  BookContentSearchResult,
  BookSearchResult,
  NoteSearchResult,
} from './domain/search';
import { useLocalSearch } from './hooks/use-local-search';
import {
  searchServices,
  type SearchServices,
} from './services/search-services';

interface SearchPageProps {
  services?: SearchServices;
}

interface ResultSectionProps {
  children: React.ReactNode;
  count: number;
  icon: React.ReactNode;
  title: string;
}

function ResultSection({ children, count, icon, title }: ResultSectionProps) {
  if (count === 0) return null;
  return (
    <section aria-labelledby={`search-${title}`}>
      <h2
        className="mb-3 flex items-center gap-2 text-sm font-semibold"
        id={`search-${title}`}
      >
        {icon}
        {title}
        <span className="text-muted-foreground font-normal">{count}</span>
      </h2>
      <ol className="grid gap-3">{children}</ol>
    </section>
  );
}

function ResultButton({
  description,
  meta,
  onClick,
  title,
}: {
  description: string;
  meta: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      className="bg-surface hover:bg-muted focus-visible:bg-muted w-full rounded-lg border p-4 text-left transition-colors"
      onClick={onClick}
      type="button"
    >
      <span className="block truncate text-sm font-semibold">{title}</span>
      <span className="text-muted-foreground mt-1 block text-xs">{meta}</span>
      <span className="mt-2 line-clamp-2 block text-sm">{description}</span>
    </button>
  );
}

function noteMeta(result: NoteSearchResult): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(
    result.updatedAt,
  );
}

export function SearchPage({ services = searchServices }: SearchPageProps) {
  const navigate = useNavigate();
  const search = useLocalSearch(services.localSearch);
  const total = search.results
    ? search.results.books.length +
      search.results.notes.length +
      search.results.annotations.length +
      search.results.bookContent.length
    : 0;

  const openNote = (result: NoteSearchResult) => {
    void navigate(`/notes?noteId=${encodeURIComponent(result.id)}`);
  };
  const openAnnotation = (result: AnnotationSearchResult) => {
    void navigate(`/reader/${encodeURIComponent(result.bookId)}`, {
      state: {
        readerNavigation: {
          annotationId: result.id,
          locator: result.locator,
        },
      },
    });
  };
  const openBookContent = (result: BookContentSearchResult) => {
    void navigate(`/reader/${encodeURIComponent(result.bookId)}`, {
      state: {
        readerNavigation: {
          locator: result.locator,
        },
      },
    });
  };
  const openBook = (result: BookSearchResult) => {
    void navigate(`/reader/${encodeURIComponent(result.id)}`);
  };

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">搜索</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          在本机搜索书籍、笔记、高亮，以及 EPUB 和 PDF 正文。
        </p>
      </header>

      <form
        className="mb-5 flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void search.search();
        }}
      >
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">搜索本地内容</span>
          <Search
            aria-hidden="true"
            className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
            size={17}
          />
          <input
            aria-label="搜索本地内容"
            className="bg-surface h-10 w-full rounded-md border pr-3 pl-10 text-sm"
            maxLength={200}
            onChange={(event) => {
              search.setQuery(event.currentTarget.value);
            }}
            placeholder="输入标题、正文或高亮文字"
            type="search"
            value={search.query}
          />
        </label>
        <Button disabled={search.phase === 'loading'} type="submit">
          <Search aria-hidden="true" size={16} />
          {search.phase === 'loading' ? '搜索中…' : '搜索'}
        </Button>
        <Button
          disabled={search.isRebuilding || search.phase === 'loading'}
          onClick={() => void search.rebuild()}
          type="button"
          variant="ghost"
        >
          <RefreshCw
            aria-hidden="true"
            className={search.isRebuilding ? 'animate-spin' : undefined}
            size={16}
          />
          {search.isRebuilding ? '重建中…' : '索引维护'}
        </Button>
      </form>

      {search.error ? (
        <div
          className="border-destructive/30 bg-destructive/10 text-destructive mb-5 rounded-md border px-4 py-3 text-sm"
          role="alert"
        >
          {search.error}
        </div>
      ) : null}

      {search.rebuildResult ? (
        <p
          className="bg-surface mb-5 rounded-md border px-4 py-3 text-sm"
          role="status"
        >
          已重建索引：{search.rebuildResult.indexedBooks} 本图书
          {search.rebuildResult.failedBooks > 0
            ? `，${String(search.rebuildResult.failedBooks)} 本失败`
            : '，全部成功'}
        </p>
      ) : null}

      {search.results?.indexFailures ? (
        <p className="text-destructive mb-5 text-sm" role="status">
          {search.results.indexFailures} 本图书
          暂时无法建立正文索引，可尝试重建。
        </p>
      ) : null}

      {search.phase === 'loading' ? (
        <p
          aria-live="polite"
          className="text-muted-foreground py-16 text-center"
        >
          正在本地搜索并准备图书索引…
        </p>
      ) : search.phase === 'idle' ? (
        <EmptyState
          description="输入关键词后，只会查询当前设备上的 SQLite 和应用数据目录。"
          icon={<Search size={28} />}
          title="搜索本地内容"
        />
      ) : search.phase === 'ready' && total === 0 ? (
        <EmptyState
          description={`没有找到与“${search.results?.query ?? ''}”匹配的内容。`}
          icon={<Search size={28} />}
          title="没有搜索结果"
        />
      ) : search.results ? (
        <div className="space-y-8" aria-live="polite">
          <p className="text-muted-foreground text-sm">找到 {total} 条结果</p>
          <ResultSection
            count={search.results.books.length}
            icon={<Library aria-hidden="true" size={16} />}
            title="书籍"
          >
            {search.results.books.map((result) => (
              <li key={result.id}>
                <ResultButton
                  description={result.author ?? '未知作者'}
                  meta={result.format.toUpperCase()}
                  onClick={() => {
                    openBook(result);
                  }}
                  title={result.title}
                />
              </li>
            ))}
          </ResultSection>
          <ResultSection
            count={search.results.notes.length}
            icon={<NotebookPen aria-hidden="true" size={16} />}
            title="笔记"
          >
            {search.results.notes.map((result) => (
              <li key={result.id}>
                <ResultButton
                  description={result.excerpt || '空白笔记'}
                  meta={noteMeta(result)}
                  onClick={() => {
                    openNote(result);
                  }}
                  title={result.title}
                />
              </li>
            ))}
          </ResultSection>

          <ResultSection
            count={search.results.annotations.length}
            icon={<Highlighter aria-hidden="true" size={16} />}
            title="高亮"
          >
            {search.results.annotations.map((result) => (
              <li key={result.id}>
                <ResultButton
                  description={result.text}
                  meta={`${result.bookTitle} · ${result.chapterHref ?? '未知章节'}`}
                  onClick={() => {
                    openAnnotation(result);
                  }}
                  title={result.bookTitle}
                />
              </li>
            ))}
          </ResultSection>

          <ResultSection
            count={search.results.bookContent.length}
            icon={<BookText aria-hidden="true" size={16} />}
            title="图书正文"
          >
            {search.results.bookContent.map((result) => (
              <li key={`${result.bookId}:${JSON.stringify(result.locator)}`}>
                <ResultButton
                  description={result.excerpt}
                  meta={result.bookTitle}
                  onClick={() => {
                    openBookContent(result);
                  }}
                  title={result.sectionLabel}
                />
              </li>
            ))}
          </ResultSection>
        </div>
      ) : null}
    </div>
  );
}
