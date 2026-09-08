import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { WebAiSettingsRepository } from '../../../database/repositories/web-ai-settings-repository';
import { FakeModelProvider } from '../../../platform/ai/fake-model-provider';
import { AgentFacade } from '../services/agent-facade';
import { AiSettingsSection } from './ai-settings-section';

describe('AiSettingsSection', () => {
  it('keeps AI disabled by default and persists explicit enablement', async () => {
    const user = userEvent.setup();
    const repository = new WebAiSettingsRepository();
    const facade = new AgentFacade(repository, new FakeModelProvider());
    render(<AiSettingsSection facade={facade} />);

    const enabled = await screen.findByLabelText('启用本地 AI 助手');
    expect(enabled).not.toBeChecked();
    await user.click(enabled);
    await user.click(screen.getByRole('button', { name: '保存 AI 设置' }));

    await waitFor(() => {
      expect(screen.getByText('AI 设置已保存')).toBeVisible();
    });
    await expect(repository.get()).resolves.toMatchObject({ enabled: true });
  });

  it('reports the selected model as available', async () => {
    const user = userEvent.setup();
    const facade = new AgentFacade(
      new WebAiSettingsRepository(),
      new FakeModelProvider(),
    );
    render(<AiSettingsSection facade={facade} />);

    await screen.findByLabelText('启用本地 AI 助手');
    await user.click(screen.getByRole('button', { name: '检测 Ollama' }));
    expect(await screen.findByText('Ollama 和模型均可用')).toBeVisible();
  });
});
