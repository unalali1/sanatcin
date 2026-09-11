function integer(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function boolean(name, fallback = false) {
  const value = process.env[name];
  if (value == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function boundedInteger(name, fallback, minimum, maximum) {
  return Math.max(minimum, Math.min(integer(name, fallback), maximum));
}

export const config = {
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-5-mini',
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2.5-flare',
  openaiImageQuality: process.env.OPENAI_IMAGE_QUALITY ?? 'medium',
  generateFallbackImages: boolean('GENERATE_FALLBACK_IMAGES', true),
  sourceImagePolicy: process.env.SOURCE_IMAGE_POLICY ?? 'licensed-only',
  wpBaseUrl: (process.env.WP_BASE_URL ?? '').replace(/\/$/, ''),
  wpUsername: process.env.WP_USERNAME ?? '',
  wpAppPassword: (process.env.WP_APP_PASSWORD ?? '').replace(/\s+/g, ''),
  publishStatus: process.env.PUBLISH_STATUS ?? 'draft',
  dryRun: boolean('DRY_RUN'),
  requirePublishedDate: boolean('REQUIRE_PUBLISHED_DATE', true),
  maxPerCategory: boundedInteger('MAX_PER_CATEGORY', 2, 1, 2),
  maxAttemptsPerCategory: boundedInteger('MAX_ATTEMPTS_PER_CATEGORY', 5, 1, 10),
  minDailyTarget: boundedInteger('MIN_DAILY_TARGET', 4, 1, 8),
  maxDailyTotal: boundedInteger('MAX_DAILY_TOTAL', 8, 1, 8),
  maxRunMinutes: boundedInteger('MAX_RUN_MINUTES', 30, 5, 60),
  maxAiCandidates: boundedInteger('MAX_AI_CANDIDATES', 80, 20, 160),
  aiBatchSize: boundedInteger('AI_BATCH_SIZE', 20, 10, 40),
  aiRerankConcurrency: boundedInteger('AI_RERANK_CONCURRENCY', 2, 1, 3),
  aiRequestTimeoutMs: boundedInteger('AI_REQUEST_TIMEOUT_MS', 90_000, 15_000, 180_000),
  aiMaxRetries: boundedInteger('AI_MAX_RETRIES', 1, 0, 2),
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
  if (!['licensed-only', 'allow-all'].includes(config.sourceImagePolicy)) {
    throw new Error('SOURCE_IMAGE_POLICY yalnız licensed-only veya allow-all olabilir.');
  }
  if (!['low', 'medium', 'high', 'auto'].includes(config.openaiImageQuality)) {
    throw new Error('OPENAI_IMAGE_QUALITY low, medium, high veya auto olmalı.');
  }
}
