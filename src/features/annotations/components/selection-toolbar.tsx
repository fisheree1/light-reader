import { Highlighter } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/cn';
import type { ReaderTextSelection } from '../../../reader-engines/types';
import type { AnnotationColor } from '../domain/annotation';

const colors: { className: string; label: string; value: AnnotationColor }[] = [
  { value: 'yellow', label: '黄色', className: 'bg-yellow-400' },
  { value: 'blue', label: '蓝色', className: 'bg-blue-400' },
  { value: 'green', label: '绿色', className: 'bg-green-400' },
  { value: 'red', label: '红色', className: 'bg-red-400' },
];

interface SelectionToolbarProps {
  onCreate: (color: AnnotationColor) => Promise<void>;
  selection: ReaderTextSelection | null;
}

export function SelectionToolbar({
  onCreate,
  selection,
}: SelectionToolbarProps) {
  const [color, setColor] = useState<AnnotationColor>('yellow');
  const [isCreating, setIsCreating] = useState(false);

  if (!selection) return null;

  async function handleCreate() {
    setIsCreating(true);
    try {
      await onCreate(color);
    } catch {
      // The reader-level alert presents the mapped error and selection remains.
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div
      aria-label="文字选择工具栏"
      className="bg-surface absolute top-4 left-1/2 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-lg border p-2 shadow-lg"
      role="toolbar"
    >
      <span className="text-muted-foreground max-w-36 truncate px-1 text-xs">
        {selection.text}
      </span>
      <div aria-label="高亮颜色" className="flex gap-1" role="group">
        {colors.map((item) => (
          <button
            aria-label={`${item.label}高亮`}
            aria-pressed={color === item.value}
            className={cn(
              'size-6 rounded-full border-2 transition-transform hover:scale-110',
              item.className,
              color === item.value
                ? 'border-foreground scale-110'
                : 'border-transparent',
            )}
            disabled={isCreating}
            key={item.value}
            onClick={() => {
              setColor(item.value);
            }}
            type="button"
          />
        ))}
      </div>
      <Button
        disabled={isCreating}
        onClick={() => void handleCreate()}
        size="sm"
      >
        <Highlighter aria-hidden="true" size={15} />
        {isCreating ? '添加中…' : '添加高亮'}
      </Button>
    </div>
  );
}
