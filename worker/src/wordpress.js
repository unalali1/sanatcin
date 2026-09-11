import crypto from 'node:crypto';
import OpenAI from 'openai';
import { config } from './config.js';
import { sourceHash } from './fetch.js';
import { log } from './logger.js';
import { assertImageDimensions, isUsableImageUrl, titleSimilarity } from './quality.js';

const auth = `Basic ${Buffer.from(`${config.wpUsername}:${config.wpAppPassword}`).toString('base64')}`;
const categoryIds = new Map();
const runImageHashes = new Set();
const ai = new OpenAI({
  apiKey: config.openaiApiKey,
  timeout: config.aiRequestTimeoutMs,
  maxRetries: config.aiMaxRetries
});

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[char]);
}

async function validateEditorialImage(article, image, signal) {
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
  }, { signal });
  const raw = response.output_text.replace(/^\`\`\`json\s*|\s*\`\`\`$/g, '').trim();
  const result = JSON.parse(raw);
  if (result.usable !== true) throw new Error(`Görsel editoryal olarak uygun değil: ${result.reason ?? 'gerekçe belirtilmedi'}`);
  if (!['editorial-photo', 'illustration', 'event-poster'].includes(result.kind)) {
    throw new Error(`Görsel türü uygun değil: ${result.kind ?? 'belirlenemedi'}.`);
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
  const { headers = {}, signal = AbortSignal.timeout(config.requestTimeoutMs), ...requestOptions } = options;
  const response = await fetch(`${config.wpBaseUrl}/wp-json${path}`, {
    ...requestOptions,
    signal,
    headers: { authorization: auth, 'content-type': 'application/json', ...headers }
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

async function categoryId(slug, signal) {
  if (categoryIds.has(slug)) return categoryIds.get(slug);
  const categories = await wp(`/wp/v2/categories?slug=${encodeURIComponent(slug)}`, { signal });
  if (!categories.length) throw new Error(`WordPress kategorisi bulunamadı: ${slug}`);
  categoryIds.set(slug, categories[0].id);
  return categories[0].id;
}

function extensionFor(contentType) {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime] ?? null;
}

function sourceImageReuseAllowed(article) {
  if (config.sourceImagePolicy === 'allow-all') return true;
  return article.source?.imageReuse === 'permitted'
    && Boolean(article.source?.imageCredit)
    && Boolean(article.source?.imageLicenseUrl);
}

function visualPrompt(article) {
  const facts = article.factSheet?.facts?.slice(0, 5).join(' | ') ?? '';
  return [
    'Create one original landscape editorial illustration for a Turkish culture and lifestyle news publication.',
    `Article category: ${article.category}.`,
    `Headline: ${article.title}.`,
    `Summary: ${article.excerpt}.`,
    facts ? `Verified visual context: ${facts}.` : '',
    'Use a refined contemporary editorial-art style with realistic materials, natural light and a clear central subject.',
    'The image must communicate the topic without pretending to be documentary evidence of the exact event.',
    'Do not depict a recognizable real person. Do not add words, letters, logos, watermarks, flags, UI, frames or decorative borders.',
    'Avoid generic stock-photo compositions, split screens, collages and repeated motifs. Compose for a 3:2 news card with safe crop space.'
  ].filter(Boolean).join('\n');
}

async function generateEditorialImage(article, signal) {
  const result = await ai.images.generate({
    model: config.openaiImageModel,
    prompt: visualPrompt(article),
    size: '1536x1024',
    quality: config.openaiImageQuality,
    output_format: 'jpeg'
  }, { signal });
  const encoded = result.data?.[0]?.b64_json;
  if (!encoded) throw new Error('OpenAI görsel üretimi boş sonuç döndürdü.');
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length < 12_000) throw new Error('Üretilen görsel güvenilir kalite için çok küçük.');
  const contentType = 'image/jpeg';
  const dimensions = assertImageDimensions(buffer, contentType);
  const imageHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const imageSourceHash = sourceHash(`openai:${article.url}`);
  if (runImageHashes.has(imageHash)) throw new Error('Üretilen görsel bu çalışmada başka bir haber için zaten kullanıldı.');
  const existing = await wp(`/sanatcin/v1/image-known?hash=${encodeURIComponent(imageHash)}&source_hash=${encodeURIComponent(imageSourceHash)}`, { signal });
  if (existing.known) throw new Error('Bu haber için üretilen görsel daha önce kullanılmış.');
  const image = {
    buffer,
    contentType,
    extension: 'jpg',
    imageHash,
    imageSourceHash,
    sourceUrl: '',
    dimensions,
    origin: 'openai-generated',
    model: config.openaiImageModel,
    kind: 'illustration'
  };
  const validation = await validateEditorialImage(article, image, signal);
  image.kind = 'illustration';
  image.altText = validation.altText;
  return image;
}

export async function prepareFeaturedImage(article, { signal } = {}) {
  const candidates = sourceImageReuseAllowed(article)
    ? (article.sourceImageUrls?.length ? article.sourceImageUrls : [article.sourceImageUrl])
    : [];
  const errors = [];
  for (const imageUrl of candidates) {
    if (!isUsableImageUrl(imageUrl)) continue;
    try {
      const response = await fetch(imageUrl, {
      redirect: 'follow',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMs)])
        : AbortSignal.timeout(config.requestTimeoutMs),
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
      const existing = await wp(`/sanatcin/v1/image-known?hash=${encodeURIComponent(imageHash)}&source_hash=${encodeURIComponent(imageSourceHash)}`, { signal });
      if (existing.known) throw new Error('Aynı görsel daha önce başka bir haberde kullanılmış.');
      const image = { buffer, contentType: contentType.split(';')[0], extension, imageHash, imageSourceHash, sourceUrl: imageUrl, dimensions, origin: 'licensed-source' };
      const validation = await validateEditorialImage(article, image, signal);
      image.kind = validation.kind;
      image.altText = validation.altText;
      return image;
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (config.generateFallbackImages) {
    log('info', 'Uygun ve yeniden kullanılabilir kaynak görseli bulunamadı; özgün editoryal illüstrasyon üretilecek', {
      source: article.source.id,
      url: article.url,
      sourceImagePolicy: config.sourceImagePolicy,
      attempted: candidates.filter(Boolean).length,
      errors: errors.slice(0, 5)
    });
    return generateEditorialImage(article, signal);
  }
  log('error', 'Haber için zorunlu görsel hazırlanamadı', {
    source: article.source.id,
    url: article.url,
    attempted: candidates.filter(Boolean).length,
    errors: errors.slice(0, 5)
  });
  throw new Error('Haber için lisansı ve uygunluğu doğrulanmış bir görsel hazırlanamadı.');
}

async function uploadFeaturedImage(article, image, signal) {
  const filename = `sanatcin-${image.imageHash.slice(0, 20)}.${image.extension}`;
  const media = await wp('/wp/v2/media', {
    method: 'POST',
    body: image.buffer,
    headers: {
      'content-type': image.contentType,
      'content-disposition': `attachment; filename="${filename}"`
    },
    signal
  });
  await wp(`/wp/v2/media/${media.id}`, {
    method: 'POST',
    body: JSON.stringify({
      title: article.title,
      alt_text: image.altText || article.title,
      caption: image.origin === 'openai-generated'
        ? 'OpenAI ile üretilmiş temsili editoryal illüstrasyon.'
        : `Görsel: ${article.source.imageCredit || article.source.name}`,
      description: image.origin === 'openai-generated'
        ? 'Bu görsel haberin konusu için yapay zekâ ile üretilmiş temsili bir illüstrasyondur.'
        : `Kaynak görsel: ${image.sourceUrl}`
    }),
    signal
  });
  runImageHashes.add(image.imageHash);
  return media.id;
}

export async function publishArticle(article, preparedImage = undefined, { signal } = {}) {
  const sourceUrl = new URL(article.url).href;
  const sourceLine = `<aside class="sanatcin-source"><strong>Kaynak:</strong> <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(article.source.name)}</a><span> · Kaynak haber temel alınarak Türkçe yeniden yazıldı</span></aside>`;
  const category = await categoryId(article.category, signal);
  const image = preparedImage === undefined ? await prepareFeaturedImage(article, { signal }) : preparedImage;
  if (!image) throw new Error('Öne çıkan görsel zorunludur; haber yayımlanmadı.');
  if (config.dryRun) {
    if (image) runImageHashes.add(image.imageHash);
    return {
      id: null,
      link: null,
      dryRun: true,
      payload: { title: article.title, excerpt: article.excerpt, status: config.publishStatus, categories: [category], imageOrigin: image.origin, sourceImageUrl: image.sourceUrl || null, imageHash: image.imageHash }
    };
  }

  const featuredMedia = image ? await uploadFeaturedImage(article, image, signal) : null;
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
      sanatcin_image_origin: image?.origin ?? '',
      sanatcin_image_kind: image?.kind ?? '',
      sanatcin_ai_image_model: image?.model ?? '',
      sanatcin_score: Math.round(article.score),
      sanatcin_original_title: article.originalTitle,
      sanatcin_editorial_mode: article.editorialMode
    }
  };
  payload.featured_media = featuredMedia;
  let post = await wp('/wp/v2/posts', { method: 'POST', body: JSON.stringify(payload), signal });
  if (config.publishStatus === 'publish') {
    post = await wp(`/wp/v2/posts/${post.id}`, { method: 'POST', body: JSON.stringify({ status: 'publish' }), signal });
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

export async function assertNoSimilarPublishedTitle(title, { signal } = {}) {
  const posts = await wp('/wp/v2/posts?status=publish&per_page=100&orderby=date&order=desc&_fields=id,link,title', { signal });
  for (const post of posts) {
    const existingTitle = decodeTitle(post.title?.rendered);
    const similarity = titleSimilarity(title, existingTitle);
    if (similarity.shared >= 4 && similarity.score >= 0.62) {
      throw new Error(`Benzer haber daha önce yayımlanmış: "${existingTitle}" (${Math.round(similarity.score * 100)}%).`);
    }
  }
}
