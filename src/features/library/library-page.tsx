import { BookOpen, CircleAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { EmptyState } from '../../components/common/empty-state';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/cn';
import { BookCard } from './components/book-card';
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

  return (
    <div>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">书架</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            本地图书保存在应用受控目录中，目前支持 EPUB。
          </p>
        </div>
        <ImportBookButton
          isImporting={library.isImporting}
          onImport={() => {
            void library.importEpub();
          }}
        />
      </header>

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
      ) : library.books.length === 0 ? (
        <EmptyState
          description="点击右上角“导入 EPUB”，把本地图书添加到书架。"
          icon={<BookOpen size={28} />}
          title="书架还是空的"
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
              onOpen={(selectedBook) => {
                void navigate(`/reader/${encodeURIComponent(selectedBook.id)}`);
              }}
              services={services}
            />
          ))}
        </section>
      )}
    </div>
  );
}
