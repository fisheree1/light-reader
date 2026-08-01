import { BookOpen } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { Book } from '../domain/book';
import type { LibraryServices } from '../services/library-services';

interface BookCardProps {
  book: Book;
  onOpen: (book: Book) => void;
  services: LibraryServices;
}

export function BookCard({ book, onOpen, services }: BookCardProps) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let loadedUrl: string | null = null;

    if (book.coverPath) {
      void services
        .loadCoverUrl(book.coverPath)
        .then((url) => {
          loadedUrl = url;
          if (active) setCoverUrl(url);
        })
        .catch(() => undefined);
    }

    return () => {
      active = false;
      if (loadedUrl) services.releaseCoverUrl(loadedUrl);
    };
  }, [book.coverPath, services]);

  return (
    <button
      className="group min-w-0 rounded-lg text-left focus-visible:outline-offset-4"
      onClick={() => {
        onOpen(book);
      }}
      type="button"
    >
      <div className="bg-muted aspect-[2/3] overflow-hidden rounded-lg border shadow-sm transition group-hover:-translate-y-0.5 group-hover:shadow-md">
        {coverUrl ? (
          <img
            alt={`${book.title}封面`}
            className="h-full w-full object-cover"
            src={coverUrl}
          />
        ) : (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
            <BookOpen aria-hidden="true" size={34} />
            <span className="line-clamp-3 text-sm font-medium">
              {book.title}
            </span>
          </div>
        )}
      </div>
      <h2 className="mt-3 truncate text-sm font-semibold" title={book.title}>
        {book.title}
      </h2>
      <p className="text-muted-foreground mt-1 truncate text-xs">
        {book.author ?? '未知作者'}
      </p>
      <p className="text-muted-foreground mt-2 text-xs">未开始 · 0%</p>
    </button>
  );
}
