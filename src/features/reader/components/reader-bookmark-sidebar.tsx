import { Bookmark, Trash2 } from 'lucide-react';
import { useMemo, useState, type SyntheticEvent } from 'react';

import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import type { Bookmark as SavedBookmark } from '../domain/bookmark';

interface ReaderBookmarkSidebarProps {
  bookmarks: SavedBookmark[];
  onCreate: (name: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<unknown>;
  onSelect: (bookmark: SavedBookmark) => void;
}

export function ReaderBookmarkSidebar({
  bookmarks,
  onCreate,
  onDelete,
  onRename,
  onSelect,
}: ReaderBookmarkSidebarProps) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return search
      ? bookmarks.filter((bookmark) =>
          bookmark.name.toLocaleLowerCase().includes(search),
        )
      : bookmarks;
  }, [bookmarks, query]);

  async function handleCreate(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim() || `书签 ${String(bookmarks.length + 1)}`;
    setStatus('正在保存…');
    try {
      await onCreate(nextName);
      setName('');
      setStatus('书签已保存');
    } catch {
      setStatus('书签保存失败');
    }
  }

  return (
    <aside className="bg-surface w-72 shrink-0 overflow-auto border-l p-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Bookmark aria-hidden="true" size={16} />
        书签
      </h2>
      <form
        className="mt-3 space-y-2"
        onSubmit={(event) => void handleCreate(event)}
      >
        <label className="sr-only" htmlFor="reader-bookmark-name">
          书签名称
        </label>
        <input
          className="bg-background h-9 w-full rounded-md border px-3 text-sm"
          id="reader-bookmark-name"
          maxLength={120}
          onChange={(event) => {
            setName(event.currentTarget.value);
          }}
          placeholder="书签名称（可选）"
          value={name}
        />
        <Button className="w-full" size="sm" type="submit">
          保存当前位置
        </Button>
      </form>
      <p aria-live="polite" className="text-muted-foreground mt-2 text-xs">
        {status}
      </p>
      <label className="sr-only" htmlFor="reader-bookmark-search">
        搜索书签
      </label>
      <input
        className="bg-background mt-3 h-9 w-full rounded-md border px-3 text-sm"
        id="reader-bookmark-search"
        onChange={(event) => {
          setQuery(event.currentTarget.value);
        }}
        placeholder="搜索书签"
        type="search"
        value={query}
      />
      <ul className="mt-3 space-y-2">
        {visible.map((bookmark) => (
          <li className="rounded-md border p-2" key={bookmark.id}>
            <button
              className="hover:text-primary w-full text-left text-sm"
              onClick={() => {
                onSelect(bookmark);
              }}
              type="button"
            >
              {bookmark.name}
            </button>
            <div className="mt-2 flex items-center gap-2">
              <label className="sr-only" htmlFor={`bookmark-${bookmark.id}`}>
                重命名 {bookmark.name}
              </label>
              <input
                className="bg-background h-8 min-w-0 flex-1 rounded border px-2 text-xs"
                defaultValue={bookmark.name}
                id={`bookmark-${bookmark.id}`}
                maxLength={120}
                onBlur={(event) => {
                  const nextName = event.currentTarget.value.trim();
                  if (nextName && nextName !== bookmark.name) {
                    void onRename(bookmark.id, nextName);
                  }
                }}
              />
              <IconButton
                icon={<Trash2 aria-hidden="true" size={14} />}
                label={`删除书签 ${bookmark.name}`}
                onClick={() => void onDelete(bookmark.id)}
                variant="ghost"
              />
            </div>
          </li>
        ))}
      </ul>
      {visible.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          {query ? '没有匹配的书签' : '尚未保存书签'}
        </p>
      ) : null}
    </aside>
  );
}
