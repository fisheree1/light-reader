import { invoke } from '@tauri-apps/api/core';
import { TauriNovelGateway } from './tauri-novel-gateway';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));

describe('native source transport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it('ends a stalled native response and cancels that request', async () => {
    vi.mocked(invoke).mockReturnValue(new Promise<never>(() => undefined));
    const request = new TauriNovelGateway().readImage(
      'bilinovel',
      'https://img3.readpai.com/cover/1/a.jpg',
      new AbortController().signal,
    );
    const assertion = expect(request).rejects.toMatchObject({
      code: 'SOURCE_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(40_000);
    await assertion;
    const arguments_ = vi.mocked(invoke).mock.calls[0][1];
    if (!arguments_ || !('requestId' in arguments_))
      throw new Error('Missing request identity');
    expect(invoke).toHaveBeenCalledWith('catalog_cancel', {
      requestId: arguments_.requestId,
    });
  });
  it('releases a cancelled caller even if native IPC never responds', async () => {
    vi.mocked(invoke).mockReturnValue(new Promise<never>(() => undefined));
    const controller = new AbortController();
    const request = new TauriNovelGateway().readImage(
      'bilinovel',
      'https://img3.readpai.com/cover/1/a.jpg',
      controller.signal,
    );
    const assertion = expect(request).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
