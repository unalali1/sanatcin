import { preflightCandidates } from './preflight.js';
import { candidateForRound } from './selection.js';
import { editorialCoverage } from './run-report.js';
import { readFileSync } from 'node:fs';
import { config, validateConfig } from './config.js';
import { mapLimit } from './concurrency.js';
import { discover, extractArticle, sourceHash } from './fetch.js';
import { classifyError } from './errors.js';
import { flushLogs, log, setLogContext } from './logger.js';
import { isFreshForCategory, scoreCandidate } from './score.js';
import { buildBalancedShortlist, diversifyBySource, diversifyByTopic, rerankCandidates } from './rank.js';
import { createRunBudget } from './run-budget.js';
import { attachSecondaryImage } from './secondary-image.js';
import { CATEGORIES, SOURCES, SOURCE_SET_VERSION } from './sources.js';
import { translateArticle } from './translate.js';
import {
  assertNoSimilarPublishedCandidate,
  assertNoSimilarPublishedTitle,
  knownHashes,
  loadFailedCandidateState,
  preflightFeaturedImage,
  prepareFeaturedImage,
  publishArticle,
  saveFailedCandidateState,
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
    maxPublisherGroupDaily: config.maxPublisherGroupDaily,
    cinemaAiReserve: config.cinemaAiReserve,
    editorialJudgeTimeoutMs: config.editorialJudgeTimeoutMs,
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
    adaptiveFallbackAttempts: 0,
    cachedFailedSkipped: 0
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
  const failedCandidateState = await loadFailedCandidateState({ signal: runController.signal });
  const failedCandidateMap = new Map(failedCandidateState.map((entry) => [entry.url, entry]));
  const newCandidates = candidates.filter((item) => {
    if (known.has(sourceHash(item.url))) return false;
    if (failedCandidateMap.has(item.url)) {
      selectionStats.cachedFailedSkipped += 1;
      return false;
    }
    return true;
  });
  if (selectionStats.cachedFailedSkipped > 0) {
    log('info', 'Yakın zamanda gövde çıkarımı başarısız olan adaylar geçici önbellekten atlandı', {
      skipped: selectionStats.cachedFailedSkipped,
      cacheHours: config.failedCandidateCacheHours
    });
  }
  const articleCache = new Map();
  let preparedCandidates = newCandidates;
  const prepareCandidates = async (pool) => {
    const preflight = await preflightCandidates(pool, buildBalancedShortlist(pool, 12), {
      extract: extractArticle, signal: runController.signal,
      concurrency: config.articleConcurrency, maxMs: Math.min(20_000, budget.remainingMs())
    });
    for (const [url, article] of preflight.articles) articleCache.set(url, article);
    for (const [url, { candidate }] of preflight.rejected) {
      failedCandidateMap.set(url, { url, failedAt: new Date().toISOString(), code: 'SOURCE_EXTRACTION' });
      const stats = sourceStats[candidate.source.id];
      stats.preflightRejected = (stats.preflightRejected ?? 0) + 1;
    }
    preparedCandidates = preflight.candidates;
    log('info', 'AI öncesi kaynak gövdesi kontrolü tamamlandı', {
      checked: preflight.checked, reusableBodies: articleCache.size,
      rejected: preflight.rejected.size, maxMs: 20_000
    });
    return preparedCandidates;
  };
  let ranked;
  try {
    ranked = await rerankCandidates(newCandidates, { signal: runController.signal, prepareCandidates });
  } catch (error) {
    ranked = [...preparedCandidates].sort((left, right) => right.score - left.score);
    log('warn', 'Yapay zekâ puanlaması başarısız; deterministik puanlarla devam edilecek', {
      errorCode: 'AI_RANKING_FALLBACK',
      error: error.message,
      candidates: ranked.length
    });
  }
  const queues = Object.fromEntries(CATEGORIES.map(({ slug }) => [
    slug,
    diversifyByTopic(diversifyBySource(ranked.filter((item) => item.eligible !== false && item.category === slug && isFreshForCategory(item))))
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
  const publishedCandidates = [];
  const categorySourceFailures = Object.fromEntries(CATEGORIES.map(({ slug }) => [slug, {}]));
  const categoryPublished = Object.fromEntries(CATEGORIES.map(({ slug }) => [slug, 0]));
  let timeLimitReached = budget.isExpired() || runController.signal.aborted;
  for (let round = 1; round <= config.maxAttemptsPerCategory * 2; round += 1) {
    if (timeLimitReached || results.length >= config.maxDailyTotal) break;
    if (budget.isExpired() || runController.signal.aborted) {
      timeLimitReached = true;
      break;
    }

    const fallbackActive = round >= config.adaptiveFallbackRound && results.length < config.minDailyTarget;
    const remainingSlots = config.maxDailyTotal - results.length;
    const attempts = [];
    const plannedSourceCounts = distribution(results, 'source');
    const plannedPublisherCounts = distribution(results, 'publisherGroup');
    const plannedCandidates = [...publishedCandidates];
    const batchSources = new Set();
    const unfilled = CATEGORIES.filter(({ slug }) => categoryPublished[slug] === 0 && budget.canAttempt(slug));
    const coveragePhase = unfilled.some(({ slug }) => queues[slug].some((candidate) => {
      if ((categorySourceFailures[slug][candidate.source?.id] ?? 0) >= 2) return false;
      const publisherGroup = candidate.source?.publisherGroup ?? candidate.source?.id;
      if (!fallbackActive && (plannedPublisherCounts[publisherGroup] ?? 0) >= config.maxPublisherGroupDaily) return false;
      const potentialRescue = candidate.score >= config.categoryRescuePublishScore
        && (candidate.editorialFit ?? 0) >= config.minEditorialFit
        && (candidate.source?.quality ?? 0) >= 8;
      return candidate.score >= config.minPublishScore || potentialRescue;
    }));

    for (const { slug } of CATEGORIES) {
      if (attempts.length >= remainingSlots) break;
      if (categoryPublished[slug] >= config.maxPerCategory || !budget.canAttempt(slug)) continue;
      if (coveragePhase && categoryPublished[slug] > 0) continue;

      const firstSlot = categoryPublished[slug] === 0;
      const rescueSlot = firstSlot && fallbackActive;
      const hardMinimum = rescueSlot
        ? config.categoryRescuePublishScore
        : firstSlot
          ? config.minPublishScore
        : Math.max(config.minPublishScore, config.secondSlotMinScore);
      const preferredMinimum = firstSlot
        ? Math.max(hardMinimum, config.preferredPublishScore)
        : Math.max(hardMinimum, config.preferredSecondSlotScore);
      const selected = candidateForRound(queues[slug], plannedSourceCounts, {
        publisherUseCounts: plannedPublisherCounts,
        sourceFailures: categorySourceFailures[slug],
        fallbackActive,
        hardMinimum,
        preferredMinimum,
        excludedSourceIds: batchSources,
        topicPortfolio: plannedCandidates,
        enforceTopicDiversity: results.length + attempts.length < 4,
        rescueBelowScore: rescueSlot ? config.minPublishScore : null,
        rescueMinimumFit: config.minEditorialFit,
        allowPublisherOverflow: fallbackActive && firstSlot
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
      increment(plannedPublisherCounts, candidate.publisherGroup ?? candidate.source?.publisherGroup ?? candidate.source.id);
      batchSources.add(candidate.source.id);
      plannedCandidates.push(candidate);
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
      coveragePhase,
      candidates: attempts.map(({ slug, candidate }) => ({
        category: slug,
        source: candidate.source.id,
        publisherGroup: candidate.publisherGroup ?? candidate.source?.publisherGroup ?? candidate.source.id,
        score: candidate.score,
        effectiveScore: candidate.effectiveScore,
        editorialFit: candidate.editorialFit,
        sourcePenalty: candidate.sourcePenalty
      }))
    });
    const outcomes = await mapLimit(attempts, config.articleConcurrency, async ({ slug, candidate, attempt, fallbackActive: usedFallback }) => {
      sourceStats[candidate.source.id].attempted += 1;
      const sourceCategories = sourceStats[candidate.source.id].categories ??= {};
      const categoryStats = sourceCategories[slug] ??= { attempted: 0, published: 0, rejected: 0 };
      categoryStats.attempted += 1;
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
        await assertNoSimilarPublishedCandidate(candidate.title, { signal: runController.signal });
        const article = { ...(articleCache.get(candidate.url) ?? await extractArticle(candidate, { signal: runController.signal })), category: slug };
        if (budget.isExpired()) throw new Error('Toplam çalışma süresi sınırına ulaşıldı.');
        if (!isFreshForCategory({ ...article, category: slug })) {
          log('info', 'Eski makale atlandı', { source: candidate.source.id, url: candidate.url, publishedAt: article.publishedAt });
          return { slug, skipped: true };
        }
        if (config.requirePublishedDate && !article.publishedAt) {
          log('info', 'Yayın tarihi doğrulanamayan makale atlandı', { source: candidate.source.id, url: candidate.url });
          return { slug, skipped: true };
        }
        if (article.title !== candidate.title) {
          await assertNoSimilarPublishedCandidate(article.title, { signal: runController.signal });
        }
        const [translated, imagePreflight] = await Promise.all([
          translateArticle({ ...article, originalTitle: article.title }, {
            signal: runController.signal,
            validateDraft: (draft) => assertNoSimilarPublishedTitle(draft.title, { signal: runController.signal })
          }),
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
          publisherGroup: candidate.publisherGroup ?? candidate.source?.publisherGroup ?? candidate.source.id,
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
          heroEligible: image.heroEligible === true,
          hasSecondaryImage: secondaryImage.attached === true,
          secondaryImageScore: secondaryImage.secondaryScore ?? null,
          secondaryImageSimilarity: secondaryImage.similarityScore ?? null,
          secondaryImageScene: secondaryImage.scene ?? null,
          mode: config.dryRun ? 'dry-run' : config.publishStatus
        };
        sourceStats[candidate.source.id].published += 1;
        categoryStats.published += 1;
        log('info', config.dryRun ? 'Haber simülasyonu tamamlandı' : config.publishStatus === 'draft' ? 'Haber taslak olarak kaydedildi' : 'Haber yayımlandı', result);
        return { slug, result, candidate };
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
        categoryStats.rejected += 1;
        increment(rejectedReasons, classified.group);
        if (classified.code === 'SOURCE_EXTRACTION') {
          increment(categorySourceFailures[slug], candidate.source.id);
        }
        if (classified.code === 'SOURCE_EXTRACTION') {
          failedCandidateMap.set(candidate.url, {
            url: candidate.url,
            failedAt: new Date().toISOString(),
            code: classified.code
          });
        }
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
      publishedCandidates.push(outcome.candidate);
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

  await saveFailedCandidateState([...failedCandidateMap.values()]);

  const coverage = editorialCoverage(categoryPublished, results);
  const targetReached = results.length >= config.minDailyTarget;
  const hadRejections = Object.keys(rejectedReasons).length > 0;
  const runStatus = results.length === 0
    ? 'failed'
    : !targetReached || timeLimitReached || coverage.missingCategories.length > 0
      ? 'partial'
      : hadRejections
        ? 'success_with_rejections'
        : 'success';

  log('info', 'Günlük SanatÇin taraması tamamlandı', {
    runStatus,
    ...coverage,
    categorySourceFailures,
    processed: results.length,
    target: `${config.minDailyTarget}-${config.maxDailyTotal}`,
    timeLimitReached,
    elapsedMinutes: Math.round((Date.now() - budget.startedAt) / 6000) / 10,
    categoryPublished,
    sourcePublished: distribution(results, 'source'),
    publisherPublished: distribution(results, 'publisherGroup'),
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
