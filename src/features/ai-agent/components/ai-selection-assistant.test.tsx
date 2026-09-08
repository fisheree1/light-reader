import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { WebAiSettingsRepository } from '../../../database/repositories/web-ai-settings-repository';
import { FakeModelProvider } from '../../../platform/ai/fake-model-provider';
import { defaultAiSettings } from '../domain/ai-settings';
import { AgentFacade } from '../services/agent-facade';
import { AiSelectionAssistant } from './ai-selection-assistant';

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
}: {
  facade: AgentFacade;
  onCreateNote?: (draft: { content: string }) => Promise<void>;
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
      <AiSelectionAssistant
        bookId="book-1"
        bookTitle="公共领域测试书"
        facade={facade}
        onCreateNote={onCreateNote}
        onOpenChange={setOpen}
        open={open}
        selection={selection}
      />
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

  it('does not call the provider when the consent dialog is closed', async () => {
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
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开助手' })).toHaveFocus();
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
