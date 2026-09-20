import OpenAI from 'openai';
import { load } from 'cheerio';
import { titleSimilarity } from './quality.js';

const REGULAR_CATEGORY_SLUGS = ['kultur-sanat', 'sinema', 'moda-tasarim', 'sehir-yasam'];
const DUPLICATE_THRESHOLD = 0.45;
const DEFAULT_MIN_NEWSLETTER_SCORE = 68;
const DEFAULT_MAX_PER_SOURCE = 2;
const DEFAULT_CATEGORY_DIVERSITY_BONUS = 5;
const HERO_MIN_VISUAL_SCORE = 72;
const TOPIC_STOPWORDS = new Set(['ve','ile','icin','gibi','olan','olarak','daha','yeni','cinde','cin','bir','bu','da','de','den','dan','nin','nun','nın','un','in','the','of','and','to','in','on','at']);
const SCORE_WEIGHTS = Object.freeze({
  weeklyImportance: 0.30,
  editorialFit: 0.20,
  originality: 0.15,
  visualStrength: 0.15,
  readerInterest: 0.15,
  recency: 0.05
});

function clamp(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
}

function text(value = '') {
  return load(`<div>${value}</div>`).text().replace(/\s+/g, ' ').trim();
}

function titleText(post) {
  return text(post?.title?.rendered || '');
}

function excerptText(post) {
  return text(post?.excerpt?.rendered || '').slice(0, 260);
}

function categories(post) {
  const groups = post?._embedded?.['wp:term'] ?? [];
  return groups.flat().filter((term) => term.taxonomy === 'category');
}

function categorySlugs(post) {
  return categories(post).map((category) => category.slug);
}

function hasCategory(post, slug) {
  return categorySlugs(post).includes(slug);
}


function normalizedTopicTokens(value = '') {
  return text(value)
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9çğıöşü\s]/giu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !TOPIC_STOPWORDS.has(token));
}

function topicTokenSet(post) {
  return new Set(normalizedTopicTokens(titleText(post) + ' ' + excerptText(post)));
}

export function newsletterTopicSimilarity(left, right) {
  const title = titleSimilarity(titleText(left), titleText(right));
  const a = topicTokenSet(left);
  const b = topicTokenSet(right);
  const shared = [...a].filter((token) => b.has(token)).length;
  const containment = a.size && b.size ? shared / Math.min(a.size, b.size) : 0;
  return {
    score: Math.max(Number(title.score || 0), containment),
    titleScore: Number(title.score || 0),
    titleShared: Number(title.shared || 0),
    semanticScore: containment,
    semanticShared: shared
  };
}

export function newsletterSourceKey(post) {
  const rawName = text(post?.meta?.sanatcin_source_name || '');
  if (rawName) {
    const provider = rawName.split(/[–—|]/)[0].replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
    if (provider) return 'name:' + provider;
  }
  const sourceUrl = String(post?.meta?.sanatcin_source_url || '').trim();
  if (sourceUrl) {
    try {
      return 'host:' + new URL(sourceUrl).hostname.replace(/^www\./, '').toLowerCase();
    } catch {}
  }
  return 'post:' + String(post?.id ?? 'unknown');
}

function regularCategorySlugs(post) {
  return categorySlugs(post).filter((slug) => REGULAR_CATEGORY_SLUGS.includes(slug));
}

function baseScore(post) {
  const raw = Number(post?.meta?.sanatcin_score ?? 0);
  if (Number.isFinite(raw) && raw > 0) return clamp(raw, 50);
  if (hasCategory(post, 'editorden') || hasCategory(post, 'cin-sanatlari-dosyasi')) return 75;
  return 50;
}

function dateValue(post) {
  return Date.parse(post?.date_gmt || post?.date || 0) || 0;
}

export function newsletterRecencyScore(post, now = new Date()) {
  const timestamp = dateValue(post);
  if (!timestamp) return 45;
  const ageDays = Math.max(0, (now.getTime() - timestamp) / 86400000);
  if (ageDays <= 1) return 100;
  if (ageDays <= 2) return 94;
  if (ageDays <= 3) return 88;
  if (ageDays <= 4) return 80;
  if (ageDays <= 5) return 72;
  if (ageDays <= 6) return 64;
  if (ageDays <= 7) return 56;
  return Math.max(30, 56 - Math.round((ageDays - 7) * 4));
}

export function newsletterVisualStrength(post) {
  const media = post?._embedded?.['wp:featuredmedia']?.[0];
  if (!media?.source_url) return 35;
  const width = Number(media?.media_details?.width) || Number(media?.media_details?.sizes?.large?.width) || 0;
  const height = Number(media?.media_details?.height) || Number(media?.media_details?.sizes?.large?.height) || 0;
  let score = 60;
  if (width >= 1600 && height >= 900) score = 96;
  else if (width >= 1200 && height >= 675) score = 91;
  else if (width >= 1000 && height >= 600) score = 86;
  else if (width >= 900 && height >= 500) score = 80;
  else if (width >= 700 && height >= 400) score = 72;
  else if (width >= 500 && height >= 300) score = 63;
  if (text(media?.alt_text || '').length >= 18) score += 2;
  return clamp(score);
}

function originalityFallback(post, pool) {
  const title = titleText(post);
  let maxSimilarity = 0;
  for (const other of pool) {
    if (other.id === post.id) continue;
    const similarity = titleSimilarity(title, titleText(other));
    maxSimilarity = Math.max(maxSimilarity, similarity.score || 0);
  }
  return clamp(94 - maxSimilarity * 50, 70);
}

export function deterministicNewsletterComponents(post, pool = [], now = new Date()) {
  const base = baseScore(post);
  return {
    weeklyImportance: clamp(base * 0.82 + 14),
    editorialFit: clamp(base * 0.88 + 12),
    originality: originalityFallback(post, pool),
    visualStrength: newsletterVisualStrength(post),
    readerInterest: clamp(base * 0.85 + 10),
    recency: newsletterRecencyScore(post, now)
  };
}

export function calculateNewsletterScore(components) {
  const score = Object.entries(SCORE_WEIGHTS).reduce((sum, [key, weight]) => sum + clamp(components?.[key]) * weight, 0);
  return Math.round(score * 10) / 10;
}

function deterministicScoredPost(post, pool, now, mode = 'deterministic') {
  const components = deterministicNewsletterComponents(post, pool, now);
  return {
    ...post,
    newsletterScore: calculateNewsletterScore(components),
    newsletterScoreComponents: components,
    newsletterScoreMode: mode
  };
}

function shortlist(posts, limit = 32) {
  const chosen = new Map();
  const byBase = [...posts].sort((a, b) => baseScore(b) - baseScore(a) || dateValue(b) - dateValue(a));
  const take = (items, count) => {
    for (const post of items.slice(0, count)) chosen.set(post.id, post);
  };
  take(byBase.filter((post) => hasCategory(post, 'editorden')), 6);
  for (const slug of REGULAR_CATEGORY_SLUGS) take(byBase.filter((post) => hasCategory(post, slug)), 8);
  take(byBase, limit);
  return [...chosen.values()].slice(0, limit);
}

function parseJson(value) {
  const compact = String(value ?? '').replace(/^```json\s*|\s*```$/g, '').trim();
  const start = compact.indexOf('{');
  const end = compact.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('NewsletterScore modeli geçerli JSON döndürmedi.');
  return JSON.parse(compact.slice(start, end + 1));
}

async function aiComponents(posts, { apiKey, model, signal } = {}) {
  if (!apiKey || !posts.length) return new Map();
  const client = new OpenAI({ apiKey, timeout: 90000, maxRetries: 1 });
  const payload = posts.map((post) => ({
    id: post.id,
    title: titleText(post),
    excerpt: excerptText(post),
    categories: categorySlugs(post),
    sanatcinScore: baseScore(post)
  }));
  const response = await client.responses.create({
    model: model || 'gpt-5-mini',
    input: [{
      role: 'system',
      content: [
        'SanatÇin haftalık bülteni için kıdemli kültür-sanat editörüsün.',
        'Adayları yalnız o haftanın kendi havuzu içinde değerlendir; günlük haber puanını kopyalama.',
        'Her içerik için 0-100 arasında dört ayrı puan ver:',
        'weeklyImportance: bu haftanın seçkisinde yer almaya ne kadar değer olduğu; somut gelişme, kültürel önem ve haftalık gündem ağırlığı.',
        'editorialFit: SanatÇin’in kültür, sanat, sinema, moda, tasarım ve şehir yaşamı kimliğine ne kadar doğal oturduğu.',
        'originality: aynı hafta içindeki diğer adaylara kıyasla konu ve açı bakımından ne kadar farklı/özgün olduğu.',
        'readerInterest: Türkiye’deki genel kültür-sanat okurunun başlığa ve konuya ilgi duyma olasılığı.',
        'Kurumsal toplantı, rutin atama veya dar kapsamlı yerel etkinlikleri gereğinden yüksek puanlama.',
        'Müze, önemli sergi, güçlü sinema haberi, özgün tasarım, yaratıcı endüstri, arkeoloji, miras veya sıra dışı şehir-kültür hikâyeleri hak ediyorsa yüksek puan alabilir.',
        'Clickbait potansiyelini değil gerçek editoryal değeri ölç.',
        'Yalnız geçerli JSON ver.'
      ].join(' ')
    }, {
      role: 'user',
      content: `Adaylar:\n${JSON.stringify(payload)}\n\nJSON şeması: {"items":[{"id":123,"weeklyImportance":80,"editorialFit":88,"originality":76,"readerInterest":82,"reason":"kısa gerekçe"}]}`
    }]
  }, { signal });
  const parsed = parseJson(response.output_text);
  const result = new Map();
  for (const item of Array.isArray(parsed.items) ? parsed.items : []) {
    if (!Number.isFinite(Number(item.id))) continue;
    result.set(Number(item.id), {
      weeklyImportance: clamp(item.weeklyImportance),
      editorialFit: clamp(item.editorialFit),
      originality: clamp(item.originality),
      readerInterest: clamp(item.readerInterest),
      reason: text(item.reason || '').slice(0, 220)
    });
  }
  return result;
}

export async function scoreNewsletterPosts(posts, {
  apiKey = process.env.OPENAI_API_KEY || '',
  model = process.env.NEWSLETTER_SCORE_MODEL || process.env.OPENAI_SELECTION_MODEL || 'gpt-5-mini',
  now = new Date(),
  signal
} = {}) {
  const pool = Array.isArray(posts) ? posts : [];
  const scored = new Map(pool.map((post) => [post.id, deterministicScoredPost(post, pool, now)]));
  const candidates = shortlist(pool);
  if (!apiKey || !candidates.length) return [...scored.values()];

  try {
    const aiScores = await aiComponents(candidates, { apiKey, model, signal });
    for (const post of candidates) {
      const aiScore = aiScores.get(Number(post.id));
      if (!aiScore) continue;
      const fallback = deterministicNewsletterComponents(post, pool, now);
      const components = {
        weeklyImportance: aiScore.weeklyImportance,
        editorialFit: aiScore.editorialFit,
        originality: aiScore.originality,
        visualStrength: fallback.visualStrength,
        readerInterest: aiScore.readerInterest,
        recency: fallback.recency
      };
      scored.set(post.id, {
        ...post,
        newsletterScore: calculateNewsletterScore(components),
        newsletterScoreComponents: components,
        newsletterScoreMode: 'ai-assisted',
        newsletterScoreReason: aiScore.reason
      });
    }
  } catch (error) {
    return [...scored.values()].map((post) => ({
      ...post,
      newsletterScoreMode: 'deterministic-fallback',
      newsletterScoreError: String(error?.message ?? error).slice(0, 240)
    }));
  }
  return [...scored.values()];
}

function sortByNewsletterScore(posts) {
  return [...posts].sort((a, b) =>
    Number(b.newsletterScore ?? 0) - Number(a.newsletterScore ?? 0)
    || dateValue(b) - dateValue(a)
  );
}

function isDuplicateTopic(candidate, selected) {
  return selected.some((existing) => {
    const similarity = newsletterTopicSimilarity(candidate, existing);
    return (
      (similarity.titleScore >= DUPLICATE_THRESHOLD && similarity.titleShared >= 2)
      || (similarity.semanticScore >= 0.5 && similarity.semanticShared >= 4)
    );
  });
}

function heroRank(post) {
  const components = post?.newsletterScoreComponents || {};
  const visual = Number(components.visualStrength ?? newsletterVisualStrength(post)) || 0;
  const reader = Number(components.readerInterest ?? baseScore(post)) || 0;
  const overall = Number(post?.newsletterScore ?? 0) || 0;
  return overall * 0.65 + visual * 0.20 + reader * 0.15;
}

function sourceCount(selected, candidate) {
  const key = newsletterSourceKey(candidate);
  return selected.filter((post) => newsletterSourceKey(post) === key).length;
}

function diversityAdjustment(candidate, selected, categoryDiversityBonus) {
  const seenCategories = new Set(selected.flatMap(regularCategorySlugs));
  const hasNewRegularCategory = regularCategorySlugs(candidate).some((slug) => !seenCategories.has(slug));
  const hasEditor = selected.some((post) => hasCategory(post, 'editorden'));
  const editorBonus = hasCategory(candidate, 'editorden') && !hasEditor ? Math.min(3, categoryDiversityBonus) : 0;
  return (hasNewRegularCategory ? categoryDiversityBonus : 0) + editorBonus;
}

export function selectNewsletterPostsByScore(posts, maxItems = 8, {
  minScore = DEFAULT_MIN_NEWSLETTER_SCORE,
  maxPerSource = DEFAULT_MAX_PER_SOURCE,
  categoryDiversityBonus = DEFAULT_CATEGORY_DIVERSITY_BONUS
} = {}) {
  const selected = [];
  const selectedIds = new Set();
  const candidates = sortByNewsletterScore(
    posts.filter((post) => Number(post.newsletterScore ?? 0) >= minScore)
  );

  while (selected.length < maxItems) {
    let best = null;
    let bestAdjusted = -Infinity;
    for (const candidate of candidates) {
      if (selectedIds.has(candidate.id)) continue;
      if (isDuplicateTopic(candidate, selected)) continue;
      if (sourceCount(selected, candidate) >= maxPerSource) continue;

      const sourcePenalty = sourceCount(selected, candidate) * 1.5;
      const adjusted = Number(candidate.newsletterScore ?? 0)
        + diversityAdjustment(candidate, selected, categoryDiversityBonus)
        - sourcePenalty;
      if (
        adjusted > bestAdjusted
        || (adjusted === bestAdjusted && dateValue(candidate) > dateValue(best))
      ) {
        best = candidate;
        bestAdjusted = adjusted;
      }
    }
    if (!best) break;
    selected.push(best);
    selectedIds.add(best.id);
  }

  if (!selected.length) return [];
  const heroPool = selected.filter((post) => newsletterVisualStrength(post) >= HERO_MIN_VISUAL_SCORE);
  const heroCandidates = heroPool.length ? heroPool : selected;
  const hero = [...heroCandidates].sort((a, b) => heroRank(b) - heroRank(a) || dateValue(b) - dateValue(a))[0];
  return [hero, ...selected.filter((post) => post.id !== hero.id)].slice(0, maxItems);
}

function truncateSubject(value, maxLength) {
  const clean = text(value);
  if (clean.length <= maxLength) return clean;
  const sliced = clean.slice(0, Math.max(1, maxLength - 1));
  const boundary = sliced.lastIndexOf(' ');
  return (boundary >= Math.floor(maxLength * 0.65) ? sliced.slice(0, boundary) : sliced).trimEnd() + '…';
}

export function buildNewsletterSubject(posts, {
  brand = 'SanatÇin',
  maxLength = 72,
  fallback = 'SanatÇin Haftalık Seçki'
} = {}) {
  const first = titleText(posts?.[0]);
  const second = titleText(posts?.[1]);
  if (!first) return fallback;

  const twoStory = brand + ' | ' + truncateSubject(first, 34) + ' · ' + truncateSubject(second, 26);
  if (second && twoStory.length <= maxLength) return twoStory;
  return truncateSubject(brand + ' | ' + first, maxLength);
}

export function validateNewsletterSelection(posts, {
  minItems = 4,
  maxItems = 8,
  minScore = DEFAULT_MIN_NEWSLETTER_SCORE,
  maxPerSource = DEFAULT_MAX_PER_SOURCE
} = {}) {
  const errors = [];
  if (!Array.isArray(posts)) return { ok: false, errors: ['Seçki bir dizi değil.'] };
  if (posts.length < minItems) errors.push('Yeterli sayıda güçlü içerik yok: ' + posts.length + '/' + minItems + '.');
  if (posts.length > maxItems) errors.push('Seçki üst sınırı aşıyor: ' + posts.length + '/' + maxItems + '.');

  const ids = new Set();
  const links = new Set();
  const sources = new Map();
  for (const post of posts) {
    if (ids.has(post.id)) errors.push('Aynı içerik kimliği iki kez seçilmiş: ' + post.id + '.');
    ids.add(post.id);

    const link = String(post?.link || '').trim();
    if (!/^https:\/\//i.test(link)) errors.push('Geçersiz veya güvensiz haber bağlantısı: ' + (post.id ?? '?') + '.');
    if (links.has(link)) errors.push('Aynı haber bağlantısı iki kez seçilmiş: ' + link + '.');
    if (link) links.add(link);

    if (!titleText(post)) errors.push('Başlığı olmayan içerik var: ' + (post.id ?? '?') + '.');
    if (!excerptText(post)) errors.push('Spotu olmayan içerik var: ' + (post.id ?? '?') + '.');
    if (!post?._embedded?.['wp:featuredmedia']?.[0]?.source_url) errors.push('Öne çıkan görseli olmayan içerik var: ' + (post.id ?? '?') + '.');
    if (Number(post?.newsletterScore ?? 0) < minScore) errors.push('Kalite eşiğinin altında içerik seçilmiş: ' + (post.id ?? '?') + '.');

    const source = newsletterSourceKey(post);
    const count = (sources.get(source) || 0) + 1;
    sources.set(source, count);
    if (!source.startsWith('post:') && count > maxPerSource) {
      errors.push('Aynı kaynaktan izin verilenden fazla içerik seçilmiş: ' + source + '.');
    }
  }

  for (let i = 0; i < posts.length; i += 1) {
    for (let j = i + 1; j < posts.length; j += 1) {
      const similarity = newsletterTopicSimilarity(posts[i], posts[j]);
      if (
        (similarity.titleScore >= DUPLICATE_THRESHOLD && similarity.titleShared >= 2)
        || (similarity.semanticScore >= 0.5 && similarity.semanticShared >= 4)
      ) {
        errors.push('Benzer iki konu seçilmiş: ' + posts[i].id + ' / ' + posts[j].id + '.');
      }
    }
  }

  if (posts.length && newsletterVisualStrength(posts[0]) < HERO_MIN_VISUAL_SCORE) {
    errors.push('Hero haberin görsel gücü minimum eşiğin altında.');
  }
  return { ok: errors.length === 0, errors };
}

export async function buildNewsletterSelection(posts, maxItems = 8, options = {}) {
  const scored = await scoreNewsletterPosts(posts, options);
  return selectNewsletterPostsByScore(scored, maxItems, options);
}
