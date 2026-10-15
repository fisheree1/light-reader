import { BookA, Highlighter, Sparkles, Square, Volume2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/cn';
import type { ReaderTextSelection } from '../../../reader-engines/types';
import type { AnnotationColor } from '../domain/annotation';
import type { MessageKey } from '../../../i18n/i18n';
import { useI18n } from '../../../i18n/use-i18n';

const colors: {
  className: string;
  labelKey: MessageKey;
  value: AnnotationColor;
}[] = [
  {
    value: 'yellow',
    labelKey: 'annotations.colorYellow',
    className: 'bg-yellow-400',
  },
  {
    value: 'blue',
    labelKey: 'annotations.colorBlue',
    className: 'bg-blue-400',
  },
  {
    value: 'green',
    labelKey: 'annotations.colorGreen',
    className: 'bg-green-400',
  },
  { value: 'red', labelKey: 'annotations.colorRed', className: 'bg-red-400' },
];

interface SelectionToolbarProps {
  onLookup?: () => void;
  onOpenAi?: () => void;
  onCreate: (color: AnnotationColor) => Promise<void>;
  selection: ReaderTextSelection | null;
  speech?: { onToggle: () => void; speaking: boolean };
}

export function SelectionToolbar({
  onLookup,
  onOpenAi,
  onCreate,
  selection,
  speech,
}: SelectionToolbarProps) {
  const { t } = useI18n();
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
      aria-label={t('annotations.selectionToolbar')}
      className="bg-surface absolute top-4 left-1/2 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-lg border p-2 shadow-lg"
      role="toolbar"
    >
      <span className="text-muted-foreground max-w-36 truncate px-1 text-xs">
        {selection.text}
      </span>
      <div
        aria-label={t('annotations.highlightColor')}
        className="flex gap-1"
        role="group"
      >
        {colors.map((item) => (
          <button
            aria-label={t('annotations.colorHighlight', {
              color: t(item.labelKey),
            })}
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
        {isCreating ? t('annotations.adding') : t('annotations.addHighlight')}
      </Button>
      {onLookup ? (
        <Button onClick={onLookup} size="sm" variant="secondary">
          <BookA aria-hidden="true" size={15} />
          {t('annotations.lookup')}
        </Button>
      ) : null}
      {speech ? (
        <Button
          aria-pressed={speech.speaking}
          onClick={speech.onToggle}
          size="sm"
          variant="secondary"
        >
          {speech.speaking ? (
            <Square aria-hidden="true" size={15} />
          ) : (
            <Volume2 aria-hidden="true" size={15} />
          )}
          {speech.speaking
            ? t('annotations.stopReading')
            : t('annotations.readAloud')}
        </Button>
      ) : null}
      {onOpenAi ? (
        <Button onClick={onOpenAi} size="sm" variant="secondary">
          <Sparkles aria-hidden="true" size={15} />
          {t('annotations.aiAssistant')}
        </Button>
      ) : null}
    </div>
  );
}
