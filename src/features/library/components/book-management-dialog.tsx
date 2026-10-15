import * as Dialog from '@radix-ui/react-dialog';
import { Tags, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import type { BookDeletionMode, LibraryBook } from '../domain/library';
import { useI18n } from '../../../i18n/use-i18n';

interface BookManagementDialogProps {
  book: LibraryBook;
  busy: boolean;
  onDelete: (mode: BookDeletionMode) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
  onSaveTags: (tags: string[]) => Promise<boolean>;
  open: boolean;
}

function parseTags(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function BookManagementDialog({
  book,
  busy,
  onDelete,
  onOpenChange,
  onSaveTags,
  open,
}: BookManagementDialogProps) {
  const { t } = useI18n();
  const [tags, setTags] = useState(book.tags.join(', '));
  const [deleteMode, setDeleteMode] = useState<BookDeletionMode | null>(null);

  async function handleDelete() {
    if (!deleteMode) return;
    if (await onDelete(deleteMode)) onOpenChange(false);
  }

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <Dialog.Content className="bg-surface fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border p-6 shadow-xl">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-lg font-semibold">
                {t('bookManagement.title', { title: book.title })}
              </Dialog.Title>
              <Dialog.Description className="text-muted-foreground mt-1 text-sm">
                {t('bookManagement.description')}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton
                disabled={busy}
                icon={<X aria-hidden="true" size={17} />}
                label={t('bookManagement.close')}
                variant="ghost"
              />
            </Dialog.Close>
          </div>

          {deleteMode ? (
            <section className="border-destructive/30 bg-destructive/10 mt-6 rounded-lg border p-4">
              <h2 className="font-semibold">
                {t('bookManagement.confirmTitle', { title: book.title })}
              </h2>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                {deleteMode === 'delete-all'
                  ? t('bookManagement.deleteAllDetail')
                  : t('bookManagement.keepReferencesDetail')}
              </p>
              <p className="text-destructive mt-3 text-sm font-medium">
                {t('bookManagement.irreversible')}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  disabled={busy}
                  onClick={() => {
                    setDeleteMode(null);
                  }}
                  variant="secondary"
                >
                  {t('common.back')}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void handleDelete()}
                  variant="destructive"
                >
                  <Trash2 aria-hidden="true" size={15} />
                  {busy
                    ? t('bookManagement.deleting')
                    : t('bookManagement.confirmDelete')}
                </Button>
              </div>
            </section>
          ) : (
            <>
              <section className="mt-6">
                <label className="text-sm font-medium" htmlFor="book-tags">
                  <span className="inline-flex items-center gap-2">
                    <Tags aria-hidden="true" size={15} />
                    {t('bookManagement.tags')}
                  </span>
                </label>
                <input
                  className="bg-background mt-2 h-10 w-full rounded-md border px-3 text-sm"
                  id="book-tags"
                  maxLength={400}
                  onChange={(event) => {
                    setTags(event.currentTarget.value);
                  }}
                  placeholder={t('bookManagement.tagsPlaceholder')}
                  value={tags}
                />
                <p className="text-muted-foreground mt-2 text-xs">
                  {t('bookManagement.tagsHint')}
                </p>
                <div className="mt-3 flex justify-end">
                  <Button
                    disabled={busy}
                    onClick={() => void onSaveTags(parseTags(tags))}
                    size="sm"
                  >
                    {busy ? t('common.saving') : t('bookManagement.saveTags')}
                  </Button>
                </div>
              </section>

              <section className="mt-7 border-t pt-5">
                <h2 className="text-sm font-semibold">
                  {t('bookManagement.deleteHeading')}
                </h2>
                <div className="mt-3 grid gap-3">
                  <button
                    className="hover:bg-muted rounded-lg border p-4 text-left"
                    disabled={busy}
                    onClick={() => {
                      setDeleteMode('delete-all');
                    }}
                    type="button"
                  >
                    <span className="block text-sm font-medium">
                      {t('bookManagement.deleteAll')}
                    </span>
                    <span className="text-muted-foreground mt-1 block text-xs leading-5">
                      {t('bookManagement.deleteAllHint')}
                    </span>
                  </button>
                  <button
                    className="hover:bg-muted rounded-lg border p-4 text-left"
                    disabled={busy}
                    onClick={() => {
                      setDeleteMode('keep-note-references');
                    }}
                    type="button"
                  >
                    <span className="block text-sm font-medium">
                      {t('bookManagement.keepReferences')}
                    </span>
                    <span className="text-muted-foreground mt-1 block text-xs leading-5">
                      {t('bookManagement.keepReferencesHint')}
                    </span>
                  </button>
                </div>
              </section>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
