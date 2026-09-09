import crypto from 'node:crypto';
import { config } from './config.js';
import { sourceHash } from './fetch.js';
import { isUsableImageUrl } from './quality.js';

const auth = `Basic ${Buffer.from(`${config.wpUsername}:${config.wpAppPassword}`).toString('base64')}`;
const categoryIds = new Map();
const runImageHashes = new Set();

async function wp(path, options = {}) {
  const response = await fetch(`${config.wpBaseUrl}/wp-json${path}`, {
    ...options,
    headers: { authorization: auth, 'content-type': 'application/json', ...(options.headers ?? {}) }
  });
  if (!response.ok) throw new Error(`WordPress ${response.status}: ${(await response.text()).slice(0, 700)}`);
  return response.status === 204 ? null : response.json();
}

export async function knownHashes(hashes) {
  if (config.dryRun || hashes.length === 0) return [];
  const result = await wp('/sanatcin/v1/known', { method: 'POST', body: JSON.stringify({ hashes }) });
  return result.known ?? [];
}

async function categoryId(slug) {
  if (categoryIds.has(slug)) return categoryIds.get(slug);
  const categories = await wp(`/wp/v2/categories?slug=${encodeURIComponent(slug)}`);
  if (!categories.length) throw new Error(`WordPress kategorisi bulunamadı: ${slug}`);
  categoryIds.set(slug, categories[0].id);
  return categories[0].id;
}

function extensionFor(contentType) {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime] ?? null;
}

export async function prepareFeaturedImage(article) {
  if (!isUsableImageUrl(article.sourceImageUrl)) throw new Error('Haberde kullanılabilir bir kaynak görsel bulunamadı.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(article.sourceImageUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': config.userAgent, accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8', referer: article.url }
    });
    if (!response.ok) throw new Error(`Kaynak görsel indirilemedi: HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') ?? '';
    const extension = extensionFor(contentType);
    if (!extension) throw new Error(`Desteklenmeyen görsel türü: ${contentType || 'bilinmiyor'}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 12_000) throw new Error('Kaynak görsel güvenilir kalite için çok küçük.');
    if (buffer.length > 10_000_000) throw new Error('Kaynak görsel 10 MB sınırını aşıyor.');
    const imageHash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (runImageHashes.has(imageHash)) throw new Error('Aynı görsel bu çalışmada başka bir haber için zaten kullanıldı.');
    const existing = await wp(`/sanatcin/v1/image-known?hash=${encodeURIComponent(imageHash)}`);
    if (existing.known) throw new Error('Aynı görsel daha önce başka bir haberde kullanılmış.');
    return { buffer, contentType: contentType.split(';')[0], extension, imageHash };
  } finally {
    clearTimeout(timer);
  }
}

async function uploadFeaturedImage(article, image) {
  const filename = `sanatcin-${image.imageHash.slice(0, 20)}.${image.extension}`;
  const media = await wp('/wp/v2/media', {
    method: 'POST',
    body: image.buffer,
    headers: {
      'content-type': image.contentType,
      'content-disposition': `attachment; filename="${filename}"`
    }
  });
  await wp(`/wp/v2/media/${media.id}`, {
    method: 'POST',
    body: JSON.stringify({ title: article.title, alt_text: article.title })
  });
  runImageHashes.add(image.imageHash);
  return media.id;
}

export async function publishArticle(article, preparedImage = null) {
  const sourceLine = `<aside class="sanatcin-source"><strong>Kaynak:</strong> <a href="${article.url}" target="_blank" rel="noopener noreferrer nofollow">${article.source.name}</a></aside>`;
  const category = await categoryId(article.category);
  const image = preparedImage ?? await prepareFeaturedImage(article);
  if (config.dryRun) {
    runImageHashes.add(image.imageHash);
    return {
      id: null,
      link: null,
      dryRun: true,
      payload: { title: article.title, excerpt: article.excerpt, status: config.publishStatus, categories: [category], sourceImageUrl: article.sourceImageUrl, imageHash: image.imageHash }
    };
  }

  const featuredMedia = await uploadFeaturedImage(article, image);
  const payload = {
    title: article.title,
    excerpt: article.excerpt,
    content: `${article.bodyHtml}\n${sourceLine}`,
    status: 'draft',
    categories: [category],
    featured_media: featuredMedia,
    meta: {
      sanatcin_source_url: article.url,
      sanatcin_source_name: article.source.name,
      sanatcin_source_hash: sourceHash(article.url),
      sanatcin_image_hash: image.imageHash,
      sanatcin_score: Math.round(article.score),
      sanatcin_original_title: article.originalTitle
    }
  };
  let post = await wp('/wp/v2/posts', { method: 'POST', body: JSON.stringify(payload) });
  if (config.publishStatus === 'publish') {
    post = await wp(`/wp/v2/posts/${post.id}`, { method: 'POST', body: JSON.stringify({ status: 'publish' }) });
  }
  return post;
}
