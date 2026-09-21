import { readFileSync } from 'node:fs';
import { config, validateConfig } from './config.js';
import { mapLimit } from './concurrency.js';
import { discover, extractArticle, sourceHash } from './fetch.js';
import { classifyError } from './errors.js';
import { flushLogs, log, setLogContext } from './logger.js';
import { scoreCandidate } from './score.js';
import { diversifyBySource, diversifyByTopic, rerankCandidates, sourceCrowdingPenalty } from './rank.js';
import { createRunBudget } from './run-budget.js';
import { attachSecondaryImage } from './secondary-image.js';
import { CATEGORIES, SOURCES, SOURCE_SET_VERSION } from './sources.js';
import { translateArticle } from './translate.js';
import {
  assertNoSimilarPublishedCandidate,
  assertNoSimilarPublishedTitle,
  knownHashes,
  preflightFeaturedImage,
  prepareFeaturedImage,
  publishArticle,
  syncSiteContent
} from './wordpress.js';

const WORKER_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? 'unknown';

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

function publishedScoreStats(results) {
  if (!results.length) return { min: null, max: null, average: null };
  const scores = results.map((item) => Number(item.score) || 0);
  return {
    min: Math.min(...scores),
    max: Math.max(...scores),
    average: Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10
  };
}

function distribution(items, key) {
  return items.reduce((record, item) => {
    increment(record, item[key]);
    return record;
  }, {});
}

function candidateForRound(queue, sourceUseCounts, {
  fallbackActive,
  hardMinimum,
  preferredMinimum
}) {
  let bestIndex = -1;
  let bestEffectiveScore = -Infinity;
  let bestPenalty = 0;
  let hasFallbackCandidate = false;

  for (let index = 0; index < queue.length; index += 1) {
    const candidate = queue[index];
    if (candidate.score < hardMinimum) continue;
    hasFallbackCandidate = true;
    const previousCount = sourceUseCounts[candidate.source?.id] ?? 0;
    const sourcePenalty = sourceCrowdingPenalty(previousCount);
    const effectiveScore = Math.max(0, Math.round((candidate.score - sourcePenalty) * 10) / 10);
    const qualifies = fallbackActive ? true : effectiveScore >= preferredMinimum;
    if (!qualifies) continue;
    if (effectiveScore > bestEffectiveScore) {
      bestIndex = index;
      bestEffectiveScore = effectiveScore;
      bestPenalty = sourcePenalty;
    }
  }

  if (bestIndex < 0) return { candidate: null, hasFallbackCandidate };
  const candidate = queue.splice(bestIndex, 1)[0];
  return {
    candidate: {
      ...candidate,
      effectiveScore: bestEffectiveScore,
      sourcePenalty: bestPenalty
    },
    hasFallbackCandidate
  };
}

async function run() {
  validateConfig();
  const runId = `sanatcin-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${process.pid}`;
  setLogContext({ runId, workerVersion: WORKER_VERSION });

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
    minPublishScore: config.minPublishScore,
    secondSlotMinScore: config.secondSlotMinScore,
    preferredPublishScore: config.preferredPublishScore,
    preferredSecondSlotScore: config.preferredSecondSlotScore,
    adaptiveFallbackRound: config.adaptiveFallbackRound,
    minEditorialFit: config.minEditorialFit,
    maxAiCandidates: config.maxAiCandidates,
    rescueAiCandidates: config.rescueAiCandidates,
    aiBatchSize: config.aiBatchSize,
    aiRerankConcurrency: config.aiRerankConcurrency,
    articleConcurrency: config.articleConcurrency,
    selectionModel: config.openaiSelectionModel,
    factModel: config.openaiFactModel,
    editorModel: config.openaiEditorModel
  });

  const sourceStats = Object.fromEntries(SOURCES.filter((source) => source.enabled).map((source) => [source.id, { discovered: 0, attempted: 0, published: 0, rejected: 0 }]));
  const rejectedReasons = {};
  const selectionStats = {
    lowScoreSkipped: 0,
    preferredDeferred: 0,
    topicPenalized: 0,
    sourcePenalized: 0,
    adaptiveFallbackAttempts: 0
  };
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
  selectionStats.topicPenalized = Object.values(queues).flat().filter((item) => item.topicPenalty > 0).length;
  log('info', 'Aday seçimi tamamlandı', {
    discovered: candidates.length,
    newCandidates: newCandidates.length,
    aiEvaluated: ranked.length,
    queues: Object.fromEntries(Object.entries(queues).map(([key, value]) => [key, value.length])),
    fitDistribution: Object.fromEntries(CATEGORIES.map(({ slug }) => [
      slug,
      queues[slug].map((item) => item.editorialFit).filter((value) => Number.isFinite(value))
    ])),
    topicPenalized: selectionStats.topicPenalized
  });

  const results = [];
  const categoryPublished = Object.fromEntries(CATEGORIES.map(({ slug }) => [slug, 0]));
  let timeLimitReached = budget.isExpired() || runController.signal.aborted;
  for (let round = 1; round <= config.maxAttemptsPerCategory; round += 1) {
    if (timeLimitReached || results.length >= config.maxDailyTotal) break;
    if (budget.isExpired() || runController.signal.aborted) {
      timeLimitReached = true;
      break;
    }

    const fallbackActive = round >= config.adaptiveFallbackRound && results.length < config.minDailyTarget;
    const remainingSlots = config.maxDailyTotal - results.length;
    const attempts = [];
    const plannedSourceCounts = distribution(results, 'source');

    for (const { slug } of CATEGORIES) {
      if (attempts.length >= remainingSlots) break;
      if (categoryPublished[slug] >= config.maxPerCategory || !budget.canAttempt(slug)) continue;

      const firstSlot = categoryPublished[slug] === 0;
      const hardMinimum = firstSlot
        ? config.minPublishScore
        : Math.max(config.minPublishScore, config.secondSlotMinScore);
      const preferredMinimum = firstSlot
        ? Math.max(hardMinimum, config.preferredPublishScore)
        : Math.max(hardMinimum, config.preferredSecondSlotScore);
      const selected = candidateForRound(queues[slug], plannedSourceCounts, {
        fallbackActive,
        hardMinimum,
        preferredMinimum
      });

      if (!selected.candidate) {
        if (!fallbackActive && selected.hasFallbackCandidate) {
          selectionStats.preferredDeferred += 1;
          log('info', 'Kategori adayı güvenli tabanın üzerinde ancak tercih eşiğinin altında; fallback turuna ertelendi', {
            category: slug,
            round,
            preferredMinimum,
            hardMinimum
          });
        }
        continue;
      }

      const candidate = selected.candidate;
      if (candidate.sourcePenalty > 0) selectionStats.sourcePenalized += 1;
      if (fallbackActive) selectionStats.adaptiveFallbackAttempts += 1;
      increment(plannedSourceCounts, candidate.source.id);
      attempts.push({ slug, candidate, attempt: budget.noteAttempt(slug), fallbackActive });
    }

    if (!attempts.length) {
      const shouldReachFallback = results.length < config.minDailyTarget && round < config.adaptiveFallbackRound;
      if (shouldReachFallback) continue;
      break;
    }

    log('info', 'Kategori dengeli aday turu başladı', {
      round,
      fallbackActive,
      candidates: attempts.map(({ slug, candidate }) => ({
        category: slug,
        source: candidate.source.id,
        score: candidate.score,
        effectiveScore: candidate.effectiveScore,
        editorialFit: candidate.editorialFit,
        sourcePenalty: candidate.sourcePenalty
      }))
    });
    const outcomes = await mapLimit(attempts, config.articleConcurrency, async ({ slug, candidate, attempt, fallbackActive: usedFallback }) => {
      sourceStats[candidate.source.id].attempted += 1;
      log('info', 'Haber adayı işleniyor', {
        round,
        category: slug,
        attempt,
        source: candidate.source.id,
        score: candidate.score,
        effectiveScore: candidate.effectiveScore,
        editorialFit: candidate.editorialFit,
        institutionalEvent: candidate.institutionalEvent ?? false,
        commercialDominant: candidate.commercialDominant ?? false,
        sourceBoost: candidate.sourceBoost ?? 0,
        sourcePenalty: candidate.sourcePenalty ?? 0,
        topicPenalty: candidate.topicPenalty ?? 0,
        fallback: usedFallback,
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
        await assertNoSimilarPublishedCandidate(article.title, { signal: runController.signal });
        const [translated, imagePreflight] = await Promise.all([
          translateArticle({ ...article, originalTitle: article.title }, { signal: runController.signal }),
          preflightFeaturedImage(article, { signal: runController.signal })
        ]);
        await assertNoSimilarPublishedTitle(translated.title, { signal: runController.signal });
        const image = await prepareFeaturedImage(translated, { signal: runController.signal, preflight: imagePreflight });
        const publishable = { ...translated, score: candidate.score };
        const post = await publishArticle(publishable, image, { signal: runController.signal });
        let secondaryImage = { attached: false, reason: config.dryRun ? 'dry-run' : 'not-attempted' };
        if (!config.dryRun) {
          try {
            secondaryImage = await attachSecondaryImage(publishable, image, post, { signal: runController.signal });
          } catch (secondaryError) {
            log('warn', 'İkinci görsel hazırlanamadı; haber tek görselle korunacak', {
              source: candidate.source.id,
              postId: post.id,
              url: candidate.url,
              error: String(secondaryError?.message ?? secondaryError).slice(0, 500)
            });
          }
        }
        const result = {
          source: candidate.source.id,
          category: candidate.category,
          score: candidate.score,
          effectiveScore: candidate.effectiveScore,
          editorialFit: candidate.editorialFit,
          scoreReason: candidate.scoreReason,
          sourceBoost: candidate.sourceBoost ?? 0,
          sourcePenalty: candidate.sourcePenalty ?? 0,
          topicPenalty: candidate.topicPenalty ?? 0,
          fallback: usedFallback,
          postId: post.id,
          link: post.link,
          hasImage: true,
          imageOrigin: image.origin,
          imageScore: image.visualScore ?? null,
          imageScene: image.scene ?? null,
          hasSecondaryImage: secondaryImage.attached === true,
          secondaryImageScore: secondaryImage.secondaryScore ?? null,
          secondaryImageSimilarity: secondaryImage.similarityScore ?? null,
          secondaryImageScene: secondaryImage.scene ?? null,
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

  for (const queue of Object.values(queues)) {
    selectionStats.lowScoreSkipped += queue.filter((candidate) => candidate.score < config.minPublishScore).length;
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
        candidatesRemaining: queues[slug].length,
        topRemainingScore: queues[slug].length ? Math.max(...queues[slug].map((candidate) => candidate.score)) : null,
        topRemainingEditorialFit: queues[slug].length ? Math.max(...queues[slug].map((candidate) => candidate.editorialFit ?? 0)) : null,
        minimumPublishScore: config.minPublishScore,
        preferredPublishScore: config.preferredPublishScore
      });
    }
  }

  if (results.length < config.minDailyTarget) {
    log('warn', 'Günlük asgari yayın hedefinin altında kalındı', { target: config.minDailyTarget, processed: results.length });
  }

  const targetReached = results.length >= config.minDailyTarget;
  const hadRejections = Object.keys(rejectedReasons).length > 0;
  const runStatus = results.length === 0
    ? 'failed'
    : !targetReached || timeLimitReached
      ? 'partial'
      : hadRejections
        ? 'success_with_rejections'
        : 'success';

  log('info', 'Günlük SanatÇin taraması tamamlandı', {
    runStatus,
    processed: results.length,
    target: `${config.minDailyTarget}-${config.maxDailyTotal}`,
    timeLimitReached,
    elapsedMinutes: Math.round((Date.now() - budget.startedAt) / 6000) / 10,
    categoryPublished,
    sourcePublished: distribution(results, 'source'),
    scoreStats: publishedScoreStats(results),
    selectionStats,
    rejectedReasons,
    sourceStats,
    results
  });
  if (results.length === 0) process.exitCode = 2;
}

async function main() {
  let exitCode = 0;
  try {
    await run();
    exitCode = process.exitCode ?? 0;
  } catch (error) {
    log('fatal', 'İşleyici durdu', { errorCode: classifyError(error).code, error: error.stack ?? error.message });
    exitCode = 1;
  } finally {
    await flushLogs();
    await new Promise((resolve) => process.stdout.write('', resolve));
  }
  process.exit(exitCode);
}

main();
