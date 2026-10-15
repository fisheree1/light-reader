import type {
  NovelGateway,
  NovelSource,
  PageRequest,
  PageSnapshot,
} from '../../features/discovery/domain/catalog';
import {
  DiscoveryError,
  throwIfCancelled,
} from '../../features/discovery/domain/discovery-error';
import { sourceUrl } from '../../features/discovery/services/bilinovel-parser';

export const novelFixture = {
  search:
    '<html><head><title>搜索结果</title></head><body><a href="/novel/1.html">测试轻小说</a><a href="/novel/1.html">测试轻小说</a></body></html>',
  catalogue: `<h1>测试轻小说</h1><h2>作者：测试作者、插画：测试画师</h2><div id="volumes">
    <ul class="volume-chapters"><li><a href="/novel/1/vol_10.html"><h3>测试轻小说 第一卷</h3></a></li><li class="volume-cover"><img data-src="https://img3.readpai.com/cover/1/cover.png"/></li><li class="jsChapter"><a href="/novel/1/101.html">序章</a></li><li class="jsChapter"><a href="/novel/1/102.html">插图与注音</a></li></ul>
    <ul class="volume-chapters"><li><a href="/novel/1/vol_20.html"><h3>测试轻小说 第二卷</h3></a></li><li class="jsChapter"><a href="javascript:cid(1)">受限章节</a></li></ul>
    <ul class="volume-chapters"><li><a href="/novel/1/vol_30.html"><h3>测试轻小说 画集[日版]</h3></a></li><li class="jsChapter"><a href="/novel/1/103.html">画集</a></li></ul></div>`,
  catalogueDesktop: `<div class="book-meta"><h1>测试轻小说</h1><p>作者：<a href="/authorarticle/测试作者.html">测试作者</a></p></div><div class="volume-list">
    <div class="volume"><a class="volume-cover" href="/novel/1/vol_10.html"><img data-original="https://img3.readpai.com/cover/1/cover.png"/></a><div class="volume-info"><h2><a href="/novel/1/vol_10.html">测试轻小说 第一卷</a></h2></div><ul class="chapter-list"><li><a href="/novel/1/101.html">序章</a></li><li><a href="/novel/1/102.html">插图与注音</a></li></ul></div>
    <div class="volume"><h2><a href="/novel/1/vol_20.html">测试轻小说 第二卷</a></h2><ul class="chapter-list"><li><a href="javascript:cid(1)">受限章节</a></li></ul></div>
    <div class="volume"><h2><a href="/novel/1/vol_30.html">测试轻小说 画集[日版]</a></h2><ul class="chapter-list"><li><a href="/novel/1/103.html">画集</a></li></ul></div></div>`,
  first:
    '<h1 id="atitle">序章</h1><div id="acontent"><p>这是一段为自动测试创作的中文译文。</p><script>alert(1)</script><p hidden>隐藏的干扰文字</p></div><div id="footlink"><a href="/novel/1/101_2.html">下一页</a></div>',
  second:
    '<h1 id="atitle">序章</h1><div id="acontent"><p>故事继续，这是同一章节的第二页。</p><p>译者：测试译者</p></div><div id="footlink"><a href="/novel/1/102.html">下一章</a></div>',
  illustration:
    '<h1 id="atitle">插图与注音</h1><div id="acontent"><p><ruby>测试<rt>test</rt></ruby>内容。</p><img data-src="https://img3.readpai.com/pic/1/art.png" alt="测试插图"/></div>',
};

export function fixtureImage(): Uint8Array {
  return Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN0kAAAAASUVORK5CYII=',
    ),
    (character) => character.charCodeAt(0),
  );
}

/** Development-only Gateway, injected by Playwright. Never selected in builds. */
export class FixtureNovelGateway implements NovelGateway {
  readonly available = true;
  readPage(
    source: NovelSource,
    request: PageRequest,
    signal: AbortSignal,
  ): Promise<PageSnapshot> {
    throwIfCancelled(signal);
    if (request.kind === 'current')
      return Promise.resolve({
        url: sourceUrl(source, '/novel/1.html'),
        html: '<h1>测试轻小说</h1>',
      });
    if (request.kind === 'search') {
      if (request.query === '故障')
        return Promise.reject(new DiscoveryError('SOURCE_ACCESS_DENIED'));
      return Promise.resolve({
        url: sourceUrl(source, '/search.html'),
        html:
          request.query === '空'
            ? '<p>没有符合条件的结果</p>'
            : novelFixture.search,
      });
    }
    const pages: Record<string, string> = {
      '/novel/1/catalog':
        source === 'linovelib'
          ? novelFixture.catalogueDesktop
          : novelFixture.catalogue,
      '/novel/1/101.html': novelFixture.first,
      '/novel/1/101_2.html': novelFixture.second,
      '/novel/1/102.html': novelFixture.illustration,
    };
    const html = pages[request.path];
    return html
      ? Promise.resolve({ url: sourceUrl(source, request.path), html })
      : Promise.reject(new DiscoveryError('SOURCE_INVALID'));
  }
  readImage(
    _source: NovelSource,
    _url: string,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    throwIfCancelled(signal);
    return Promise.resolve(fixtureImage());
  }
  openSource(): Promise<void> {
    return Promise.resolve();
  }
}
