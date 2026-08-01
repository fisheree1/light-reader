import { BookOpen, MoreHorizontal, Star } from 'lucide-react';
import { useEffect, useState } from 'react';

import { IconButton } from '../../../components/ui/icon-button';
import { cn } from '../../../lib/cn';
import type { LibraryBook } from '../domain/library';
import type { LibraryServices } from '../services/library-services';

interface BookCardProps {
  book: LibraryBook;
  disabled?: boolean;
  onManage: (book: LibraryBook) => void;
  onOpen: (book: LibraryBook) => void;
  onToggleFavorite: (book: LibraryBook) => void;
  services: LibraryServices;
}

export function BookCard({
  book,
  disabled = false,
  onManage,
  onOpen,
  onToggleFavorite,
  services,
}: BookCardProps) {
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
    <article className="group relative min-w-0">
      <button
        aria-label={`打开《${book.title}》`}
        className="w-full rounded-lg text-left focus-visible:outline-offset-4"
        disabled={disabled}
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
        <p className="text-muted-foreground mt-2 text-xs">
          {book.lastReadAt === null
            ? '未开始 · 0%'
            : `最近阅读 · ${new Intl.DateTimeFormat('zh-CN', {
                month: 'numeric',
                day: 'numeric',
              }).format(book.lastReadAt)}`}
        </p>
        {book.tags.length > 0 ? (
          <span className="mt-2 flex min-w-0 gap-1 overflow-hidden">
            {book.tags.slice(0, 2).map((tag) => (
              <span
                className="bg-muted max-w-24 truncate rounded px-1.5 py-0.5 text-[0.65rem]"
                key={tag}
              >
                {tag}
              </span>
            ))}
          </span>
        ) : null}
      </button>

      <div className="absolute top-2 right-2 flex gap-1">
        <IconButton
          aria-pressed={book.favorite}
          className="bg-surface/90 size-8 shadow-sm backdrop-blur"
          disabled={disabled}
          icon={
            <Star
              aria-hidden="true"
              className={cn(book.favorite && 'fill-primary text-primary')}
              size={15}
            />
          }
          label={
            book.favorite
              ? `取消收藏《${book.title}》`
              : `收藏《${book.title}》`
          }
          onClick={() => {
            onToggleFavorite(book);
          }}
          variant="secondary"
        />
        <IconButton
          className="bg-surface/90 size-8 shadow-sm backdrop-blur"
          disabled={disabled}
          icon={<MoreHorizontal aria-hidden="true" size={16} />}
          label={`管理《${book.title}》`}
          onClick={() => {
            onManage(book);
          }}
          variant="secondary"
        />
      </div>
    </article>
  );
}
