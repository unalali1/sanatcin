import test from 'node:test';
import assert from 'node:assert/strict';
import { dateFromUrl, discoverFromFeedXml, discoverFromHtml, extractBestArticleTextFromHtml, normalizeUrl } from '../src/fetch.js';
import { SOURCES, SOURCE_SET_VERSION } from '../src/sources.js';

test('Excel kaynak havuzu eksiksiz ve eski havuzdan bağımsızdır', () => {
  assert.equal(SOURCE_SET_VERSION, '2026-09-10-en-01');
  assert.equal(SOURCES.length, 17);
  assert.equal(SOURCES.filter((source) => source.enabled).length, 16);
  assert.equal(SOURCES.filter((source) => source.mode === 'rss').length, 6);
  assert.equal(SOURCES.find((source) => source.id === 'ocula-magazine')?.enabled, false);
  for (const retired of ['xinhua-zh-culture', 'global-times-arts', 'scmp-arts-culture', '1905-film', 'vogue-china']) {
    assert.equal(SOURCES.some((source) => source.id === retired), false);
  }
});

test('izleme parametrelerini ve çift eğik çizgiyi canonical URL’den kaldırır', () => {
  assert.equal(
    normalizeUrl('http://en.chinaculture.org//a/202609/11/WS1.html?utm_source=test#top', 'https://en.chinaculture.org/'),
    'http://en.chinaculture.org/a/202609/11/WS1.html'
  );
});

test('China Daily ve Xinhua tarihlerini URL yolundan çıkarır', () => {
  assert.equal(dateFromUrl('https://www.chinadaily.com.cn/a/202609/11/WS1.html'), '2026-09-10T16:00:00.000Z');
  assert.equal(dateFromUrl('https://english.news.cn/20260911/abcdef/c.html'), '2026-09-10T16:00:00.000Z');
});

test('China Daily adaptörü yalnız tarihli haber bağlantılarını alır', () => {
  const source = SOURCES.find((item) => item.id === 'china-daily-culture');
  const html = `
    <main>
      <article><a href="//www.chinadaily.com.cn/a/202609/11/WS123.html">Museum opens major exhibition in Beijing</a><p>A new culture exhibition opens this week.</p></article>
      <a href="/culture">Culture</a>
    </main>`;
  const items = discoverFromHtml(html, source);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://www.chinadaily.com.cn/a/202609/11/WS123.html');
  assert.equal(items[0].publishedAt, '2026-09-10T16:00:00.000Z');
});

test('Xinhua adaptörü yalnız c.html haber desenini alır', () => {
  const source = SOURCES.find((item) => item.id === 'xinhua-culture');
  const html = `
    <main>
      <div class="item"><a href="https://english.news.cn/20260911/a1b2/c.html">New heritage exhibition opens in Shanghai</a></div>
      <div class="item"><a href="https://english.news.cn/world/index.htm">World</a></div>
    </main>`;
  const items = discoverFromHtml(html, source);
  assert.equal(items.length, 1);
  assert.equal(items[0].publishedAt, '2026-09-10T16:00:00.000Z');
});

test('RSS adaptörü kaynak konu filtresini uygular', async () => {
  const source = SOURCES.find((item) => item.id === 'sixth-tone');
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>Shanghai museum opens design exhibition</title><link>https://www.sixthtone.com/news/1</link><pubDate>Thu, 10 Sep 2026 08:00:00 GMT</pubDate><description>Culture and art</description></item>
    <item><title>New banking rules announced</title><link>https://www.sixthtone.com/news/2</link><pubDate>Thu, 10 Sep 2026 08:00:00 GMT</pubDate><description>Finance</description></item>
  </channel></rss>`;
  const items = await discoverFromFeedXml(xml, source);
  assert.equal(items.length, 1);
  assert.match(items[0].title, /museum/i);
});

test('Readability kısa kaldığında JSON-LD haber gövdesini kullanır', () => {
  const body = 'Şanghay’daki sergi yeni yapıtları ziyaretçiyle buluşturuyor. '.repeat(15);
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', articleBody: body })}</script></head><body><main><p>Kısa özet.</p></main></body></html>`;
  assert.equal(extractBestArticleTextFromHtml(html).trim(), body.trim());
});
