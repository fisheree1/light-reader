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

describe('request spacing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('spaces images as well as pages on one shared clock', async () => {
    vi.mocked(invoke).mockImplementation((command) =>
      Promise.resolve(
        command === 'catalog_read_image'
          ? new Uint8Array([1])
          : { url: 'https://www.bilinovel.com/novel/1.html', html: '<p></p>' },
      ),
    );
    const gateway = new TauriNovelGateway();
    const signal = new AbortController().signal;
    const calls = () =>
      vi
        .mocked(invoke)
        .mock.calls.filter(([command]) => command !== 'catalog_cancel').length;

    await gateway.readImage(
      'bilinovel',
      'https://img3.readpai.com/a.jpg',
      signal,
    );
    expect(calls()).toBe(1);

    const secondImage = gateway.readImage(
      'bilinovel',
      'https://img3.readpai.com/b.jpg',
      signal,
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await secondImage;
    expect(calls()).toBe(2);

    const page = gateway.readPage(
      'bilinovel',
      { kind: 'page', path: '/novel/1.html' },
      signal,
    );
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    await page;
    expect(calls()).toBe(3);
  });

  it('can be cancelled while waiting for its turn', async () => {
    vi.mocked(invoke).mockResolvedValue(new Uint8Array([1]));
    const gateway = new TauriNovelGateway();
    await gateway.readImage(
      'bilinovel',
      'https://img3.readpai.com/a.jpg',
      new AbortController().signal,
    );
    const controller = new AbortController();
    const waiting = gateway.readImage(
      'bilinovel',
      'https://img3.readpai.com/b.jpg',
      controller.signal,
    );
    const assertion = expect(waiting).rejects.toMatchObject({
      name: 'AbortError',
    });
    controller.abort();
    await assertion;
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1);
  });
});
