import { Copy, FilePlus2, Square } from 'lucide-react';

import { Button } from '../../../components/ui/button';
import type { BookLocator } from '../../../reader-engines/types';
import type { AgentToolTraceEntry } from '../domain/agent-tool';
import type { AiDraft } from '../domain/agent';
import type { BookIndexingProgress } from '../retrieval/book-indexing';

const indexingStageLabels: Record<BookIndexingProgress['stage'], string> = {
  'reading-source': '正在读取本地图书…',
  'extracting-text': '正在提取正文…',
  'chunking-text': '正在整理检索片段…',
  'writing-index': '正在写入本地索引…',
  'searching-index': '正在搜索本书依据…',
  ready: '本书索引已就绪',
};

function getProgressLabel(progress: BookIndexingProgress | null): string {
  if (!progress) return '正在准备本书索引…';
  const suffix =
    progress.completed !== null && progress.total !== null
      ? ` ${String(progress.completed)} / ${String(progress.total)}`
      : '';
  return `${indexingStageLabels[progress.stage]}${suffix}`;
}

export function AiRunningStatus({
  mode,
  onCancel,
  output,
  progress,
}: {
  mode: 'book' | 'selection';
  onCancel: () => void;
  output: string;
  progress: BookIndexingProgress | null;
}) {
  return (
    <div className="mt-5">
      <p aria-live="polite" className="text-sm font-medium">
        {mode === 'book'
          ? output
            ? '本地模型正在生成回答…'
            : getProgressLabel(progress)
          : 'DeepSeek-R1 正在生成…'}
      </p>
      <pre className="bg-background mt-3 min-h-40 rounded-md border p-4 font-sans text-sm whitespace-pre-wrap">
        {output || '正在等待第一个结果…'}
      </pre>
      <div className="mt-4 flex justify-end">
        <Button onClick={onCancel} variant="secondary">
          <Square aria-hidden="true" size={15} />
          停止生成
        </Button>
      </div>
    </div>
  );
}

export function AiRebuildingStatus({
  onCancel,
  progress,
}: {
  onCancel: () => void;
  progress: BookIndexingProgress | null;
}) {
  return (
    <div className="mt-5 rounded-md border p-4">
      <p aria-live="polite" className="text-sm font-medium">
        {getProgressLabel(progress)}
      </p>
      <p className="text-muted-foreground mt-2 text-xs">
        只处理当前图书，取消后不会留下半写入的 SQLite 索引。
      </p>
      <Button className="mt-4" onClick={onCancel} variant="secondary">
        <Square aria-hidden="true" size={15} />
        取消重建
      </Button>
    </div>
  );
}

export function AiCancelledStatus({
  operation,
  onRestart,
}: {
  operation: 'answer' | 'rebuild';
  onRestart: () => void;
}) {
  return (
    <div className="mt-5 rounded-md border p-4">
      <p className="font-medium">
        {operation === 'rebuild' ? '索引重建已取消' : '生成已取消'}
      </p>
      <p className="text-muted-foreground mt-1 text-sm">
        {operation === 'rebuild'
          ? '原有索引仍可继续使用。'
          : '没有创建草稿或写入笔记。'}
      </p>
      <Button className="mt-4" onClick={onRestart}>
        重新开始
      </Button>
    </div>
  );
}

export function AiErrorStatus({
  error,
  onBack,
}: {
  error: string | null;
  onBack: () => void;
}) {
  return (
    <div className="mt-5 rounded-md border p-4" role="alert">
      <p className="font-medium">无法完成生成</p>
      <p className="text-destructive mt-1 text-sm">{error}</p>
      <Button className="mt-4" onClick={onBack}>
        返回发送预览
      </Button>
    </div>
  );
}

interface AiDraftResultProps {
  bookTitle: string;
  copied: boolean;
  draft: AiDraft;
  isCreatingNote: boolean;
  onClose: () => void;
  onCopy: () => void;
  onCreateNote: () => void;
  onNavigate?: (locator: BookLocator) => void;
  trace: AgentToolTraceEntry[];
}

export function AiDraftResult({
  bookTitle,
  copied,
  draft,
  isCreatingNote,
  onClose,
  onCopy,
  onCreateNote,
  onNavigate,
  trace,
}: AiDraftResultProps) {
  return (
    <div className="mt-5">
      <p aria-live="polite" className="text-sm font-medium">
        已生成独立 AI 草稿
      </p>
      <pre className="bg-background mt-3 max-h-80 overflow-auto rounded-md border p-4 font-sans text-sm whitespace-pre-wrap">
        {draft.content}
      </pre>
      <p className="text-muted-foreground mt-2 text-xs">
        由本机 {draft.model} 生成。内容可能有误，请核对后使用。
      </p>
      {draft.citations.length ? (
        <div className="mt-4">
          <p className="text-xs font-medium">已定位到原书的依据</p>
          <p className="text-muted-foreground mt-1 text-xs">
            位置和原文版本已在本地验证；是否足以支持回答仍需你核对。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {draft.citations.map((citation, index) => (
              <Button
                key={citation.id}
                onClick={() => onNavigate?.(citation.locator)}
                variant="secondary"
              >
                依据 {String(index + 1)} ·{' '}
                {citation.locator.format === 'pdf'
                  ? `第 ${String(citation.locator.pageIndex + 1)} 页`
                  : (citation.chapterTitleSnapshot ?? '章节')}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {trace.length ? (
        <details className="mt-4 rounded-md border p-3 text-xs">
          <summary className="cursor-pointer font-medium">
            本次运行详情（不含原文）
          </summary>
          <p className="text-muted-foreground mt-2">
            范围：《{bookTitle}》 · 工具调用 {String(trace.length)} 次
          </p>
          <ul className="mt-2 space-y-1">
            {trace.map((item) => (
              <li key={item.callId}>
                {item.name === 'search_books' ? '搜索本书' : '读取片段'}：
                {item.status === 'completed'
                  ? `完成，返回 ${String(item.returnedChars)} 个字符`
                  : item.status === 'rejected'
                    ? '已拒绝'
                    : '失败'}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button onClick={onClose} variant="secondary">
          丢弃
        </Button>
        <Button onClick={onCopy} variant="secondary">
          <Copy aria-hidden="true" size={15} />
          {copied ? '已复制' : '复制'}
        </Button>
        <Button disabled={isCreatingNote} onClick={onCreateNote}>
          <FilePlus2 aria-hidden="true" size={15} />
          {isCreatingNote ? '正在创建…' : '创建新笔记'}
        </Button>
      </div>
    </div>
  );
}
