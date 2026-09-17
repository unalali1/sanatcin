import test from 'node:test';
import assert from 'node:assert/strict';
import { dateFromUrl, discoverFromFeedXml, discoverFromHtml, extractBestArticleTextFromHtml, normalizeUrl } from '../src/fetch.js';
import { SOURCES, SOURCE_SET_VERSION } from '../src/sources.js';

test('Excel kaynak havuzu eksiksiz ve eski havuzdan bağımsızdır', () => {
  assert.equal(SOURCE_SET_VERSION, '2026-09-17-en-02');
  assert.equal(SOURCES.length, 17);
  assert.equal(SOURCES.filter((source) => source.enabled).length, 14);
  assert.equal(SOURCES.filter((source) => source.mode === 'rss').length, 6);
  assert.equal(SOURCES.find((source) => source.id === 'ocula-magazine')?.enabled, false);
  assert.equal(SOURCES.find((source) => source.id === 'smartshanghai-exhibitions')?.enabled, false);
  assert.equal(SOURCES.find((source) => source.id === 'smartshanghai-stage')?.enabled, false);
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
      <a href="/20260911/abcdef/c.html">Chinese film opens in cinemas</a>
      <a href="/english/index.htm">Home</a>
    </main>`;
  const items = discoverFromHtml(html, source);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://english.news.cn/20260911/abcdef/c.html');
});

test('RSS adaptörü kaynak konu filtresini uygular', async () => {
  const source = SOURCES.find((item) => item.id === 'sixth-tone');
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title>New museum exhibition opens in Shanghai</title><link>https://www.sixthtone.com/news/1</link><description>Culture and art exhibition.</description><pubDate>Thu, 11 Sep 2026 09:00:00 GMT</pubDate></item>
    <item><title>Industrial output rises</title><link>https://www.sixthtone.com/news/2</link><description>Factory manufacturing figures.</description><pubDate>Thu, 11 Sep 2026 09:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const items = await discoverFromFeedXml(xml, source);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://www.sixthtone.com/news/1');
});

test('Readability kısa kaldığında JSON-LD haber gövdesini kullanır', () => {
  const longArticle = Array.from({ length: 7 }, (_, index) => `This is verified culture reporting sentence number ${index + 1} with enough detail for extraction.`).join(' ');
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', articleBody: longArticle })}</script></head><body><p>Short teaser.</p></body></html>`;
  const result = extractBestArticleTextFromHtml(html, 'https://example.com/story');
  assert.match(result, /verified culture reporting sentence number 7/i);
});
