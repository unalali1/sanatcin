import test from 'node:test';
import assert from 'node:assert/strict';
import { challengePage, dateFromText, dateFromUrl, discoverFromFeedXml, discoverFromHtml, extractBestArticleTextFromHtml, normalizeUrl } from '../src/fetch.js';
import { SOURCES, SOURCE_SET_VERSION } from '../src/sources.js';

test('Excel kaynak havuzu eksiksiz ve eski havuzdan bağımsızdır', () => {
  assert.equal(SOURCE_SET_VERSION, '2026-10-12-thepaper-01');
  assert.equal(SOURCES.length, 23);
  assert.equal(SOURCES.filter((source) => source.enabled).length, 20);
  assert.equal(SOURCES.filter((source) => source.mode === 'rss').length, 5);
  assert.equal(SOURCES.find((source) => source.id === 'ocula-magazine')?.enabled, false);
  assert.equal(SOURCES.find((source) => source.id === 'smartshanghai-exhibitions')?.enabled, false);
  assert.equal(SOURCES.find((source) => source.id === 'smartshanghai-stage')?.enabled, false);
  assert.equal(SOURCES.find((source) => source.id === 'china-org-movies')?.defaultCategory, 'sinema');
  assert.equal(SOURCES.find((source) => source.id === 'china-daily-film-tv')?.defaultCategory, 'sinema');
  assert.equal(SOURCES.find((source) => source.id === 'china-daily-film-tv')?.publisherGroup, 'china-daily-network');
  assert.equal(SOURCES.find((source) => source.id === 'china-org-style')?.defaultCategory, 'moda-tasarim');
  assert.equal(SOURCES.some((source) => source.id === 'dao-fashion-retail'), false);
  assert.equal(SOURCES.some((source) => source.id === 'cns-exhibitions'), false);
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
  assert.equal(dateFromUrl('https://www.china.cn/culture/2026-09/10/content_118688751.shtml'), '2026-09-09T16:00:00.000Z');
});

test('İngilizce yazılmış yayın tarihini haber sayfasından çıkarır', () => {
  assert.equal(dateFromText('By Hayley Zhao September 25, 2026 Arts Festival'), '2026-09-24T16:00:00.000Z');
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


test('China.org.cn film ve moda sayfaları yalnız tarihli kültür haberlerini aday yapar', () => {
  const movieSource = SOURCES.find((item) => item.id === 'china-org-movies');
  const styleSource = SOURCES.find((item) => item.id === 'china-org-style');
  const movieHtml = `
    <main><article><a href="/culture/2026-09/10/content_118688751.shtml">Chinese film premiere opens in Australia</a><p>A new Chinese film premiere and cinema release.</p></article></main>`;
  const styleHtml = `
    <main><article><a href="/culture/2026-09/11/content_118688999.shtml">2026 China Fashion Week concludes in Beijing</a><p>Designers presented new collections on the runway.</p></article></main>`;
  const movieItems = discoverFromHtml(movieHtml, movieSource);
  const styleItems = discoverFromHtml(styleHtml, styleSource);
  assert.equal(movieItems.length, 1);
  assert.equal(styleItems.length, 1);
  assert.equal(movieItems[0].publishedAt, '2026-09-09T16:00:00.000Z');
  assert.equal(styleItems[0].publishedAt, '2026-09-10T16:00:00.000Z');
});

test('Readability kısa kaldığında JSON-LD haber gövdesini kullanır', () => {
  const longArticle = Array.from({ length: 7 }, (_, index) => `This is verified culture reporting sentence number ${index + 1} with enough detail for extraction.`).join(' ');
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', articleBody: longArticle })}</script></head><body><p>Short teaser.</p></body></html>`;
  const result = extractBestArticleTextFromHtml(html, 'https://example.com/story');
  assert.match(result, /verified culture reporting sentence number 7/i);
});


test('The Paper arts desks share one publisher cap and use only stable editorial sections', () => {
  const desks = SOURCES.filter((source) => source.id.startsWith('thepaper-'));
  assert.equal(desks.length, 5);
  assert.equal(new Set(desks.map((source) => source.url)).size, 5);
  assert.deepEqual(new Set(desks.map((source) => source.publisherGroup)), new Set(['thepaper']));
  assert.ok(desks.every((source) => source.enabled && source.mode === 'html'));
  assert.ok(desks.every((source) => source.url.startsWith('https://m.thepaper.cn/list_')));
  assert.ok(desks.every((source) => source.pathPattern.test('/newsDetail_forward_34212822')));
  assert.ok(desks.every((source) => !source.pathPattern.test('/newsDetail_forward_wrong')));
  assert.ok(!desks.some((source) => source.url === 'https://www.thepaper.cn/'));
  assert.equal(desks.find((source) => source.id === 'thepaper-cinema').defaultCategory, 'sinema');
  assert.equal(desks.find((source) => source.id === 'thepaper-fashion-design').defaultCategory, 'moda-tasarim');
});

test('The Paper mobile lists yield actual article urls, not category/navigation anchors', () => {
  const desk = SOURCES.find((source) => source.id === 'thepaper-art-review');
  const html = `<main><div class="news_li">
    <a href="/newsDetail_forward_34212822"><h3>上海艺术馆举办中国现代绘画专题展</h3></a>
    <p>展览呈现当代绘画与传统书法的新对话</p></div>
    <a href="/list_25448">有戏栏目</a>
    <a href="https://othersite.example/newsDetail_forward_34212823">external</a>
    <a href="/newsDetail_forward_invalid">invalid id</a>
  </main>`;
  const found = discoverFromHtml(html, desk);
  assert.equal(found.length, 1);
  assert.equal(found[0].title, '上海艺术馆举办中国现代绘画专题展');
  assert.equal(found[0].url, 'https://m.thepaper.cn/newsDetail_forward_34212822');
  assert.equal(found[0].source.publisherGroup, 'thepaper');
});

test('The Paper film section routes to cinema; other desks keep their category', () => {
  const cinema = SOURCES.find((source) => source.id === 'thepaper-cinema');
  const culture = SOURCES.find((source) => source.id === 'thepaper-culture');
  const html = '<main><a href="/newsDetail_forward_34218114">《神探之痕迹》满意度领跑国庆档</a></main>';
  assert.equal(discoverFromHtml(html, cinema)[0].source.defaultCategory, 'sinema');
  assert.equal(discoverFromHtml(html, culture)[0].source.defaultCategory, 'kultur-sanat');
});

test('The Paper lifestyle desk excludes business news but retains fashion and design', () => {
  const fashion = SOURCES.find((source) => source.id === 'thepaper-fashion-design');
  const html = `<main><article><a href="/newsDetail_forward_34200101">2026巴黎时装周揭幕，中国设计师作品亮相</a></article>
    <article><a href="/newsDetail_forward_34200102">人工智能芯片供应链峰会举行</a></article>
    <article><a href="/newsDetail_forward_34200103">上海青年建筑设计展览开幕</a></article></main>`;
  assert.deepEqual(discoverFromHtml(html, fashion).map((item) => item.url.split('_').at(-1)), ['34200101', '34200103']);
});

test('The Paper article dates can be parsed from Chinese page text in Beijing time', () => {
  assert.equal(dateFromText('澎湃新闻记者 王诤 2026-10-09 17:09 来源：澎湃新闻'), '2026-10-09T09:09:00.000Z');
});

test('passive verification SDK does not block editorial HTML but an active human check does', () => {
  const editorial = '<html><head><script>window.AliyunCaptchaConfig = { region: "cn" };</script><script src="/captcha/sdk.js"></script></head><body><a href="/newsDetail_forward_34227659">上海举办新艺术展</a></body></html>';
  const challenge = '<html><body><div id="captcha-challenge">Security verification: verify you are human</div></body></html>';
  assert.equal(challengePage(editorial), false);
  assert.equal(challengePage(challenge), true);
  assert.equal(challengePage('<html><body><div id="cf-chl-widget"></div></body></html>'), true);
});
