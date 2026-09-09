import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { WebAiSettingsRepository } from '../../../database/repositories/web-ai-settings-repository';
import { FakeModelProvider } from '../../../platform/ai/fake-model-provider';
import { AppError } from '../../../lib/app-error';
import { defaultAiSettings } from '../domain/ai-settings';
import { AgentFacade } from '../services/agent-facade';
import type { AiDraft } from '../domain/agent';
import type { BookLocator } from '../../../reader-engines/types';
import { AiSelectionAssistant } from './ai-selection-assistant';

const book = {
  id: 'book-1',
  title: '公共领域测试书',
  author: null,
  format: 'pdf' as const,
  filePath: 'light-reader/books/book-1/book.pdf',
  fileHash: 'a'.repeat(64),
  coverPath: null,
  metadata: {
    title: '公共领域测试书',
    creators: [],
    language: null,
    publisher: null,
    description: null,
    identifier: null,
  },
  fileSize: 100,
  createdAt: 1,
  updatedAt: 1,
};

const selection = {
  text: '需要总结的公开文本',
  textBefore: null,
  textAfter: null,
  locator: {
    version: 1 as const,
    format: 'pdf' as const,
    pageIndex: 2,
    textRange: { start: 0, end: 10 },
  },
};

function TestHost({
  facade,
  onCreateNote = () => {
    return Promise.resolve();
  },
  onNavigate,
}: {
  facade: AgentFacade;
  onCreateNote?: (draft: { content: string }) => Promise<void>;
  onNavigate?: (locator: BookLocator) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
        }}
        type="button"
      >
        打开助手
      </button>
      {open ? (
        <AiSelectionAssistant
          book={book}
          bookId="book-1"
          bookTitle="公共领域测试书"
          facade={facade}
          onClose={() => {
            setOpen(false);
          }}
          onCreateNote={onCreateNote}
          onNavigate={onNavigate}
          selection={selection}
        />
      ) : null}
    </>
  );
}

async function createEnabledFacade() {
  const repository = new WebAiSettingsRepository();
  await repository.save({ ...defaultAiSettings, enabled: true });
  return new AgentFacade(repository, new FakeModelProvider('生成的安全草稿'));
}

describe('AiSelectionAssistant', () => {
  it('requires exact-text confirmation and only writes after explicit approval', async () => {
    const user = userEvent.setup();
    const onCreateNote = vi.fn(() => {
      return Promise.resolve();
    });
    render(
      <TestHost
        facade={await createEnabledFacade()}
        onCreateNote={onCreateNote}
      />,
    );

    await user.click(screen.getByRole('button', { name: '打开助手' }));
    const text = await screen.findByLabelText('将发送的准确文本');
    expect(text).toHaveValue(selection.text);
    expect(screen.getByText('PDF 第 3 页')).toBeVisible();
    expect(onCreateNote).not.toHaveBeenCalled();

    await user.clear(text);
    await user.type(text, '用户确认后的文本');
    await user.click(screen.getByRole('button', { name: '发送给本地模型' }));
    expect(await screen.findByText('生成的安全草稿')).toBeVisible();
    expect(onCreateNote).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '创建新笔记' }));
    await waitFor(() => {
      expect(onCreateNote).toHaveBeenCalledOnce();
    });
  });

  it('does not call the provider when the consent sidebar is closed', async () => {
    const user = userEvent.setup();
    const repository = new WebAiSettingsRepository();
    await repository.save({ ...defaultAiSettings, enabled: true });
    const provider = new FakeModelProvider();
    const run = vi.spyOn(provider, 'run');
    render(<TestHost facade={new AgentFacade(repository, provider)} />);

    await user.click(screen.getByRole('button', { name: '打开助手' }));
    await screen.findByLabelText('将发送的准确文本');
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(run).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('complementary', { name: '本地 AI 阅读助手' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开助手' })).toHaveFocus();
  });

  it('accepts a bounded custom request for the selected text', async () => {
    const user = userEvent.setup();
    const facade = await createEnabledFacade();
    const prepare = vi.spyOn(facade, 'prepareSelection');
    render(<TestHost facade={facade} />);

    await user.click(screen.getByRole('button', { name: '打开助手' }));
    await user.selectOptions(await screen.findByLabelText('任务'), 'custom');
    const instruction = screen.getByRole('textbox', { name: '自定义需求' });
    await user.type(instruction, '分析论证漏洞，用三个要点回答');
    await user.click(screen.getByRole('button', { name: '发送给本地模型' }));

    expect(await screen.findByText('生成的安全草稿')).toBeVisible();
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'custom',
        instruction: '分析论证漏洞，用三个要点回答',
      }),
    );
  });

  it('accepts a free-form book question and navigates through verified evidence', async () => {
    const user = userEvent.setup();
    const facade = await createEnabledFacade();
    const locator = {
      version: 1 as const,
      format: 'pdf' as const,
      pageIndex: 4,
      textRange: { start: 10, end: 30 },
    };
    const draft = {
      schemaVersion: 1,
      id: 'draft-book-qa',
      runId: 'run-book-qa',
      task: 'book-qa',
      action: 'custom',
      title: '本书问答：AI 阅读草稿',
      content: '作者认为本地优先更尊重隐私 [S1]。',
      citations: [
        {
          schemaVersion: 1,
          id: 'citation-1',
          runId: 'run-book-qa',
          bookId: book.id,
          bookTitleSnapshot: book.title,
          chapterTitleSnapshot: 'PDF 第 5 页',
          locator,
          quote: '本地优先更尊重隐私。',
          sourceChunkId: 'passage-1',
          sourceTextHash: 'fnv1a-deadbeef',
          validation: 'verified',
          supportValidation: 'not-assessed',
        },
      ],
      sourceSnapshotHash: 'fnv1a-cafebabe',
      provider: 'ollama',
      model: defaultAiSettings.model,
      promptVersion: 'book-qa-v1',
      status: 'draft',
      createdAt: 1,
      decidedAt: null,
    } satisfies AiDraft;
    vi.spyOn(facade, 'runBookQuestion').mockResolvedValue({
      draft,
      run: {} as never,
      trace: [
        {
          schemaVersion: 1,
          callId: 'call-search',
          name: 'search_books',
          status: 'completed',
          returnedChars: 128,
          resultHash: 'fnv1a-private-value',
        },
      ],
    });
    const onNavigate = vi.fn();
    render(<TestHost facade={facade} onNavigate={onNavigate} />);

    await user.click(screen.getByRole('button', { name: '打开助手' }));
    await user.click(await screen.findByRole('button', { name: '本书问答' }));
    await user.type(
      screen.getByLabelText('向本书提问'),
      '作者的核心观点是什么？',
    );
    await user.click(screen.getByRole('button', { name: '检索本书并提问' }));

    expect(await screen.findByText(draft.content)).toBeVisible();
    await user.click(screen.getByRole('button', { name: '依据 1 · 第 5 页' }));
    expect(onNavigate).toHaveBeenCalledWith(locator);
    await user.click(screen.getByText('本次运行详情（不含原文）'));
    expect(screen.getByText('搜索本书：完成，返回 128 个字符')).toBeVisible();
    expect(screen.queryByText('fnv1a-private-value')).not.toBeInTheDocument();
  });

  it('显示索引进度，并允许用户手动重建当前图书索引', async () => {
    const user = userEvent.setup();
    const facade = await createEnabledFacade();
    const rebuild = vi
      .spyOn(facade, 'rebuildBookIndex')
      .mockImplementation((_book, _signal, onProgress) => {
        onProgress?.({
          stage: 'extracting-text',
          completed: 2,
          total: 4,
        });
        return Promise.resolve();
      });
    render(<TestHost facade={facade} />);

    await user.click(screen.getByRole('button', { name: '打开助手' }));
    await user.click(await screen.findByRole('button', { name: '本书问答' }));
    await user.click(screen.getByRole('button', { name: '重建本书 AI 索引' }));

    expect(rebuild).toHaveBeenCalledWith(
      book,
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(await screen.findByText('本书 AI 索引已重新建立。')).toBeVisible();
  });

  it('索引失败时只在 AI 侧边栏中显示可恢复错误', async () => {
    const user = userEvent.setup();
    const facade = await createEnabledFacade();
    vi.spyOn(facade, 'runBookQuestion').mockRejectedValue(
      new AppError('SEARCH_INDEX_FAILED'),
    );
    render(<TestHost facade={facade} />);

    await user.click(screen.getByRole('button', { name: '打开助手' }));
    await user.click(await screen.findByRole('button', { name: '本书问答' }));
    await user.type(screen.getByLabelText('向本书提问'), '这本书说了什么？');
    await user.click(screen.getByRole('button', { name: '检索本书并提问' }));

    expect(await screen.findByText('无法完成生成')).toBeVisible();
    expect(
      screen.getByText('无法更新本地搜索索引，请稍后重试。'),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: '关闭 AI 阅读助手' }),
    ).toBeEnabled();
  });

  it('explains how to recover when AI is disabled', async () => {
    const user = userEvent.setup();
    const facade = new AgentFacade(
      new WebAiSettingsRepository(),
      new FakeModelProvider(),
    );
    render(<TestHost facade={facade} />);

    await user.click(screen.getByRole('button', { name: '打开助手' }));
    expect(await screen.findByText('AI 助手尚未启用')).toBeVisible();
  });
});
