/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

function script(name: 'search' | 'snapshot' | 'navigate' | 'ready') {
  return readFileSync(
    resolve('src-tauri', 'src', 'catalog', `${name}.js`),
    'utf8',
  ).replace('__REQUEST_ID__', '"test"');
}

function environment() {
  const requests: string[] = [];
  return {
    requests,
    context: {
      document,
      window: {} as Record<string, unknown>,
      getComputedStyle,
      URL,
      TextEncoder,
      btoa,
      setTimeout,
      location: {
        hostname: 'www.bilinovel.com',
        assign: vi.fn(),
        get href() {
          return 'https://www.bilinovel.com/search.html';
        },
        set href(value: string) {
          requests.push(value);
        },
      },
    },
  };
}

describe('isolated source scripts', () => {
  it('signals readable DOM without waiting for ads and other resources to finish', () => {
    const { context, requests } = environment();
    context.window.top = context.window;
    const readyDocument = document.implementation.createHTMLDocument();
    vi.spyOn(readyDocument, 'readyState', 'get').mockReturnValue('interactive');
    runInNewContext(script('ready'), { ...context, document: readyDocument });
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]).pathname).toBe('/ready');
    expect(new URL(requests[0]).searchParams.get('url')).toBe(
      'https://www.bilinovel.com/search.html',
    );
  });
  it('keeps source book links in the isolated window while leaving external popups blocked', () => {
    const { context } = environment();
    context.window.top = context.window;
    const sourceDocument = document.implementation.createHTMLDocument();
    sourceDocument.body.innerHTML =
      '<a href="https://www.bilinovel.com/novel/1.html" target="_blank">作品</a><a href="https://other.test/" target="_blank">外站</a>';
    runInNewContext(script('ready'), { ...context, document: sourceDocument });
    const links = sourceDocument.querySelectorAll('a');
    for (const link of links) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
      });
      link.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    }
    expect(links[0].target).toBe('_self');
    expect(links[1].target).toBe('_blank');
  });
  beforeEach(() => {
    vi.useFakeTimers();
    document.title = '';
    document.body.replaceChildren();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('waits for the real form and marks submission before posting', async () => {
    const { context, requests } = environment();
    runInNewContext(
      script('search')
        .replace('__QUERY__', '"测试小说"')
        .replace('__SNAPSHOT__', ''),
      context,
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(requests).toHaveLength(0);
    document.body.innerHTML = '<form><input name="searchkey" /></form>';
    const form = document.querySelector('form');
    if (!form) throw new Error('Missing fixture form');
    const submit = vi
      .spyOn(form, 'requestSubmit')
      .mockImplementation(() => undefined);
    await vi.advanceTimersByTimeAsync(250);
    expect(requests).toEqual(['https://lightreader.invalid/submitted?id=test']);
    expect(submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(submit).toHaveBeenCalledOnce();
    expect(document.querySelector('input')?.value).toBe('测试小说');
  });

  it('exports visible content in order without executable or hidden nodes', async () => {
    const { context, requests } = environment();
    document.title = '测试小说';
    document.body.innerHTML =
      '<h1>测试小说</h1><p>测试正文</p><p style="display:none">隐藏文字</p><p style="position:absolute;transform:matrix(0,0,0,0,0,0)">折叠的干扰段落</p><script>window.secret=1</script><script>var ReadParams={url_next:"/novel/1/101_2.html"}</script><p onclick="alert(1)">普通段落</p>';
    runInNewContext(script('snapshot'), context);
    runInNewContext(script('snapshot'), context);
    await vi.advanceTimersByTimeAsync(2000);
    const encoded = requests
      .map((value) => new URL(value).searchParams.get('data') ?? '')
      .join('');
    const snapshot: unknown = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
      ),
    );
    expect(snapshot).toMatchObject({
      url: 'https://www.bilinovel.com/search.html',
    });
    expect(JSON.stringify(snapshot)).toContain('测试正文');
    expect(JSON.stringify(snapshot)).toContain('/novel/1/101_2.html');
    expect(JSON.stringify(snapshot)).not.toMatch(
      /隐藏文字|干扰段落|script|onclick|secret/,
    );
  });
  it('does not submit a cancelled search when a form appears later', async () => {
    const { context, requests } = environment();
    runInNewContext(
      script('search')
        .replace('__QUERY__', '"旧查询"')
        .replace('__SNAPSHOT__', ''),
      context,
    );
    await vi.advanceTimersByTimeAsync(250);
    context.window.__lightReaderCancelled = { test: true };
    document.body.innerHTML = '<form><input name="searchkey" /></form>';
    const form = document.querySelector('form');
    if (!form) throw new Error('Missing fixture form');
    const submit = vi
      .spyOn(form, 'requestSubmit')
      .mockImplementation(() => undefined);
    await vi.advanceTimersByTimeAsync(1000);
    expect(submit).not.toHaveBeenCalled();
    expect(requests).toHaveLength(0);
  });
  it('uses normal source link handlers when navigating', async () => {
    const { context } = environment();
    runInNewContext(
      script('navigate').replace(
        '__TARGET_URL__',
        '"https://www.bilinovel.com/search.html"',
      ),
      { ...context, URL },
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(context.location.assign).not.toHaveBeenCalled();
    document.title = '来源首页';
    document.body.innerHTML = '<a href="/search.html">搜索</a>';
    const clicked = vi.fn();
    document.querySelector('a')?.addEventListener('click', (event) => {
      event.preventDefault();
      clicked();
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(clicked).toHaveBeenCalledOnce();
    expect(context.location.assign).not.toHaveBeenCalled();
  });
});
