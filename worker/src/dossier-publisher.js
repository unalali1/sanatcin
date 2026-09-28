import { log, setLogContext } from './logger.js';
import { DOSSIER_TOPICS } from './dossier-topics.js';
import {
  LEGACY_USED_DOSSIER_TOPIC_SLUGS,
  dossierPostMatchesTopic,
  isCompletedDossierPost,
  isoWeekKey,
  isoWeekStart
} from './dossier-wordpress.js';

const DOSSIER_CATEGORY_SLUG = 'cin-sanatlari-dosyasi';
const DOSSIER_SLUG_PREFIX = 'cin-sanatlari-dosyasi-';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

function env(name, fallback = '') {
  return process.env[name] ?? fallback;
}

function baseUrl() {
  return env('WP_BASE_URL').replace(/\/$/, '');
}

function authHeader() {
  return `Basic ${Buffer.from(`${env('WP_USERNAME')}:${env('WP_APP_PASSWORD').replace(/\s+/g, '')}`).toString('base64')}`;
}

async function wp(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(`${baseUrl()}/wp-json${path}`, {
    ...rest,
    headers: {
      authorization: authHeader(),
      'content-type': 'application/json',
      ...headers
    }
  });
  if (!response.ok) {
    throw new Error(`WordPress ${response.status}: ${(await response.text()).slice(0, 700)}`);
  }
  return response.status === 204 ? null : response.json();
}

function normalizeWpGmt(raw = '') {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/Z$|[+-]\d{2}:\d{2}$/.test(value)) return value;
  return `${value}Z`;
}

export function dossierPostTimestamp(post) {
  const gmt = String(post?.date_gmt || '').trim();
  if (gmt) return Date.parse(normalizeWpGmt(gmt));
  return Date.parse(String(post?.date || ''));
}

export function dossierTopicForPost(post) {
  return DOSSIER_TOPICS.find((topic) => dossierPostMatchesTopic(post, topic)) || null;
}

export function sameIsoWeekPublishedPost(publishedPosts = [], now = new Date()) {
  const start = isoWeekStart(now).getTime();
  const end = start + SEVEN_DAYS_MS;
  return publishedPosts.find((post) => {
    const timestamp = dossierPostTimestamp(post);
    return Number.isFinite(timestamp) && timestamp >= start && timestamp < end;
  }) || null;
}

export function validateDossierCandidate(post, {
  dossierCategoryId,
  publishedPosts = [],
  now = new Date()
} = {}) {
  const nowMs = now.getTime();
  const createdMs = dossierPostTimestamp(post);
  const topic = dossierTopicForPost(post);
  const duplicateTopic = Boolean(topic) && (
    LEGACY_USED_DOSSIER_TOPIC_SLUGS.has(topic.slug)
    || publishedPosts.some((published) => dossierPostMatchesTopic(published, topic))
  );

  const checks = {
    draft: post?.status === 'draft',
    category: Array.isArray(post?.categories)
      && post.categories.map(Number).includes(Number(dossierCategoryId)),
    slugPrefix: String(post?.slug || '').startsWith(DOSSIER_SLUG_PREFIX),
    completedContent: isCompletedDossierPost(post),
    createdWithinSevenDays: Number.isFinite(createdMs)
      && createdMs >= nowMs - SEVEN_DAYS_MS
      && createdMs <= nowMs + FUTURE_TOLERANCE_MS,
    featuredImage: Number(post?.featured_media || 0) > 0,
    knownTopic: Boolean(topic),
    topicUnused: Boolean(topic) && !duplicateTopic
  };

  const reasons = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  return {
    post,
    valid: reasons.length === 0,
    topicSlug: topic?.slug || null,
    checks,
    reasons
  };
}

export function chooseDossierCandidate(drafts = [], options = {}) {
  const validations = drafts.map((post) => validateDossierCandidate(post, options));
  const valid = validations
    .filter((item) => item.valid)
    .sort((left, right) => dossierPostTimestamp(right.post) - dossierPostTimestamp(left.post));

  return {
    candidate: valid[0]?.post || null,
    candidateValidation: valid[0] || null,
    validations
  };
}

export function validatePublisherEnvironment() {
  const required = ['WP_BASE_URL', 'WP_USERNAME', 'WP_APP_PASSWORD'];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Eksik ortam değişkenleri: ${missing.join(', ')}`);
}

async function listAllPosts({ categoryId, status, context }) {
  const all = [];
  for (let page = 1; page <= 20; page += 1) {
    const fields = 'id,slug,date,date_gmt,status,title,content,categories,featured_media,link,author';
    const path = `/wp/v2/posts?categories=${categoryId}&status=${encodeURIComponent(status)}&context=${encodeURIComponent(context)}&per_page=100&page=${page}&orderby=date&order=desc&_fields=${fields}`;
    const batch = await wp(path);
    if (!Array.isArray(batch)) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

export function createDossierPublisherClient() {
  return {
    async categoryId() {
      const result = await wp(`/wp/v2/categories?slug=${encodeURIComponent(DOSSIER_CATEGORY_SLUG)}&context=view&_fields=id,slug`);
      if (!Array.isArray(result) || !result.length) {
        throw new Error(`WordPress kategorisi bulunamadı: ${DOSSIER_CATEGORY_SLUG}`);
      }
      return Number(result[0].id);
    },
    async listDrafts(categoryId) {
      return listAllPosts({ categoryId, status: 'draft', context: 'edit' });
    },
    async listPublished(categoryId) {
      return listAllPosts({ categoryId, status: 'publish', context: 'view' });
    },
    async publishPost(postId) {
      return wp(`/wp/v2/posts/${postId}?_fields=id,status,slug,link,date,date_gmt`, {
        method: 'POST',
        body: JSON.stringify({ status: 'publish' })
      });
    }
  };
}

function compactValidation(item) {
  return {
    postId: item.post?.id || null,
    slug: item.post?.slug || null,
    topicSlug: item.topicSlug,
    valid: item.valid,
    checks: item.checks,
    reasons: item.reasons
  };
}

export async function runDossierPublisher({
  now = new Date(),
  client = createDossierPublisherClient(),
  logger = log
} = {}) {
  const weekKey = isoWeekKey(now);
  setLogContext({ worker: 'dossier-publisher', week: weekKey });

  const dossierCategoryId = await client.categoryId();
  const [drafts, publishedPosts] = await Promise.all([
    client.listDrafts(dossierCategoryId),
    client.listPublished(dossierCategoryId)
  ]);

  const selection = chooseDossierCandidate(drafts, {
    dossierCategoryId,
    publishedPosts,
    now
  });
  const sameWeekPost = sameIsoWeekPublishedPost(publishedPosts, now);

  logger('info', 'Çin Sanatları Dosyası publisher validation tamamlandı', {
    isoWeek: weekKey,
    foundDraftIds: drafts.map((post) => post.id),
    selectedDraftId: selection.candidate?.id || null,
    selectedTopicSlug: selection.candidateValidation?.topicSlug || null,
    validations: selection.validations.map(compactValidation)
  });

  if (sameWeekPost) {
    const result = {
      status: 'skipped',
      reason: 'already_published_this_iso_week',
      weekKey,
      publishedPostId: sameWeekPost.id,
      publishedUrl: sameWeekPost.link || null
    };
    logger('info', 'Çin Sanatları Dosyası publisher yayın yapmadı', result);
    return result;
  }

  if (!selection.candidate) {
    const result = {
      status: 'skipped',
      reason: drafts.length ? 'no_valid_dossier_draft' : 'no_dossier_draft',
      weekKey,
      validationResults: selection.validations.map(compactValidation)
    };
    logger('info', 'Çin Sanatları Dosyası publisher yayın yapmadı', result);
    return result;
  }

  const published = await client.publishPost(selection.candidate.id);
  if (published?.status !== 'publish') {
    throw new Error(`WordPress yazıyı publish durumuna geçirmedi: post ${selection.candidate.id}`);
  }

  const result = {
    status: 'published',
    weekKey,
    draftId: selection.candidate.id,
    topicSlug: selection.candidateValidation.topicSlug,
    postId: published.id,
    url: published.link || null
  };
  logger('info', 'Çin Sanatları Dosyası publisher yazıyı yayımladı', result);
  return result;
}
