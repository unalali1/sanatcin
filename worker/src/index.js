import { config, validateConfig } from './config.js';
import { mapLimit } from './concurrency.js';
import { discover, extractArticle, sourceHash } from './fetch.js';
import { log } from './logger.js';
import { scoreCandidate } from './score.js';
import { rerankCandidates } from './rank.js';
import { createRunBudget } from './run-budget.js';
import { CATEGORIES, SOURCES, SOURCE_SET_VERSION } from './sources.js';
import { translateArticle } from './translate.js';
import { assertNoSimilarPublishedTitle, knownHashes, prepareFeaturedImage, publishArticle } from './wordpress.js';

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

function rejectionReason(error) {
  const message = String(error?.message ?? error);
  if (/tarih|Eski makale/i.test(message)) return 'date';
  if (/olgu|Editoryal|Çeviri|Türkçe|başlık|spot/i.test(message)) return 'editorial';
  if (/görsel|image|HTTP 403|çözünürlük|oranı/i.test(message)) return 'image';
  if (/benzer haber|known|daha önce/i.test(message)) return 'duplicate';
  if (/HTTP|fetch|abort|timeout|Makale gövdesi|site navigasyonu/i.test(message)) return 'source';
  return 'other';
}

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

async function run() {
  validateConfig();
  const budget = createRunBudget({
    maxAttemptsPerCategory: config.maxAttemptsPerCategory,
    maxRunMinutes: config.maxRunMinutes
  });
  const runController = new AbortController();
  const runDeadlineTimer = setTimeout(() => runController.abort(), budget.remainingMs());
  runDeadlineTimer.unref();
  log('info', 'Günlük SanatÇin taraması başladı', {
    sourceSet: SOURCE_SET_VERSION,
    sources: SOURCES.length,
    enabledSources: SOURCES.filter((source) => source.enabled).length,
    status: config.publishStatus,
    dryRun: config.dryRun,
    maxAttemptsPerCategory: config.maxAttemptsPerCategory,
    maxRunMinutes: config.maxRunMinutes
  });

  const sourceStats = Object.fromEntries(SOURCES.filter((source) => source.enabled).map((source) => [source.id, { discovered: 0, attempted: 0, published: 0, rejected: 0 }]));
  const rejectedReasons = {};
  const discovered = await mapLimit(SOURCES.filter((source) => source.enabled), config.discoveryConcurrency, async (source) => {
    try {
      const items = await discover(source);
      sourceStats[source.id].discovered = items.length;
      log('info', 'Kaynak tarandı', { source: source.id, candidates: items.length });
      return items;
    } catch (error) {
      sourceStats[source.id].error = error.message;
      log('error', 'Kaynak taranamadı', { source: source.id, error: error.message });
      return [];
    }
  });

  const cutoff = Date.now() - config.fallbackLookbackDays * 24 * 60 * 60 * 1000;
  const futureLimit = Date.now() + 6 * 60 * 60 * 1000;
  const candidates = uniqueCandidates(discovered.flat())
    .filter((item) => !item.publishedAt || (new Date(item.publishedAt).getTime() >= cutoff && new Date(item.publishedAt).getTime() <= futureLimit))
    .map((item) => scoreCandidate(item));
  const known = new Set(await knownHashes(candidates.map((item) => sourceHash(item.url))));
  const newCandidates = candidates.filter((item) => !known.has(sourceHash(item.url)));
  let ranked;
  try {
    ranked = await rerankCandidates(newCandidates, { signal: runController.signal });
  } catch (error) {
    ranked = [];
    log('error', 'Yapay zekâ puanlaması başarısız; güvenlik gereği bu çalışmada yayın yapılmayacak', { error: error.message });
  }
  const queues = Object.fromEntries(CATEGORIES.map(({ slug }) => [slug, ranked.filter((item) => item.eligible !== false && item.category === slug).sort((a, b) => b.score - a.score)]));
  log('info', 'Aday seçimi tamamlandı', {
    discovered: candidates.length,
    newCandidates: newCandidates.length,
    queues: Object.fromEntries(Object.entries(queues).map(([key, value]) => [key, value.length]))
  });

  const results = [];
  let timeLimitReached = budget.isExpired() || runController.signal.aborted;
  categoryLoop: for (const { slug } of CATEGORIES) {
    if (timeLimitReached) break;
    if (results.length >= config.maxDailyTotal) break;
    let categoryPublished = 0;
    for (const candidate of queues[slug]) {
      if (categoryPublished >= config.maxPerCategory || results.length >= config.maxDailyTotal) break;
      if (!budget.canAttempt(slug)) {
        if (budget.isExpired()) {
          timeLimitReached = true;
          log('warn', 'Toplam çalışma süresi sınırına ulaşıldı; kalan adaylar işlenmeyecek', {
            maxRunMinutes: config.maxRunMinutes,
            category: slug,
            processed: results.length
          });
          break categoryLoop;
        }
        log('warn', 'Kategori aday deneme sınırına ulaştı; kalan adaylar işlenmeyecek', {
          category: slug,
          attempts: budget.attemptsFor(slug),
          limit: config.maxAttemptsPerCategory
        });
        break;
      }
      const attempt = budget.noteAttempt(slug);
      sourceStats[candidate.source.id].attempted += 1;
      try {
        const article = await extractArticle(candidate);
        if (budget.isExpired()) throw new Error('Toplam çalışma süresi sınırına ulaşıldı.');
        if (article.publishedAt && new Date(article.publishedAt).getTime() < cutoff) {
          log('info', 'Eski makale atlandı', { source: candidate.source.id, url: candidate.url, publishedAt: article.publishedAt });
          continue;
        }
        if (config.requirePublishedDate && !article.publishedAt) {
          log('info', 'Yayın tarihi doğrulanamayan makale atlandı', { source: candidate.source.id, url: candidate.url });
          continue;
        }
        const translated = await translateArticle({ ...article, originalTitle: article.title }, { signal: runController.signal });
        await assertNoSimilarPublishedTitle(translated.title, { signal: runController.signal });
        const image = await prepareFeaturedImage(translated, { signal: runController.signal });
        const post = await publishArticle(translated, image, { signal: runController.signal });
        results.push({ source: candidate.source.id, category: candidate.category, score: candidate.score, scoreReason: candidate.scoreReason, postId: post.id, link: post.link, hasImage: true, imageOrigin: image.origin, mode: config.dryRun ? 'dry-run' : config.publishStatus });
        categoryPublished += 1;
        sourceStats[candidate.source.id].published += 1;
        log('info', config.dryRun ? 'Haber simülasyonu tamamlandı' : config.publishStatus === 'draft' ? 'Haber taslak olarak kaydedildi' : 'Haber yayımlandı', results.at(-1));
      } catch (error) {
        if (runController.signal.aborted || budget.isExpired()) {
          timeLimitReached = true;
          log('warn', 'Toplam çalışma süresi sınırına ulaşıldı; etkin aday iptal edildi', {
            maxRunMinutes: config.maxRunMinutes,
            category: slug,
            attempt,
            source: candidate.source.id,
            url: candidate.url
          });
          break categoryLoop;
        }
        sourceStats[candidate.source.id].rejected += 1;
        increment(rejectedReasons, rejectionReason(error));
        log('error', 'Haber işlenemedi; sıradaki aday denenecek', { source: candidate.source.id, url: candidate.url, error: error.message });
      }
    }
    if (categoryPublished === 0) log('warn', 'Kategori için yayımlanabilir yeni haber bulunamadı', { category: slug });
  }

  if (results.length < config.minDailyTarget) {
    log('warn', 'Günlük asgari yayın hedefinin altında kalındı', { target: config.minDailyTarget, processed: results.length });
  }
  log('info', 'Günlük SanatÇin taraması tamamlandı', {
    processed: results.length,
    target: `${config.minDailyTarget}-${config.maxDailyTotal}`,
    timeLimitReached,
    elapsedMinutes: Math.round((Date.now() - budget.startedAt) / 6000) / 10,
    rejectedReasons,
    sourceStats,
    results
  });
  if (results.length === 0) process.exitCode = 2;
}

run().catch((error) => {
  log('fatal', 'İşleyici durdu', { error: error.stack ?? error.message });
  process.exitCode = 1;
});
