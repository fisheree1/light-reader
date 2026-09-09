import { BookOpen, CircleAlert, Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { EmptyState } from '../../components/common/empty-state';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/cn';
import { BookCard } from './components/book-card';
import { BookManagementDialog } from './components/book-management-dialog';
import { ImportBookButton } from './components/import-book-button';
import { useLibrary } from './hooks/use-library';
import {
  libraryServices,
  type LibraryServices,
} from './services/library-services';

interface LibraryPageProps {
  services?: LibraryServices;
}

export function LibraryPage({ services = libraryServices }: LibraryPageProps) {
  const library = useLibrary(services);
  const navigate = useNavigate();
  const [managedBookId, setManagedBookId] = useState<string | null>(null);
  const managedBook =
    library.books.find((book) => book.id === managedBookId) ?? null;
  const hasFilter = Boolean(library.query.trim()) || library.favoritesOnly;
  const showLibraryControls = library.books.length > 0 || hasFilter;

  return (
    <div>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">书架</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            本地图书保存在应用受控目录中，支持 EPUB 和 PDF。
          </p>
        </div>
        {library.isLoading || showLibraryControls ? (
          <ImportBookButton
            isImporting={library.isImporting}
            onImport={() => {
              void library.importBook();
            }}
          />
        ) : null}
      </header>

      {showLibraryControls ? (
        <section
          aria-label="书架筛选"
          className="bg-surface mb-6 flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center"
        >
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">搜索书架</span>
            <Search
              aria-hidden="true"
              className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
              size={16}
            />
            <input
              aria-label="搜索书架"
              className="bg-background h-9 w-full rounded-md border pr-3 pl-9 text-sm"
              maxLength={200}
              onChange={(event) => {
                library.setQuery(event.currentTarget.value);
              }}
              placeholder="搜索书名、作者或标签"
              type="search"
              value={library.query}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">排序</span>
            <select
              aria-label="书架排序"
              className="bg-background h-9 rounded-md border px-2"
              onChange={(event) => {
                library.setSort(
                  event.currentTarget.value as typeof library.sort,
                );
              }}
              value={library.sort}
            >
              <option value="recent">最近阅读</option>
              <option value="added">添加时间</option>
              <option value="title">标题</option>
            </select>
          </label>
          <label className="flex h-9 items-center gap-2 px-2 text-sm">
            <input
              checked={library.favoritesOnly}
              className="accent-primary size-4"
              onChange={(event) => {
                library.setFavoritesOnly(event.currentTarget.checked);
              }}
              type="checkbox"
            />
            仅显示收藏
          </label>
        </section>
      ) : null}

      {library.notice ? (
        <div
          aria-live="polite"
          className={cn(
            'mb-5 rounded-md border px-4 py-3 text-sm',
            library.notice.kind === 'error'
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : 'bg-surface text-foreground',
          )}
          role={library.notice.kind === 'error' ? 'alert' : 'status'}
        >
          {library.notice.message}
        </div>
      ) : null}

      {library.isLoading ? (
        <div
          aria-live="polite"
          className="text-muted-foreground py-16 text-center text-sm"
        >
          正在加载书架…
        </div>
      ) : library.loadError ? (
        <EmptyState
          action={
            <Button
              onClick={() => {
                void library.loadBooks();
              }}
              variant="secondary"
            >
              重试
            </Button>
          }
          description={library.loadError}
          icon={<CircleAlert size={28} />}
          title="书架加载失败"
        />
      ) : library.books.length === 0 && hasFilter ? (
        <EmptyState
          description="尝试更换关键词，或关闭“仅显示收藏”。"
          icon={<Search size={28} />}
          title="没有匹配的书籍"
        />
      ) : library.books.length === 0 ? (
        <EmptyState
          action={
            <ImportBookButton
              isImporting={library.isImporting}
              onImport={() => {
                void library.importBook();
              }}
            />
          }
          description="导入 EPUB 或 PDF，阅读数据只保存在当前设备。"
          icon={<BookOpen size={28} />}
          title="导入第一本书"
        />
      ) : (
        <section
          aria-label="书籍"
          className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
        >
          {library.books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              disabled={library.mutatingBookId === book.id}
              onManage={(selectedBook) => {
                setManagedBookId(selectedBook.id);
              }}
              onOpen={(selectedBook) => {
                void navigate(`/reader/${encodeURIComponent(selectedBook.id)}`);
              }}
              onToggleFavorite={(selectedBook) => {
                void library.setFavorite(
                  selectedBook.id,
                  !selectedBook.favorite,
                );
              }}
              services={services}
            />
          ))}
        </section>
      )}

      {managedBook ? (
        <BookManagementDialog
          book={managedBook}
          busy={library.mutatingBookId === managedBook.id}
          onDelete={(mode) => library.deleteBook(managedBook.id, mode)}
          onOpenChange={(open) => {
            if (!open) setManagedBookId(null);
          }}
          onSaveTags={(tags) => library.replaceTags(managedBook.id, tags)}
          open
        />
      ) : null}
    </div>
  );
}
