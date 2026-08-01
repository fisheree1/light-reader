import * as Dialog from '@radix-ui/react-dialog';
import { Tags, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import type { BookDeletionMode, LibraryBook } from '../domain/library';

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
                管理《{book.title}》
              </Dialog.Title>
              <Dialog.Description className="text-muted-foreground mt-1 text-sm">
                编辑标签，或安全地从本机删除这本书。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton
                disabled={busy}
                icon={<X aria-hidden="true" size={17} />}
                label="关闭书籍管理"
                variant="ghost"
              />
            </Dialog.Close>
          </div>

          {deleteMode ? (
            <section className="border-destructive/30 bg-destructive/10 mt-6 rounded-lg border p-4">
              <h2 className="font-semibold">确认删除《{book.title}》？</h2>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                {deleteMode === 'delete-all'
                  ? '将删除 EPUB、封面、阅读位置、高亮、批注、标签，并从独立笔记中移除这本书的引用块。笔记中的其他正文不会删除。'
                  : '将删除 EPUB、封面及阅读数据，但独立笔记里的原文引用快照会保留。引用之后无法再跳回已删除的书籍。'}
              </p>
              <p className="text-destructive mt-3 text-sm font-medium">
                此操作完成后无法撤销。
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  disabled={busy}
                  onClick={() => {
                    setDeleteMode(null);
                  }}
                  variant="secondary"
                >
                  返回
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void handleDelete()}
                  variant="destructive"
                >
                  <Trash2 aria-hidden="true" size={15} />
                  {busy ? '正在删除…' : '确认删除'}
                </Button>
              </div>
            </section>
          ) : (
            <>
              <section className="mt-6">
                <label className="text-sm font-medium" htmlFor="book-tags">
                  <span className="inline-flex items-center gap-2">
                    <Tags aria-hidden="true" size={15} />
                    标签
                  </span>
                </label>
                <input
                  className="bg-background mt-2 h-10 w-full rounded-md border px-3 text-sm"
                  id="book-tags"
                  maxLength={400}
                  onChange={(event) => {
                    setTags(event.currentTarget.value);
                  }}
                  placeholder="小说, 待读, 技术"
                  value={tags}
                />
                <p className="text-muted-foreground mt-2 text-xs">
                  使用逗号分隔，最多 20 个标签，每个标签不超过 40 个字符。
                </p>
                <div className="mt-3 flex justify-end">
                  <Button
                    disabled={busy}
                    onClick={() => void onSaveTags(parseTags(tags))}
                    size="sm"
                  >
                    {busy ? '保存中…' : '保存标签'}
                  </Button>
                </div>
              </section>

              <section className="mt-7 border-t pt-5">
                <h2 className="text-sm font-semibold">删除书籍</h2>
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
                      删除书籍和所有数据
                    </span>
                    <span className="text-muted-foreground mt-1 block text-xs leading-5">
                      同时移除阅读数据以及笔记中的该书引用块。
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
                      删除文件但保留笔记引用
                    </span>
                    <span className="text-muted-foreground mt-1 block text-xs leading-5">
                      保留笔记中的原文、章节和定位快照，不再支持返回原书。
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
