import OpenAI from 'openai';
import { load } from 'cheerio';
import { titleSimilarity } from './quality.js';

const REGULAR_CATEGORY_SLUGS = ['kultur-sanat', 'sinema', 'moda-tasarim', 'sehir-yasam'];
const DUPLICATE_THRESHOLD = 0.45;
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

function baseScore(post) {
  return clamp(post?.meta?.sanatcin_score ?? 0, 50);
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
  const candidateTitle = titleText(candidate);
  if (!candidateTitle) return true;
  return selected.some((existing) => {
    const similarity = titleSimilarity(candidateTitle, titleText(existing));
    return similarity.score >= DUPLICATE_THRESHOLD && similarity.shared >= 2;
  });
}

export function selectNewsletterPostsByScore(posts, maxItems = 6) {
  const selected = [];
  const selectedIds = new Set();
  const pick = (candidate) => {
    if (!candidate || selectedIds.has(candidate.id) || selected.length >= maxItems) return false;
    if (isDuplicateTopic(candidate, selected)) return false;
    selected.push(candidate);
    selectedIds.add(candidate.id);
    return true;
  };
  const pickBest = (items) => {
    for (const candidate of sortByNewsletterScore(items)) {
      if (pick(candidate)) return candidate;
    }
    return null;
  };

  pickBest(posts.filter((post) => hasCategory(post, 'editorden')));
  for (const slug of REGULAR_CATEGORY_SLUGS) {
    pickBest(posts.filter((post) => hasCategory(post, slug) && !selectedIds.has(post.id)));
  }
  for (const post of sortByNewsletterScore(posts.filter((post) => !selectedIds.has(post.id)))) pick(post);

  if (!selected.length) return [];
  const hero = sortByNewsletterScore(selected)[0];
  return [hero, ...selected.filter((post) => post.id !== hero.id)].slice(0, maxItems);
}

export async function buildNewsletterSelection(posts, maxItems = 6, options = {}) {
  const scored = await scoreNewsletterPosts(posts, options);
  return selectNewsletterPostsByScore(scored, maxItems);
}
