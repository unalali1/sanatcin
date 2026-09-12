import { config, validateConfig } from './config.js';
import { mapLimit } from './concurrency.js';
import { discover, extractArticle, sourceHash } from './fetch.js';
import { classifyError } from './errors.js';
import { log, setLogContext } from './logger.js';
import { scoreCandidate } from './score.js';
import { diversifyBySource, diversifyByTopic, rerankCandidates } from './rank.js';
import { createRunBudget } from './run-budget.js';
import { CATEGORIES, SOURCES, SOURCE_SET_VERSION } from './sources.js';
import { translateArticle } from './translate.js';
import { assertNoSimilarPublishedTitle, knownHashes, prepareFeaturedImage, publishArticle, syncSiteContent } from './wordpress.js';

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

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

async function run() {
  validateConfig();
  const runId = `sanatcin-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${process.pid}`;
  setLogContext({ runId, workerVersion: '0.7.0' });

  if (config.syncSitePages) {
    log('info', 'Site kurumsal içerik eşitlemesi başladı', { maintenanceOnly: config.maintenanceOnly });
    const syncResult = await syncSiteContent();
    log('info', 'Site kurumsal içerik eşitlemesi tamamlandı', syncResult);
  }
  if (config.maintenanceOnly) {
    log('info', 'Bakım çalışması tamamlandı; haber taraması başlatılmadı');
    return;
  }

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
    maxRunMinutes: config.maxRunMinutes,
    maxAiCandidates: config.maxAiCandidates,
    aiBatchSize: config.aiBatchSize,
    aiRerankConcurrency: config.aiRerankConcurrency,
    articleConcurrency: config.articleConcurrency,
    selectionModel: config.openaiSelectionModel,
    factModel: config.openaiFactModel,
    editorModel: config.openaiEditorModel
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
      log('error', 'Kaynak taranamadı', { source: source.id, errorCode: classifyError(error).code, error: error.message });
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
    ranked = [...newCandidates].sort((left, right) => right.score - left.score);
    log('warn', 'Yapay zekâ puanlaması başarısız; deterministik puanlarla devam edilecek', {
      errorCode: 'AI_RANKING_FALLBACK',
      error: error.message,
      candidates: ranked.length
    });
  }
  const queues = Object.fromEntries(CATEGORIES.map(({ slug }) => [
    slug,
    diversifyByTopic(diversifyBySource(ranked.filter((item) => item.eligible !== false && item.category === slug)))
  ]));
  log('info', 'Aday seçimi tamamlandı', {
    discovered: candidates.length,
    newCandidates: newCandidates.length,
    queues: Object.fromEntries(Object.entries(queues).map(([key, value]) => [key, value.length]))
  });

  const results = [];
  const categoryPublished = Object.fromEntries(CATEGORIES.map(({ slug }) => [slug, 0]));
  const queueOffsets = Object.fromEntries(CATEGORIES.map(({ slug }) => [slug, 0]));
  let timeLimitReached = budget.isExpired() || runController.signal.aborted;
  for (let round = 1; round <= config.maxAttemptsPerCategory; round += 1) {
    if (timeLimitReached || results.length >= config.maxDailyTotal) break;
    if (budget.isExpired() || runController.signal.aborted) {
      timeLimitReached = true;
      break;
    }

    const remainingSlots = config.maxDailyTotal - results.length;
    const attempts = [];
    for (const { slug } of CATEGORIES) {
      if (attempts.length >= remainingSlots) break;
      if (categoryPublished[slug] >= config.maxPerCategory || !budget.canAttempt(slug)) continue;
      const candidate = queues[slug][queueOffsets[slug]++];
      if (!candidate) continue;
      attempts.push({ slug, candidate, attempt: budget.noteAttempt(slug) });
    }
    if (!attempts.length) break;

    log('info', 'Kategori dengeli aday turu başladı', {
      round,
      candidates: attempts.map(({ slug, candidate }) => ({ category: slug, source: candidate.source.id }))
    });
    const outcomes = await mapLimit(attempts, config.articleConcurrency, async ({ slug, candidate, attempt }) => {
      sourceStats[candidate.source.id].attempted += 1;
      log('info', 'Haber adayı işleniyor', {
        round,
        category: slug,
        attempt,
        source: candidate.source.id,
        url: candidate.url
      });
      try {
        const article = await extractArticle(candidate);
        if (budget.isExpired()) throw new Error('Toplam çalışma süresi sınırına ulaşıldı.');
        if (article.publishedAt && new Date(article.publishedAt).getTime() < cutoff) {
          log('info', 'Eski makale atlandı', { source: candidate.source.id, url: candidate.url, publishedAt: article.publishedAt });
          return { slug, skipped: true };
        }
        if (config.requirePublishedDate && !article.publishedAt) {
          log('info', 'Yayın tarihi doğrulanamayan makale atlandı', { source: candidate.source.id, url: candidate.url });
          return { slug, skipped: true };
        }
        const translated = await translateArticle({ ...article, originalTitle: article.title }, { signal: runController.signal });
        await assertNoSimilarPublishedTitle(translated.title, { signal: runController.signal });
        const image = await prepareFeaturedImage(translated, { signal: runController.signal });
        const post = await publishArticle(translated, image, { signal: runController.signal });
        const result = {
          source: candidate.source.id,
          category: candidate.category,
          score: candidate.score,
          scoreReason: candidate.scoreReason,
          postId: post.id,
          link: post.link,
          hasImage: true,
          imageOrigin: image.origin,
          mode: config.dryRun ? 'dry-run' : config.publishStatus
        };
        sourceStats[candidate.source.id].published += 1;
        log('info', config.dryRun ? 'Haber simülasyonu tamamlandı' : config.publishStatus === 'draft' ? 'Haber taslak olarak kaydedildi' : 'Haber yayımlandı', result);
        return { slug, result };
      } catch (error) {
        const classified = classifyError(error);
        if (runController.signal.aborted || budget.isExpired()) {
          log('warn', 'Toplam çalışma süresi sınırına ulaşıldı; etkin aday iptal edildi', {
            errorCode: 'RUN_TIME_LIMIT',
            maxRunMinutes: config.maxRunMinutes,
            category: slug,
            attempt,
            source: candidate.source.id,
            url: candidate.url
          });
          return { slug, timedOut: true };
        }
        sourceStats[candidate.source.id].rejected += 1;
        increment(rejectedReasons, classified.group);
        log('error', 'Haber işlenemedi; sıradaki aday denenecek', {
          category: slug,
          source: candidate.source.id,
          url: candidate.url,
          errorCode: classified.code,
          error: error.message
        });
        return { slug, rejected: true };
      }
    });

    for (const outcome of outcomes) {
      if (outcome.timedOut) timeLimitReached = true;
      if (!outcome.result) continue;
      results.push(outcome.result);
      categoryPublished[outcome.slug] += 1;
    }
    if (timeLimitReached) break;
  }

  if (timeLimitReached) {
    log('warn', 'Toplam çalışma süresi sınırına ulaşıldı; kalan adaylar işlenmeyecek', {
      maxRunMinutes: config.maxRunMinutes,
      processed: results.length
    });
  }
  for (const { slug } of CATEGORIES) {
    if (categoryPublished[slug] === 0) {
      log('warn', 'Kategori için yayımlanabilir yeni haber bulunamadı', {
        category: slug,
        attempts: budget.attemptsFor(slug),
        candidates: queues[slug].length
      });
    }
  }

  if (results.length < config.minDailyTarget) {
    log('warn', 'Günlük asgari yayın hedefinin altında kalındı', { target: config.minDailyTarget, processed: results.length });
  }
  log('info', 'Günlük SanatÇin taraması tamamlandı', {
    runStatus: results.length === 0 ? 'failed' : Object.keys(rejectedReasons).length ? 'partial' : 'success',
    processed: results.length,
    target: `${config.minDailyTarget}-${config.maxDailyTotal}`,
    timeLimitReached,
    elapsedMinutes: Math.round((Date.now() - budget.startedAt) / 6000) / 10,
    categoryPublished,
    rejectedReasons,
    sourceStats,
    results
  });
  if (results.length === 0) process.exitCode = 2;
}

run().catch((error) => {
  log('fatal', 'İşleyici durdu', { errorCode: classifyError(error).code, error: error.stack ?? error.message });
  process.exitCode = 1;
});
