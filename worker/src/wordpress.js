import crypto from 'node:crypto';
import OpenAI from 'openai';
import { config } from './config.js';
import { sourceHash } from './fetch.js';
import { log } from './logger.js';
import { assertImageDimensions, isUsableImageUrl, titleSimilarity } from './quality.js';

const auth = `Basic ${Buffer.from(`${config.wpUsername}:${config.wpAppPassword}`).toString('base64')}`;
const categoryIds = new Map();
const runImageHashes = new Set();
const ai = new OpenAI({ apiKey: config.openaiApiKey });

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[char]);
}

async function validateEditorialImage(article, image) {
  const response = await ai.responses.create({
    model: config.openaiModel,
    input: [{
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: [
            'Bir kültür-sanat haber editörü olarak başlık ile görsel arasındaki ilişkiyi denetle.',
            'Görsel yalnız habere doğrudan ilişkin fotoğraf, illüstrasyon veya etkinlik afişiyse kullanılabilir.',
            'QR kod, logo, genel haber kartı, site ekran görüntüsü, boş/soyut yer tutucu ya da başlıkla ilgisiz görseli reddet.',
            'Kare/dikey QR kodları, yayınevi/medya logolu kimlik kartlarını, internet sitesi ekran görüntülerini ve başka bir habere de uyabilecek jenerik görselleri reddet.',
            'description alanına görselde gerçekten görülenleri, 8-18 kelimelik doğal Türkçe alternatif metin olarak yaz.',
            'kind alanı editorial-photo, illustration veya event-poster olmalı.',
            'Haberi yeniden kategorize etme; yalnız görselin doğrudan ilişkisini değerlendir.',
            'Yalnız şu JSON biçiminde yanıt ver: {"usable":true,"kind":"editorial-photo","description":"kısa görsel açıklaması","reason":"kısa gerekçe"}',
            `Başlık: ${article.title}`,
            `Mevcut kategori: ${article.category}`
          ].join('\n')
        },
        { type: 'input_image', image_url: `data:${image.contentType};base64,${image.buffer.toString('base64')}`, detail: 'low' }
      ]
    }]
  });
  const raw = response.output_text.replace(/^\`\`\`json\s*|\s*\`\`\`$/g, '').trim();
  const result = JSON.parse(raw);
  if (result.usable !== true) throw new Error(`Kaynak görsel editoryal olarak uygun değil: ${result.reason ?? 'gerekçe belirtilmedi'}`);
  if (!['editorial-photo', 'illustration', 'event-poster'].includes(result.kind)) {
    throw new Error(`Kaynak görsel türü uygun değil: ${result.kind ?? 'belirlenemedi'}.`);
  }
  return { kind: result.kind, altText: String(result.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 180) };
}

export function canonicalImageUrl(value = '') {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    return url.href;
  } catch {
    return String(value).trim();
  }
}

async function wp(path, options = {}) {
  const response = await fetch(`${config.wpBaseUrl}/wp-json${path}`, {
    ...options,
    headers: { authorization: auth, 'content-type': 'application/json', ...(options.headers ?? {}) }
  });
  if (!response.ok) throw new Error(`WordPress ${response.status}: ${(await response.text()).slice(0, 700)}`);
  return response.status === 204 ? null : response.json();
}

export async function knownHashes(hashes) {
  if (hashes.length === 0) return [];
  const known = [];
  for (let offset = 0; offset < hashes.length; offset += 500) {
    const result = await wp('/sanatcin/v1/known', { method: 'POST', body: JSON.stringify({ hashes: hashes.slice(offset, offset + 500) }) });
    known.push(...(result.known ?? []));
  }
  return known;
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
  const candidates = article.sourceImageUrls?.length ? article.sourceImageUrls : [article.sourceImageUrl];
  const errors = [];
  for (const imageUrl of candidates) {
    if (!isUsableImageUrl(imageUrl)) continue;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      const response = await fetch(imageUrl, {
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
      const dimensions = assertImageDimensions(buffer, contentType);
      const imageHash = crypto.createHash('sha256').update(buffer).digest('hex');
      const imageSourceHash = sourceHash(canonicalImageUrl(imageUrl));
      if (runImageHashes.has(imageHash)) throw new Error('Aynı görsel bu çalışmada başka bir haber için zaten kullanıldı.');
      const existing = await wp(`/sanatcin/v1/image-known?hash=${encodeURIComponent(imageHash)}&source_hash=${encodeURIComponent(imageSourceHash)}`);
      if (existing.known) throw new Error('Aynı görsel daha önce başka bir haberde kullanılmış.');
      const image = { buffer, contentType: contentType.split(';')[0], extension, imageHash, imageSourceHash, sourceUrl: imageUrl, dimensions };
      const validation = await validateEditorialImage(article, image);
      image.kind = validation.kind;
      image.altText = validation.altText;
      return image;
    } catch (error) {
      errors.push(error.message);
    } finally {
      clearTimeout(timer);
    }
  }
  log('warn', 'Haber uygun görsel bulunamadığı için görselsiz devam edecek', {
    source: article.source.id,
    url: article.url,
    attempted: candidates.filter(Boolean).length,
    errors: errors.slice(0, 5)
  });
  return null;
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
    body: JSON.stringify({
      title: article.title,
      alt_text: image.altText || article.title,
      caption: `Görsel: ${article.source.name}`,
      description: `Kaynak görsel: ${image.sourceUrl}`
    })
  });
  runImageHashes.add(image.imageHash);
  return media.id;
}

export async function publishArticle(article, preparedImage = undefined) {
  const sourceUrl = new URL(article.url).href;
  const sourceLine = `<aside class="sanatcin-source"><strong>Kaynak:</strong> <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(article.source.name)}</a><span> · Kaynak haber temel alınarak Türkçe yeniden yazıldı</span></aside>`;
  const category = await categoryId(article.category);
  const image = preparedImage === undefined ? await prepareFeaturedImage(article) : preparedImage;
  if (config.dryRun) {
    if (image) runImageHashes.add(image.imageHash);
    return {
      id: null,
      link: null,
      dryRun: true,
      payload: { title: article.title, excerpt: article.excerpt, status: config.publishStatus, categories: [category], sourceImageUrl: image?.sourceUrl ?? null, imageHash: image?.imageHash ?? null }
    };
  }

  const featuredMedia = image ? await uploadFeaturedImage(article, image) : null;
  const payload = {
    title: article.title,
    excerpt: article.excerpt,
    content: `${article.bodyHtml}\n${sourceLine}`,
    status: 'draft',
    categories: [category],
    meta: {
      sanatcin_source_url: article.url,
      sanatcin_source_name: article.source.name,
      sanatcin_source_hash: sourceHash(article.url),
      sanatcin_image_hash: image?.imageHash ?? '',
      sanatcin_image_source_hash: image?.imageSourceHash ?? '',
      sanatcin_image_source_url: image?.sourceUrl ?? '',
      sanatcin_image_description: image?.altText ?? '',
      sanatcin_score: Math.round(article.score),
      sanatcin_original_title: article.originalTitle,
      sanatcin_editorial_mode: article.editorialMode
    }
  };
  if (featuredMedia) payload.featured_media = featuredMedia;
  let post = await wp('/wp/v2/posts', { method: 'POST', body: JSON.stringify(payload) });
  if (config.publishStatus === 'publish') {
    post = await wp(`/wp/v2/posts/${post.id}`, { method: 'POST', body: JSON.stringify({ status: 'publish' }) });
  }
  return post;
}

function decodeTitle(value = '') {
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&(?:amp|#038);/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function assertNoSimilarPublishedTitle(title) {
  const posts = await wp('/wp/v2/posts?status=publish&per_page=100&orderby=date&order=desc&_fields=id,link,title');
  for (const post of posts) {
    const existingTitle = decodeTitle(post.title?.rendered);
    const similarity = titleSimilarity(title, existingTitle);
    if (similarity.shared >= 4 && similarity.score >= 0.62) {
      throw new Error(`Benzer haber daha önce yayımlanmış: "${existingTitle}" (${Math.round(similarity.score * 100)}%).`);
    }
  }
}
