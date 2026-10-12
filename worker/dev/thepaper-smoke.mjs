import { SOURCES } from '../src/sources.js';
import { discover, extractArticle } from '../src/fetch.js';

// Diagnostic only: read public desktop/mobile variants without any CAPTCHA bypass.
for (const url of [
  'https://m.thepaper.cn/list_25455',
  'https://www.thepaper.cn/list_25455',
  'https://m.thepaper.cn/newsDetail_forward_34212822',
  'https://www.thepaper.cn/newsDetail_forward_34212822'
]) {
  try {
    const response = await fetch(url, { headers: { 'user-agent': 'SanatCinBot/1.0', accept: 'text/html' }, signal: AbortSignal.timeout(12000) });
    const html = await response.text();
    const challengeTerm = /(cf-chl-|cloudflare.{0,40}challenge|verify you are human|captcha)/i.exec(html);
    console.log(JSON.stringify({
      diagnosticUrl: url, status: response.status, finalUrl: response.url, bytes: html.length,
      links: (html.match(/newsDetail_forward_\\d+/g) || []).length,
      images: (html.match(/imgpai\\.thepaper\\.cn/g) || []).length,
      challengeTerm: challengeTerm ? html.slice(Math.max(0, challengeTerm.index - 24), challengeTerm.index + 80) : null,
      textPreview: html.slice(0, 150)
    }));
  } catch (error) {
    console.log(JSON.stringify({ diagnosticUrl: url, error: error.message }));
  }
}

const desks = SOURCES.filter((source) => source.id.startsWith('thepaper-'));
const results = await Promise.all(desks.map(async (source) => {
  try {
    const items = await discover(source);
    return { source: source.id, items, error: null };
  } catch (error) {
    return { source: source.id, items: [], error: error.message };
  }
}));
for (const row of results) {
  console.log(JSON.stringify({
    desk: row.source,
    articles: row.items.length,
    first: row.items[0]?.url ?? null,
    error: row.error
  }));
}

const suitable = results.find((row) => row.items.length > 0 && !row.error);
if (!suitable) throw new Error('The Paper: no verified live article listing; do not deploy.');

let verifiedArticle = null;
const checked = [];
for (const row of results.filter((value) => value.items.length > 0).slice(0, 3)) {
  try {
    const article = await extractArticle(row.items[0], { allowBrowser: false });
    verifiedArticle = { source: row.source, publishedAt: article.publishedAt, chars: article.text.length,
      images: article.sourceImageUrls.length, url: article.url };
    if (article.publishedAt && article.text.length >= 150 && article.sourceImageUrls.length > 0) break;
  } catch (error) {
    checked.push({ source: row.source, error: error.message });
  }
}
console.log(JSON.stringify({ verifiedArticle, failedSamples: checked }));
if (!verifiedArticle || !verifiedArticle.publishedAt || verifiedArticle.chars < 150 || verifiedArticle.images < 1) {
  throw new Error('The Paper: live article text/date/image extraction not verified.');
}
