import {
  DiscoveryError,
  throwIfCancelled,
} from '../../features/discovery/domain/discovery-error';
import type { SyosetuGateway } from '../../features/discovery/syosetu/syosetu-service';

/** Original markup in the shape of なろう pages; no third-party text. */
const tocPage = (page: number) => `<html><body>
<h1 class="p-novel__title">テスト用の長編</h1>
<div class="p-novel__author">作者：<a href="/user/1/">テスト作者</a></div>
<div id="novel_ex" class="p-novel__summary">テストのために書いた、短いあらすじです。</div>
<div class="c-pager"><div class="c-pager__pager">
${page === 1 ? '<a href="/n0001aa/?p=2" class="c-pager__item c-pager__item--next">次へ</a><a href="/n0001aa/?p=2" class="c-pager__item c-pager__item--last">最後へ</a>' : '<a href="/n0001aa/" class="c-pager__item c-pager__item--before">前へ</a>'}
</div></div>
<div class="p-eplist">
${
  page === 1
    ? `<div class="p-eplist__chapter-title">第一部\u3000はじまり</div>
<div class="p-eplist__sublist"><a href="/n0001aa/1/" class="p-eplist__subtitle">
プロローグ
</a><div class="p-eplist__update">2020/01/01 00:00</div></div>
<div class="p-eplist__sublist"><a href="/n0001aa/2/" class="p-eplist__subtitle">二話目</a></div>`
    : `<div class="p-eplist__sublist"><a href="/n0001aa/3/" class="p-eplist__subtitle">一部の終わり</a></div>
<div class="p-eplist__chapter-title">第二部\u3000つづき</div>
<div class="p-eplist__sublist"><a href="/n0001aa/4/" class="p-eplist__subtitle">新章</a></div>
<div class="p-eplist__sublist"><a href="https://evil.example/n0001aa/5/" class="p-eplist__subtitle">外部リンク</a></div>`
}
</div></body></html>`;

const episodePage = (number: number) => `<html><body>
<div class="p-novel__number js-siori">${String(number)}/4</div>
<h1 class="p-novel__title">テスト第${String(number)}話</h1>
<div class="p-novel__body">
${number === 1 ? '<div class="js-novel-text p-novel__text p-novel__text--preface"><p id="Lp1">前書きです。</p></div>' : ''}
<div class="js-novel-text p-novel__text">
<p id="L1">\u3000<ruby>漢字<rp>（</rp><rt>かんじ</rt><rp>）</rp></ruby>のテスト本文、第${String(number)}話。</p>
<p id="L2"><br /></p>
<p id="L3">\u3000<img src="//1.mitemin.net/i/a.jpg" alt="挿絵" /><script>alert(1)</script>続き。</p>
</div>
<div class="js-novel-text p-novel__text p-novel__text--afterword"><p id="La1">後書きです。</p></div>
</div></body></html>`;

export const syosetuFixture = {
  search: JSON.stringify([
    { allcount: 2 },
    {
      title: 'テスト用の長編',
      ncode: 'N0001AA',
      writer: 'テスト作者',
      story: 'テストのために書いた、短いあらすじです。',
      general_all_no: 4,
      noveltype: 1,
      end: 1,
      general_lastup: '2026-10-01 00:00:00',
    },
    { title: 'bad', ncode: '../x', noveltype: 1, end: 0 },
  ]),
  tocPage,
  episodePage,
};

/** Development-only なろう gateway, injected by Playwright. Never in builds. */
export class FixtureSyosetuGateway implements SyosetuGateway {
  readonly available = true;

  search(query: string, _page: number, signal: AbortSignal) {
    throwIfCancelled(signal);
    return Promise.resolve(
      query === '無結果'
        ? JSON.stringify([{ allcount: 0 }])
        : syosetuFixture.search,
    );
  }

  page(path: string, signal: AbortSignal) {
    throwIfCancelled(signal);
    if (path === '/n0001aa/') return Promise.resolve(tocPage(1));
    if (path === '/n0001aa/?p=2') return Promise.resolve(tocPage(2));
    const episode = /^\/n0001aa\/([1-4])\/$/.exec(path)?.[1];
    return episode
      ? Promise.resolve(episodePage(Number(episode)))
      : Promise.reject(new DiscoveryError('SOURCE_INVALID'));
  }
}
