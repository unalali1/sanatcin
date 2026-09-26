import crypto from 'node:crypto';
import OpenAI from 'openai';
import { config } from './config.js';
import { sourceHash } from './fetch.js';
import { log } from './logger.js';
import { assertImageDimensions, detectImageContentType, isUsableImageUrl } from './quality.js';

const auth = `Basic ${Buffer.from(`${config.wpUsername}:${config.wpAppPassword}`).toString('base64')}`;
const ai = new OpenAI({
  apiKey: config.openaiApiKey,
  timeout: config.aiRequestTimeoutMs,
  maxRetries: config.aiMaxRetries
});

const runSecondaryHashes = new Set();
const MIN_WIDTH = Number.parseInt(process.env.SECONDARY_IMAGE_MIN_WIDTH ?? '900', 10) || 900;
const MIN_HEIGHT = Number.parseInt(process.env.SECONDARY_IMAGE_MIN_HEIGHT ?? '500', 10) || 500;
const MIN_RELEVANCE = Number.parseInt(process.env.SECONDARY_IMAGE_MIN_RELEVANCE ?? '70', 10) || 70;
const MIN_QUALITY = Number.parseInt(process.env.SECONDARY_IMAGE_MIN_QUALITY ?? '65', 10) || 65;
const MAX_SIMILARITY = Number.parseInt(process.env.SECONDARY_IMAGE_MAX_SIMILARITY ?? '85', 10) || 85;
const MIN_COMPLEMENT = Number.parseInt(process.env.SECONDARY_IMAGE_MIN_COMPLEMENT ?? '55', 10) || 55;
const REVIEW_LIMIT = Math.max(1, Math.min(4, Number.parseInt(process.env.SECONDARY_IMAGE_REVIEW_LIMIT ?? '3', 10) || 3));

function clampScore(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[char]);
}

function canonicalImageUrl(value = '') {
  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    return url.href;
  } catch {
    return String(value).trim();
  }
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

async function alreadyUsedImage(imageHash, imageSourceHash, signal) {
  if (runSecondaryHashes.has(imageHash)) return true;
  const primaryKnown = await wp(`/sanatcin/v1/image-known?hash=${encodeURIComponent(imageHash)}&source_hash=${encodeURIComponent(imageSourceHash)}`, { signal });
  if (primaryKnown.known) return true;

  // İkinci görseller post meta alanlarında tutulmadığı için medya slug'ını da kontrol et.
  // Her yüklenen görselin dosya adı hash tabanlı olduğundan bu kontrol günler arası tekrarı önler.
  const mediaSlug = `sanatcin-${imageHash.slice(0, 20)}`;
  const media = await wp(`/wp/v2/media?slug=${encodeURIComponent(mediaSlug)}&per_page=1&_fields=id`, { signal });
  return Array.isArray(media) && media.length > 0;
}

async function loadCandidate(article, imageUrl, signal) {
  const response = await fetch(imageUrl, {
    redirect: 'follow',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMs)])
      : AbortSignal.timeout(config.requestTimeoutMs),
    headers: {
      'user-agent': config.userAgent,
      accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8',
      referer: article.url
    }
  });
  if (!response.ok) throw new Error(`İkinci kaynak görsel indirilemedi: HTTP ${response.status}`);
  const declaredContentType = response.headers.get('content-type') ?? '';
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = detectImageContentType(buffer, declaredContentType);
  const extension = extensionFor(contentType);
  if (!extension) throw new Error(`İkinci görsel türü desteklenmiyor: ${declaredContentType || 'bilinmiyor'}`);
  if (buffer.length < 12_000) throw new Error('İkinci görsel güvenilir kalite için çok küçük.');
  if (buffer.length > 10_000_000) throw new Error('İkinci görsel 10 MB sınırını aşıyor.');

  const dimensions = assertImageDimensions(buffer, contentType, {
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    minRatio: 0.75,
    maxRatio: 3.2
  });
  const imageHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const imageSourceHash = sourceHash(canonicalImageUrl(imageUrl));
  if (await alreadyUsedImage(imageHash, imageSourceHash, signal)) {
    throw new Error('İkinci görsel daha önce kullanılmış.');
  }

  const captionKey = canonicalImageUrl(imageUrl);
  return {
    buffer,
    contentType,
    extension,
    imageHash,
    imageSourceHash,
    sourceUrl: imageUrl,
    caption: article.sourceImageCaptions?.[captionKey] || article.sourceImageCaptions?.[imageUrl] || '',
    dimensions,
    origin: 'source-editorial'
  };
}

async function evaluatePair(article, primary, candidate, signal) {
  const response = await ai.responses.create({
    model: config.openaiSelectionModel,
    input: [{
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: [
            'SanatÇin için aynı haberde kullanılacak iki görseli birlikte değerlendir.',
            'Birinci görsel kapak görselidir. İkinci görsel haber gövdesine eklenmesi düşünülen adaydır.',
            'İkinci görsel logo, QR kod, site ekran görüntüsü, jenerik kurumsal kart, watermark ağırlıklı görsel veya haberle zayıf ilişkiliyse usable=false ver.',
            'relevanceScore 0-100: ikinci görselin bu habere doğrudan ilişkisi.',
            'qualityScore 0-100: ikinci görselin kompozisyonu, estetik gücü, okunabilirliği ve editoryal değeri.',
            'similarityScore 0-100: iki görselin aynı anı, aynı kompozisyonu veya çok benzer kadrajı gösterme derecesi. 100 neredeyse aynı görsel demektir.',
            'complementaryScore 0-100: ikinci görselin farklı eser, kişi, mekân detayı, performans anı veya başka yeni görsel bilgi katma derecesi.',
            'useTogether yalnız ikinci görsel habere gerçek görsel çeşitlilik katıyorsa true olsun.',
            'description ikinci görsel için 8-18 kelimelik doğal Türkçe alternatif metin olsun.',
            'captionTr alanına yalnız kaynak fotoğraf altyazısı varsa tarih/yer/kişi ve kaynak bilgisini koruyarak doğal Türkçeye çevir; altyazı yoksa boş bırak.',
            'Yalnız şu JSON biçiminde yanıt ver: {"usable":true,"useTogether":true,"relevanceScore":82,"qualityScore":76,"similarityScore":30,"complementaryScore":84,"scene":"artifact","description":"...","captionTr":"...","reason":"..."}',
            `Başlık: ${article.title}`,
            `Spot: ${article.excerpt}`,
            `Kategori: ${article.category}`,
            `Kaynak fotoğraf altyazısı: ${candidate.caption || 'yok'}`,
            `İkinci görsel boyutu: ${candidate.dimensions.width}x${candidate.dimensions.height}`
          ].join('\n')
        },
        { type: 'input_image', image_url: `data:${primary.contentType};base64,${primary.buffer.toString('base64')}`, detail: 'low' },
        { type: 'input_image', image_url: `data:${candidate.contentType};base64,${candidate.buffer.toString('base64')}`, detail: 'low' }
      ]
    }]
  }, { signal });
  const raw = response.output_text.replace(/^```json\s*|\s*```$/g, '').trim();
  const result = JSON.parse(raw);
  if (result.usable !== true) throw new Error(`İkinci görsel editoryal olarak uygun değil: ${result.reason ?? 'gerekçe yok'}`);
  return {
    ...candidate,
    useTogether: result.useTogether === true,
    relevanceScore: clampScore(result.relevanceScore),
    qualityScore: clampScore(result.qualityScore),
    similarityScore: clampScore(result.similarityScore, 100),
    complementaryScore: clampScore(result.complementaryScore),
    scene: String(result.scene ?? 'other').slice(0, 40),
    altText: String(result.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 180),
    captionTr: String(result.captionTr ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
    reason: String(result.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
  };
}

export function secondaryCandidatePassesThreshold(candidate) {
  return Boolean(candidate)
    && Number(candidate.dimensions?.width) >= MIN_WIDTH
    && Number(candidate.dimensions?.height) >= MIN_HEIGHT
    && Number(candidate.relevanceScore) >= MIN_RELEVANCE
    && Number(candidate.qualityScore) >= MIN_QUALITY;
}

export function insertAfterParagraph(html, insertion, paragraphNumber = 2) {
  const source = String(html ?? '');
  const fragment = String(insertion ?? '');
  if (!fragment) return source;
  const regex = /<\/p\s*>/giu;
  let match;
  let count = 0;
  while ((match = regex.exec(source)) !== null) {
    count += 1;
    if (count === paragraphNumber) {
      const position = match.index + match[0].length;
      return `${source.slice(0, position)}\n${fragment}\n${source.slice(position)}`;
    }
  }
  return `${source}\n${fragment}`;
}

function sourceCaption(article, image) {
  return image?.captionTr || image?.caption || `Görsel: ${article.source?.imageCredit || article.source?.name || 'Kaynak'}`;
}

function inlineFigure(article, image, media) {
  const caption = sourceCaption(article, image);
  return [
    '<figure class="wp-block-image size-large sanatcin-secondary-image">',
    `<img src="${escapeHtml(media.source_url)}" alt="${escapeHtml(image.altText || article.title)}" class="wp-image-${media.id}" loading="lazy" decoding="async" />`,
    `<figcaption class="wp-element-caption"><a href="${escapeHtml(article.url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(caption)}</a></figcaption>`,
    '</figure>'
  ].join('');
}

async function uploadSecondaryImage(article, postId, image, signal) {
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
      title: `${article.title} — ikinci görsel`,
      alt_text: image.altText || article.title,
      caption: sourceCaption(article, image),
      description: `Kaynak görsel: ${canonicalImageUrl(image.sourceUrl)}`,
      post: postId
    }),
    signal
  });
  runSecondaryHashes.add(image.imageHash);
  return media;
}

function uniqueCandidateUrls(article, primaryImage) {
  const primaryKey = canonicalImageUrl(primaryImage?.sourceUrl ?? '');
  const seen = new Set();
  const result = [];
  const rawUrls = article.sourceImageUrls?.length ? article.sourceImageUrls : [article.sourceImageUrl];
  for (const rawUrl of rawUrls) {
    if (!isUsableImageUrl(rawUrl)) continue;
    const key = canonicalImageUrl(rawUrl);
    if (!key || key === primaryKey || seen.has(key)) continue;
    seen.add(key);
    result.push(rawUrl);
    if (result.length >= 6) break;
  }
  return result;
}

async function selectSecondaryImage(article, primaryImage, signal) {
  if (!sourceImageReuseAllowed(article)) return null;
  const urls = uniqueCandidateUrls(article, primaryImage);
  if (!urls.length) return null;

  const reviewed = [];
  const errors = [];
  let attempted = 0;
  for (const imageUrl of urls) {
    if (attempted >= REVIEW_LIMIT) break;
    attempted += 1;
    try {
      const loaded = await loadCandidate(article, imageUrl, signal);
      const evaluated = await evaluatePair(article, primaryImage, loaded, signal);
      if (!secondaryCandidatePassesThreshold(evaluated)) {
        errors.push(`Kalite/ilişki eşiği altı: ${imageUrl}`);
        continue;
      }
      if (!evaluated.useTogether || evaluated.similarityScore > MAX_SIMILARITY || evaluated.complementaryScore < MIN_COMPLEMENT) {
        errors.push(`Ana görsele fazla benzer veya tamamlayıcılığı düşük: ${imageUrl}`);
        continue;
      }
      const score = Math.round((
        evaluated.qualityScore * 0.45
        + evaluated.relevanceScore * 0.25
        + evaluated.complementaryScore * 0.30
        - Math.max(0, evaluated.similarityScore - 50) * 0.12
      ) * 10) / 10;
      reviewed.push({ ...evaluated, secondaryScore: score });
    } catch (error) {
      errors.push(error.message);
    }
  }

  const selected = reviewed.sort((left, right) => right.secondaryScore - left.secondaryScore)[0] ?? null;
  if (!selected) {
    log('info', 'Uygun ikinci görsel bulunamadı; haber tek görselle korunacak', {
      source: article.source?.id,
      candidates: urls.length,
      attempted,
      errors: errors.slice(0, 5)
    });
    return null;
  }
  log('info', 'Tamamlayıcı ikinci görsel seçildi', {
    source: article.source?.id,
    dimensions: `${selected.dimensions.width}x${selected.dimensions.height}`,
    relevanceScore: selected.relevanceScore,
    qualityScore: selected.qualityScore,
    similarityScore: selected.similarityScore,
    complementaryScore: selected.complementaryScore,
    secondaryScore: selected.secondaryScore,
    scene: selected.scene,
    attempted
  });
  return selected;
}

export async function attachSecondaryImage(article, primaryImage, post, { signal } = {}) {
  if (config.dryRun || !post?.id || !primaryImage?.buffer) {
    return { attached: false, reason: config.dryRun ? 'dry-run' : 'missing-post-or-primary' };
  }
  const selected = await selectSecondaryImage(article, primaryImage, signal);
  if (!selected) return { attached: false, reason: 'no-qualified-secondary-image' };

  const media = await uploadSecondaryImage(article, post.id, selected, signal);
  const current = await wp(`/wp/v2/posts/${post.id}?context=edit&_fields=id,content`, { signal });
  const rawContent = current.content?.raw ?? '';
  if (!rawContent) throw new Error('İkinci görsel eklenecek haber gövdesi WordPress’ten okunamadı.');
  const figure = inlineFigure(article, selected, media);
  const content = insertAfterParagraph(rawContent, figure, 2);
  await wp(`/wp/v2/posts/${post.id}`, {
    method: 'POST',
    body: JSON.stringify({ content }),
    signal
  });

  return {
    attached: true,
    mediaId: media.id,
    imageUrl: media.source_url,
    sourceUrl: selected.sourceUrl,
    relevanceScore: selected.relevanceScore,
    qualityScore: selected.qualityScore,
    similarityScore: selected.similarityScore,
    complementaryScore: selected.complementaryScore,
    secondaryScore: selected.secondaryScore,
    scene: selected.scene
  };
}
