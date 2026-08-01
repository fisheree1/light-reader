import { cn } from '../../../lib/cn';
import type { ReaderTocItem } from '../../../reader-engines/types';

interface ReaderTableOfContentsProps {
  currentHref?: string;
  items: ReaderTocItem[];
  onSelect: (href: string) => void;
}

interface TocItemsProps extends ReaderTableOfContentsProps {
  depth?: number;
}

function TocItems({ currentHref, depth = 0, items, onSelect }: TocItemsProps) {
  return (
    <ul className={cn('space-y-1', depth > 0 && 'ml-3 border-l pl-2')}>
      {items.map((item) => {
        const isCurrent = currentHref === item.href;
        return (
          <li key={`${item.href}-${item.label}`}>
            <button
              aria-current={isCurrent ? 'location' : undefined}
              className={cn(
                'hover:bg-muted focus-visible:outline-primary w-full truncate rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-2',
                isCurrent
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground',
              )}
              onClick={() => {
                onSelect(item.href);
              }}
              title={item.label}
              type="button"
            >
              {item.label}
            </button>
            {item.subitems.length > 0 ? (
              <TocItems
                currentHref={currentHref}
                depth={depth + 1}
                items={item.subitems}
                onSelect={onSelect}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ReaderTableOfContents(props: ReaderTableOfContentsProps) {
  return props.items.length > 0 ? (
    <nav aria-label="图书目录">
      <TocItems {...props} />
    </nav>
  ) : (
    <p className="text-muted-foreground px-2 py-4 text-sm">
      这本 EPUB 没有可用目录。
    </p>
  );
}
