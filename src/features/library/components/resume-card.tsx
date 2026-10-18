import { BookOpen } from 'lucide-react';

import { Button } from '../../../components/ui/button';
import { useI18n } from '../../../i18n/use-i18n';
import type { LibraryBook } from '../domain/library';

/** A shortcut back into the book to read next. */
export function ResumeCard({
  book,
  nextVolume,
  onOpen,
}: {
  book: LibraryBook;
  nextVolume: boolean;
  onOpen: (book: LibraryBook) => void;
}) {
  const { t } = useI18n();
  return (
    <section
      aria-label={t('library.resumeLabel')}
      className="bg-surface mb-6 flex flex-wrap items-center gap-4 rounded-xl border p-4"
    >
      <BookOpen
        aria-hidden="true"
        className="text-primary shrink-0"
        size={22}
      />
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground text-xs">
          {nextVolume ? t('library.resumeNext') : t('library.resumeLabel')}
        </p>
        <p className="truncate font-semibold" title={book.title}>
          {book.title}
        </p>
        {!nextVolume && book.progress !== null ? (
          <p className="text-muted-foreground text-xs">
            {t('library.resumeProgress', {
              percent: Math.floor(book.progress * 100),
            })}
          </p>
        ) : null}
      </div>
      <Button
        onClick={() => {
          onOpen(book);
        }}
      >
        {nextVolume ? t('library.resumeStart') : t('library.resumeContinue')}
      </Button>
    </section>
  );
}
