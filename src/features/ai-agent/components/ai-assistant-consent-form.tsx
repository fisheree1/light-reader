import { useMemo } from 'react';

import { Button } from '../../../components/ui/button';
import type { ReaderTextSelection } from '../../../reader-engines/types';
import {
  selectionAiActionLabels,
  type SelectionAiAction,
} from '../domain/agent';
import type { AiAssistantForm } from '../hooks/ai-assistant-reducer';
import { detectSensitiveContent } from '../services/sensitive-content';

interface AiAssistantConsentFormProps {
  bookTitle: string;
  form: AiAssistantForm;
  indexNotice: string | null;
  model: string | null;
  onCancel: () => void;
  onChange: (patch: Partial<AiAssistantForm>) => void;
  onRebuildIndex: () => void;
  onSend: () => void;
  selection: ReaderTextSelection | null;
}

/** Shows exactly what will be sent to the local model and asks to send it. */
export function AiAssistantConsentForm({
  bookTitle,
  form,
  indexNotice,
  model,
  onCancel,
  onChange,
  onRebuildIndex,
  onSend,
  selection,
}: AiAssistantConsentFormProps) {
  const { action, customInstruction, mode, question, text } = form;
  const warnings = useMemo(() => detectSensitiveContent(text), [text]);
  const canSend =
    mode === 'book'
      ? question.trim().length >= 2
      : selection !== null &&
        text.trim().length > 0 &&
        (action !== 'custom' || customInstruction.trim().length > 0);

  return (
    <div className="mt-5 space-y-4">
      <div aria-label="AI 使用范围" className="grid grid-cols-2 gap-2">
        <Button
          onClick={() => {
            onChange({ mode: 'book' });
          }}
          variant={mode === 'book' ? 'default' : 'secondary'}
        >
          本书问答
        </Button>
        <Button
          onClick={() => {
            onChange({ mode: 'selection' });
          }}
          variant={mode === 'selection' ? 'default' : 'secondary'}
        >
          处理选区
        </Button>
      </div>

      <div className="rounded-md border p-3 text-sm">
        <p>
          <span className="font-medium">来源：</span>《{bookTitle}》
        </p>
        {mode === 'selection' && selection ? (
          <p className="text-muted-foreground mt-1">
            {selection.locator.format === 'pdf'
              ? `PDF 第 ${String(selection.locator.pageIndex + 1)} 页`
              : 'EPUB 当前选区'}
          </p>
        ) : null}
        <p className="text-muted-foreground mt-1">
          Provider：Ollama（本机） · 模型：
          {model ?? '未配置'}
        </p>
      </div>

      {mode === 'book' ? (
        <>
          <label className="block text-sm font-medium">
            向本书提问
            <textarea
              aria-label="向本书提问"
              autoFocus
              className="bg-background mt-2 min-h-32 w-full rounded-md border px-3 py-2 text-sm"
              maxLength={1_000}
              onChange={(event) => {
                onChange({ question: event.currentTarget.value });
              }}
              placeholder="例如：作者如何解释这个观点？请列出书中依据。"
              value={question}
            />
          </label>
          <p className="text-muted-foreground text-xs leading-relaxed">
            将在本机为当前图书建立文本索引，只向本机模型发送最相关的少量片段。首次使用可能需要稍等；扫描版
            PDF 暂不支持。
          </p>
          {indexNotice ? (
            <p className="text-sm" role="status">
              {indexNotice}
            </p>
          ) : null}
          <Button onClick={onRebuildIndex} variant="secondary">
            重建本书 AI 索引
          </Button>
        </>
      ) : selection ? (
        <>
          <label className="block text-sm font-medium">
            任务
            <select
              className="bg-background mt-2 w-full rounded-md border px-3 py-2"
              onChange={(event) => {
                onChange({
                  action: event.currentTarget.value as SelectionAiAction,
                });
              }}
              value={action}
            >
              {Object.entries(selectionAiActionLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          {action === 'custom' ? (
            <label className="block text-sm font-medium">
              自定义需求
              <textarea
                aria-label="自定义需求"
                autoFocus
                className="bg-background mt-2 min-h-28 w-full rounded-md border px-3 py-2 text-sm"
                maxLength={1_000}
                onChange={(event) => {
                  onChange({ customInstruction: event.currentTarget.value });
                }}
                placeholder="例如：分析作者的论证漏洞，并用三个要点回答。"
                value={customInstruction}
              />
              <span className="text-muted-foreground mt-1 block text-xs">
                {String(customInstruction.length)} / 1000 个字符
              </span>
            </label>
          ) : null}

          <label className="block text-sm font-medium">
            将发送的准确文本
            <textarea
              className="bg-background mt-2 min-h-40 w-full rounded-md border px-3 py-2 font-mono text-sm"
              maxLength={12_000}
              onChange={(event) => {
                onChange({ text: event.currentTarget.value });
              }}
              value={text}
            />
          </label>
          <p className="text-muted-foreground text-xs">
            {String(text.length)} / 12000 个字符。你可以先编辑或遮盖敏感内容。
          </p>

          {warnings.length ? (
            <div
              className="border-destructive/40 rounded-md border p-3 text-sm"
              role="alert"
            >
              <p className="font-medium">发送前请检查敏感内容</p>
              <ul className="mt-1 list-disc pl-5">
                {warnings.map((warning) => (
                  <li key={warning.kind}>{warning.label}</li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-1 text-xs">
                本地检测可能遗漏内容；请自行确认后再发送。
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <div className="rounded-md border p-3 text-sm">
          当前没有正文选区。请先在阅读区选择文字，或使用“本书问答”。
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button onClick={onCancel} variant="secondary">
          取消
        </Button>
        <Button disabled={!canSend} onClick={onSend}>
          {mode === 'book' ? '检索本书并提问' : '发送给本地模型'}
        </Button>
      </div>
    </div>
  );
}
