let context = {};
let pendingPersistence = null;
let persistenceAwaited = false;

const runMetrics = {
  aiDurationsMs: [],
  aiRetryEvents: 0,
  aiFailedParts: 0
};

function rawWrite(level, message, details = {}) {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, message, ...context, ...details })}\n`);
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function average(values) {
  if (!values.length) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function distribution(items, key) {
  return (items ?? []).reduce((record, item) => {
    const value = item?.[key] ?? 'unknown';
    record[value] = (record[value] ?? 0) + 1;
    return record;
  }, {});
}

function buildEditorialReport(details = {}) {
  const sourceStats = details.sourceStats ?? {};
  const sources = Object.entries(sourceStats).map(([source, stats]) => ({
    source,
    discovered: numeric(stats.discovered),
    attempted: numeric(stats.attempted),
    published: numeric(stats.published),
    rejected: numeric(stats.rejected),
    error: stats.error ? String(stats.error).slice(0, 180) : null
  }));
  const results = Array.isArray(details.results) ? details.results : [];
  const imageScores = results.map((item) => Number(item.imageScore)).filter(Number.isFinite);
  const secondaryScores = results
    .map((item) => item.secondaryImageScore)
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter(Number.isFinite);
  const sourceHealth = sources
    .map((item) => ({
      ...item,
      rejectionRate: item.attempted ? Math.round((item.rejected / item.attempted) * 1000) / 10 : 0,
      conversionRate: item.attempted ? Math.round((item.published / item.attempted) * 1000) / 10 : 0
    }))
    .sort((left, right) => {
      if (Boolean(left.error) !== Boolean(right.error)) return left.error ? -1 : 1;
      return right.rejectionRate - left.rejectionRate;
    });

  return {
    runStatus: details.runStatus,
    published: results.length,
    discovered: sources.reduce((sum, item) => sum + item.discovered, 0),
    attempted: sources.reduce((sum, item) => sum + item.attempted, 0),
    rejected: sources.reduce((sum, item) => sum + item.rejected, 0),
    categoryPublished: details.categoryPublished ?? {},
    scoreStats: details.scoreStats ?? {},
    imageOrigins: distribution(results, 'imageOrigin'),
    averagePrimaryImageScore: average(imageScores),
    averageSecondaryImageScore: average(secondaryScores),
    secondaryImageCoverage: results.length ? Math.round((secondaryScores.length / results.length) * 1000) / 10 : 0,
    aiRanking: {
      batchesAndRetries: runMetrics.aiDurationsMs.length,
      averageMs: average(runMetrics.aiDurationsMs),
      maxMs: runMetrics.aiDurationsMs.length ? Math.max(...runMetrics.aiDurationsMs) : 0,
      retryEvents: runMetrics.aiRetryEvents,
      failedParts: runMetrics.aiFailedParts
    },
    selectionStats: details.selectionStats ?? {},
    rejectedReasons: details.rejectedReasons ?? {},
    sourcesNeedingAttention: sourceHealth.filter((item) => item.error || item.rejectionRate >= 50).slice(0, 8)
  };
}

function wpCredentials() {
  const baseUrl = (process.env.WP_BASE_URL ?? '').replace(/\/$/, '');
  const username = process.env.WP_USERNAME ?? '';
  const password = (process.env.WP_APP_PASSWORD ?? '').replace(/\s+/g, '');
  if (!baseUrl || !username || !password) return null;
  return {
    baseUrl,
    auth: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  };
}

async function wpRequest(path, options = {}) {
  const credentials = wpCredentials();
  if (!credentials) return null;
  const response = await fetch(`${credentials.baseUrl}/wp-json${path}`, {
    ...options,
    headers: {
      authorization: credentials.auth,
      'content-type': 'application/json',
      ...(options.headers ?? {})
    },
    signal: options.signal ?? AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`Source health WordPress ${response.status}: ${(await response.text()).slice(0, 250)}`);
  return response.status === 204 ? null : response.json();
}

function parseState(raw = '') {
  try {
    const parsed = JSON.parse(String(raw).trim());
    return Array.isArray(parsed?.runs) ? parsed : { version: 1, runs: [] };
  } catch {
    return { version: 1, runs: [] };
  }
}

async function persistSourceHealth(sourceStats = {}) {
  if (!wpCredentials()) return;
  const posts = await wpRequest('/wp/v2/posts?slug=sanatcin-source-health-state&status=draft&context=edit&per_page=1&_fields=id,content');
  const existing = Array.isArray(posts) ? posts[0] : null;
  const state = parseState(existing?.content?.raw ?? '');
  const run = {
    runId: context.runId ?? null,
    time: new Date().toISOString(),
    sources: sourceStats
  };
  state.version = 1;
  state.runs = [
    run,
    ...state.runs.filter((item) => item?.runId !== run.runId)
  ].slice(0, 30);
  const body = JSON.stringify({
    title: 'SanatÇin Source Health State',
    slug: 'sanatcin-source-health-state',
    status: 'draft',
    content: JSON.stringify(state)
  });
  if (existing?.id) {
    await wpRequest(`/wp/v2/posts/${existing.id}`, { method: 'POST', body });
  } else {
    await wpRequest('/wp/v2/posts', { method: 'POST', body });
  }
}

export function setLogContext(values = {}) {
  context = { ...context, ...values };
}

export function log(level, message, details = {}) {
  rawWrite(level, message, details);

  if ((message === 'AI sıralama partisi tamamlandı' || message === 'AI sıralama alt partisi tamamlandı') && Number.isFinite(Number(details.elapsedMs))) {
    runMetrics.aiDurationsMs.push(Number(details.elapsedMs));
  }
  if (message === 'AI sıralama partisi başarısız; küçük parçalara bölünerek yeniden denenecek') {
    runMetrics.aiRetryEvents += 1;
  }
  if (message === 'AI sıralama alt partisi başarısız; yalnız bu adaylar atlanacak') {
    runMetrics.aiFailedParts += 1;
  }

  if (message === 'Günlük SanatÇin taraması tamamlandı') {
    rawWrite('info', 'SanatÇin editör raporu', buildEditorialReport(details));
    pendingPersistence = persistSourceHealth(details.sourceStats ?? {}).catch((error) => {
      rawWrite('warn', 'Kaynak sağlık geçmişi kaydedilemedi', {
        error: String(error?.message ?? error).slice(0, 400)
      });
    });
  }
}

process.on('beforeExit', async () => {
  if (persistenceAwaited || !pendingPersistence) return;
  persistenceAwaited = true;
  await pendingPersistence;
});
