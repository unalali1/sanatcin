import { load } from 'cheerio';
import { DOSSIER_TOPICS, nextUnusedTopic } from './dossier-topics.js';

function env(name, fallback = '') { return process.env[name] ?? fallback; }
function text(value = '') { return load(`<div>${String(value ?? '')}</div>`).text().replace(/\s+/g, ' ').trim(); }
function esc(value = '') { return String(value).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[c]); }

const baseUrl = () => env('WP_BASE_URL').replace(/\/$/, '');
const authHeader = () => `Basic ${Buffer.from(`${env('WP_USERNAME')}:${env('WP_APP_PASSWORD').replace(/\s+/g, '')}`).toString('base64')}`;

async function wp(path, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(`${baseUrl()}/wp-json${path}`, {
    ...rest,
    headers: { authorization: authHeader(), 'content-type': 'application/json', ...headers }
  });
  if (!response.ok) throw new Error(`WordPress ${response.status}: ${(await response.text()).slice(0, 700)}`);
  return response.status === 204 ? null : response.json();
}

export function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function isoWeekStart(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function categoryId(slug) {
  const result = await wp(`/wp/v2/categories?slug=${encodeURIComponent(slug)}&context=edit`);
  if (!Array.isArray(result) || !result.length) throw new Error(`WordPress kategorisi bulunamadı: ${slug}`);
  return Number(result[0].id);
}

async function postsForCategory(category) {
  const statuses = ['draft', 'publish', 'pending', 'future', 'private'];
  const all = [];
  for (const status of statuses) {
    try {
      const posts = await wp(`/wp/v2/posts?categories=${category}&status=${status}&per_page=100&context=edit&_fields=id,slug,date,date_gmt,status,title`);
      if (Array.isArray(posts)) all.push(...posts);
    } catch (error) {
      if (status === 'private') continue;
      throw error;
    }
  }
  return all;
}

export async function dossierRunState(now = new Date()) {
  const dossierCategory = await categoryId('cin-sanatlari-dosyasi');
  const cultureCategory = await categoryId('kultur-sanat');
  const posts = await postsForCategory(dossierCategory);
  const weekStart = isoWeekStart(now).getTime();
  const currentWeekPost = posts.find((post) => {
    const timestamp = Date.parse(post.date_gmt || post.date || 0);
    return Number.isFinite(timestamp) && timestamp >= weekStart;
  });
  const usedSlugs = new Set();
  for (const topic of DOSSIER_TOPICS) {
    const expected = `cin-sanatlari-dosyasi-${topic.slug}`;
    if (posts.some((post) => post.slug === expected || post.slug?.startsWith(`${expected}-`))) usedSlugs.add(topic.slug);
  }
  const topic = nextUnusedTopic(usedSlugs);
  return { dossierCategory, cultureCategory, posts, currentWeekPost, usedSlugs, topic, weekKey: isoWeekKey(now) };
}

function extension(contentType = '') {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime] || 'jpg';
}

async function uploadOneImage(candidate, topic, index, signal) {
  const response = await fetch(candidate.thumbUrl, {
    signal,
    headers: { 'user-agent': env('USER_AGENT', 'SanatCinBot/1.0'), accept: 'image/jpeg,image/png,image/webp,image/*' }
  });
  if (!response.ok) throw new Error(`Commons görseli indirilemedi: HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 10_000 || buffer.length > 9_000_000) throw new Error(`Commons görsel boyutu uygun değil: ${buffer.length} byte.`);
  const fileName = `cin-sanatlari-${topic.slug}-${index + 1}.${extension(contentType)}`;
  const upload = await fetch(`${baseUrl()}/wp-json/wp/v2/media`, {
    method: 'POST',
    signal,
    headers: {
      authorization: authHeader(),
      'content-type': contentType.split(';')[0],
      'content-disposition': `attachment; filename="${fileName}"`
    },
    body: buffer
  });
  if (!upload.ok) throw new Error(`WordPress medya yükleme hatası ${upload.status}: ${(await upload.text()).slice(0, 500)}`);
  const media = await upload.json();
  const alt = candidate.description || `${topic.title} hakkında tarihsel eser veya zanaat örneği`;
  const credit = [candidate.artist, candidate.license].filter(Boolean).join(' · ');
  await wp(`/wp/v2/media/${media.id}`, {
    method: 'POST',
    signal,
    body: JSON.stringify({
      alt_text: text(alt).slice(0, 180),
      caption: `<a href="${esc(candidate.sourcePage)}" target="_blank" rel="noopener noreferrer nofollow">Wikimedia Commons</a>${credit ? ` · ${esc(credit)}` : ''}`,
      description: `Kaynak: ${candidate.sourcePage}\nLisans: ${candidate.license}${candidate.licenseUrl ? ` (${candidate.licenseUrl})` : ''}`
    })
  });
  return { ...candidate, mediaId: media.id, mediaUrl: media.source_url, altText: text(alt).slice(0, 180), credit };
}

export async function uploadDossierImages(images, topic, { signal } = {}) {
  const uploaded = [];
  for (let index = 0; index < images.length; index += 1) {
    try {
      uploaded.push(await uploadOneImage(images[index], topic, index, signal));
    } catch (error) {
      if (uploaded.length < 2 && index === images.length - 1) throw error;
    }
  }
  return uploaded;
}

function figureHtml(image) {
  return `<figure class="wp-block-image size-large sanatcin-dossier-image"><img src="${esc(image.mediaUrl)}" alt="${esc(image.altText)}" loading="lazy"><figcaption>${esc(image.title)}${image.credit ? ` · ${esc(image.credit)}` : ''} · <a href="${esc(image.sourcePage)}" target="_blank" rel="noopener noreferrer nofollow">Wikimedia Commons</a></figcaption></figure>`;
}

export function injectDossierImages(contentHtml, uploadedImages) {
  const bodyImages = uploadedImages.slice(1);
  if (!bodyImages.length) return contentHtml;
  const parts = String(contentHtml).split(/(<\/p>)/i);
  let paragraphCount = 0;
  let imageIndex = 0;
  const targets = [2, 5, 8, 11, 14];
  let output = '';
  for (let i = 0; i < parts.length; i += 1) {
    output += parts[i];
    if (/^<\/p>$/i.test(parts[i])) {
      paragraphCount += 1;
      if (imageIndex < bodyImages.length && paragraphCount >= (targets[imageIndex] || paragraphCount + 1)) {
        output += figureHtml(bodyImages[imageIndex]);
        imageIndex += 1;
      }
    }
  }
  while (imageIndex < bodyImages.length) {
    output += figureHtml(bodyImages[imageIndex]);
    imageIndex += 1;
  }
  return output;
}

export async function createDossierDraft(article, uploadedImages, state, { signal } = {}) {
  if (!state?.topic) throw new Error('Kullanılabilir dosya konusu kalmadı.');
  const content = injectDossierImages(article.contentHtml, uploadedImages);
  const payload = {
    status: 'draft',
    slug: `cin-sanatlari-dosyasi-${state.topic.slug}`,
    title: article.title,
    excerpt: article.excerpt,
    content,
    categories: [state.cultureCategory, state.dossierCategory],
    featured_media: uploadedImages[0]?.mediaId || 0
  };
  const post = await wp('/wp/v2/posts', { method: 'POST', signal, body: JSON.stringify(payload) });
  return { id: post.id, link: post.link, status: post.status, slug: post.slug, title: text(post.title?.rendered || article.title) };
}
