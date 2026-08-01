import * as Dialog from '@radix-ui/react-dialog';
import { Settings2, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../../../components/ui/button';
import { IconButton } from '../../../components/ui/icon-button';
import type {
  ReaderDisplaySettings,
  ReaderSettingsOverride,
} from '../domain/reader-settings';
import { ReaderSettingsForm } from './reader-settings-form';

interface ReaderSettingsDialogProps {
  bookOverride: ReaderSettingsOverride | null;
  disabled?: boolean;
  effectiveSettings: ReaderDisplaySettings;
  onClear: () => Promise<void>;
  onSave: (settings: ReaderSettingsOverride) => Promise<void>;
}

export function ReaderSettingsDialog({
  bookOverride,
  disabled = false,
  effectiveSettings,
  onClear,
  onSave,
}: ReaderSettingsDialogProps) {
  const [draft, setDraft] = useState(effectiveSettings);
  const [hasOverride, setHasOverride] = useState(bookOverride !== null);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function handleOpenChange(open: boolean) {
    setIsOpen(open);
    if (open) {
      setDraft(effectiveSettings);
      setHasOverride(bookOverride !== null);
      setSaveError(null);
    }
  }

  async function handleSave() {
    setIsSaving(true);
    setSaveError(null);
    try {
      if (hasOverride) await onSave(draft);
      else await onClear();
      setIsOpen(false);
    } catch {
      setSaveError('保存失败，请重试。');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog.Root onOpenChange={handleOpenChange} open={isOpen}>
      <Dialog.Trigger asChild>
        <IconButton
          disabled={disabled}
          icon={<Settings2 aria-hidden="true" size={17} />}
          label="阅读设置"
          variant="ghost"
        />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="bg-surface fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border p-6 shadow-xl">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-lg font-semibold">
                阅读设置
              </Dialog.Title>
              <Dialog.Description className="text-muted-foreground mt-1 text-sm">
                可为本书覆盖全局主题与排版；关闭覆盖后继续使用全局设置。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton
                icon={<X aria-hidden="true" size={17} />}
                label="关闭阅读设置"
                variant="ghost"
              />
            </Dialog.Close>
          </div>

          <label className="mt-5 flex items-center gap-2 text-sm font-medium">
            <input
              checked={hasOverride}
              className="accent-primary size-4"
              onChange={(event) => {
                setHasOverride(event.currentTarget.checked);
              }}
              type="checkbox"
            />
            为本书使用单独设置
          </label>

          <div className="mt-5">
            <ReaderSettingsForm
              disabled={!hasOverride}
              idPrefix="book-reader"
              onChange={setDraft}
              value={draft}
            />
          </div>

          {saveError ? (
            <p className="text-destructive mt-4 text-sm" role="alert">
              {saveError}
            </p>
          ) : null}
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button disabled={isSaving} variant="secondary">
                取消
              </Button>
            </Dialog.Close>
            <Button disabled={isSaving} onClick={() => void handleSave()}>
              {isSaving ? '保存中…' : '保存设置'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
