import { config, validateConfig } from './config.js';
import { mapLimit } from './concurrency.js';
import { discover, extractArticle, sourceHash } from './fetch.js';
import { log } from './logger.js';
import { scoreCandidate } from './score.js';
import { rerankCandidates } from './rank.js';
import { CATEGORIES, SOURCES } from './sources.js';
import { translateArticle } from './translate.js';
import { knownHashes, publishArticle } from './wordpress.js';

function uniqueCandidates(items) {
  const urls = new Set();
  const titles = new Set();
  return items.filter((item) => {
    const normalizedTitle = item.title.toLowerCase().replace(/\s+/g, '');
    if (urls.has(item.url) || titles.has(normalizedTitle)) return false;
    urls.add(item.url);
    titles.add(normalizedTitle);
    return true;
  });
}

async function run() {
  validateConfig();
  log('info', 'Günlük SanatÇin taraması başladı', { sources: SOURCES.length, status: config.publishStatus, dryRun: config.dryRun });

  const discovered = await mapLimit(SOURCES.filter((source) => source.enabled), config.discoveryConcurrency, async (source) => {
    try {
      const items = await discover(source);
      log('info', 'Kaynak tarandı', { source: source.id, candidates: items.length });
      return items;
    } catch (error) {
      log('error', 'Kaynak taranamadı', { source: source.id, error: error.message });
      return [];
    }
  });

  const cutoff = Date.now() - config.fallbackLookbackDays * 24 * 60 * 60 * 1000;
  const candidates = uniqueCandidates(discovered.flat())
    .filter((item) => !item.publishedAt || new Date(item.publishedAt).getTime() >= cutoff)
    .map((item) => scoreCandidate(item));
  const known = new Set(await knownHashes(candidates.map((item) => sourceHash(item.url))));
  const newCandidates = candidates.filter((item) => !known.has(sourceHash(item.url)));
  let ranked;
  try {
    ranked = await rerankCandidates(newCandidates);
  } catch (error) {
    ranked = newCandidates;
    log('error', 'Yapay zekâ puanlaması başarısız; deterministik puan kullanılıyor', { error: error.message });
  }
  const queues = Object.fromEntries(CATEGORIES.map(({ slug }) => [slug, ranked.filter((item) => item.category === slug).sort((a, b) => b.score - a.score)]));
  log('info', 'Aday seçimi tamamlandı', {
    discovered: candidates.length,
    newCandidates: newCandidates.length,
    queues: Object.fromEntries(Object.entries(queues).map(([key, value]) => [key, value.length]))
  });

  const results = [];
  for (const { slug } of CATEGORIES) {
    let categoryPublished = 0;
    for (const candidate of queues[slug]) {
      if (categoryPublished >= config.maxPerCategory) break;
      try {
        const article = await extractArticle(candidate);
        if (article.publishedAt && new Date(article.publishedAt).getTime() < cutoff) {
          log('info', 'Eski makale atlandı', { source: candidate.source.id, url: candidate.url, publishedAt: article.publishedAt });
          continue;
        }
        const translated = await translateArticle({ ...article, originalTitle: article.title });
        const post = await publishArticle(translated);
        results.push({ source: candidate.source.id, category: candidate.category, score: candidate.score, scoreReason: candidate.scoreReason, postId: post.id, link: post.link });
        categoryPublished += 1;
        log('info', 'Haber yayımlandı', results.at(-1));
      } catch (error) {
        log('error', 'Haber işlenemedi; sıradaki aday denenecek', { source: candidate.source.id, url: candidate.url, error: error.message });
      }
    }
    if (categoryPublished === 0) log('error', 'Kategori için yayımlanabilir yeni haber bulunamadı', { category: slug });
  }

  log('info', 'Günlük SanatÇin taraması tamamlandı', { published: results.length, results });
  if (results.length === 0) process.exitCode = 2;
}

run().catch((error) => {
  log('fatal', 'İşleyici durdu', { error: error.stack ?? error.message });
  process.exitCode = 1;
});
