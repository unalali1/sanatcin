import { SOURCES } from '../src/sources.js';
import { discover, extractArticle } from '../src/fetch.js';

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
