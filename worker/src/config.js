function integer(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function boolean(name, fallback = false) {
  const value = process.env[name];
  if (value == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const config = {
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-5-mini',
  wpBaseUrl: (process.env.WP_BASE_URL ?? '').replace(/\/$/, ''),
  wpUsername: process.env.WP_USERNAME ?? '',
  wpAppPassword: (process.env.WP_APP_PASSWORD ?? '').replace(/\s+/g, ''),
  publishStatus: process.env.PUBLISH_STATUS ?? 'draft',
  dryRun: boolean('DRY_RUN'),
  maxPerCategory: Math.max(1, Math.min(integer('MAX_PER_CATEGORY', 2), 2)),
  primaryLookbackHours: integer('PRIMARY_LOOKBACK_HOURS', 72),
  fallbackLookbackDays: integer('FALLBACK_LOOKBACK_DAYS', 7),
  discoveryConcurrency: integer('DISCOVERY_CONCURRENCY', 5),
  articleConcurrency: integer('ARTICLE_CONCURRENCY', 2),
  requestTimeoutMs: integer('REQUEST_TIMEOUT_MS', 25000),
  userAgent: process.env.USER_AGENT ?? 'SanatCinBot/1.0'
};

export function validateConfig() {
  const required = {
    OPENAI_API_KEY: config.openaiApiKey,
    WP_BASE_URL: config.wpBaseUrl,
    WP_USERNAME: config.wpUsername,
    WP_APP_PASSWORD: config.wpAppPassword
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name);
  if (!config.dryRun && missing.length) {
    throw new Error(`Eksik ortam değişkenleri: ${missing.join(', ')}`);
  }
  if (!['publish', 'draft'].includes(config.publishStatus)) {
    throw new Error('PUBLISH_STATUS yalnız publish veya draft olabilir.');
  }
}

