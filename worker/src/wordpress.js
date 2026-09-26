import crypto from 'node:crypto';
import OpenAI from 'openai';
import { config } from './config.js';
import { sourceHash } from './fetch.js';
import { log } from './logger.js';
import { assertImageDimensions, detectImageContentType, isUsableImageUrl, likelyDuplicateTitles, titleSimilarity, heroImageEligible, selectRelatedPosts } from './quality.js';
import { SITE_PAGES } from './site-content.js';

const auth = `Basic ${Buffer.from(`${config.wpUsername}:${config.wpAppPassword}`).toString('base64')}`;
const categoryIds = new Map();
const runImageHashes = new Set();
const runVisualScenes = new Map();
const ai = new OpenAI({
  apiKey: config.openaiApiKey,
  timeout: config.aiRequestTimeoutMs,
  maxRetries: config.aiMaxRetries
});

const VISUAL_SCENES = new Set([
  'conference', 'runway', 'portrait', 'artifact', 'architecture', 'performance',
  'exhibition', 'street', 'food', 'illustration', 'poster', 'other'
]);

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[char]);
}

function clampScore(value, fallback = 50) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : fallback;
}

function resolutionPreference(dimensions = {}) {
  const width = Number(dimensions.width) || 0;
  const height = Number(dimensions.height) || 0;
  if (width >= 1600 && height >= 900) return 8;
  if (width >= 1200 && height >= 675) return 5;
  if (width >= 900 && height >= 500) return 2;
  return 0;
}


function sceneDiversityPenalty(scene) {
  const count = runVisualScenes.get(scene) ?? 0;
  if (count < 2) return 0;
  return scene === 'conference' ? 14 : 8;
}

function noteVisualScene(scene) {
  const normalized = VISUAL_SCENES.has(scene) ? scene : 'other';
  runVisualScenes.set(normalized, (runVisualScenes.get(normalized) ?? 0) + 1);
}

async function validateEditorialImage(article, image, signal) {
  const generatedForRealPerson = article.realPersonCentered === true && image.origin === 'openai-generated';
  const response = await ai.responses.create({
    model: config.openaiSelectionModel,
    input: [{
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: [
            'Bir kültür-sanat haber editörü olarak başlık ile görsel arasındaki ilişkiyi ve görsel kalitesini denetle.',
            'Görsel yalnız habere doğrudan ilişkin fotoğraf, illüstrasyon veya etkinlik afişiyse usable=true olabilir.',
            'QR kod, logo, genel haber kartı, site ekran görüntüsü, boş/soyut yer tutucu ya da başlıkla ilgisiz görseli reddet.',
            'Kare/dikey QR kodları, yayınevi/medya logolu kimlik kartlarını, internet sitesi ekran görüntülerini ve başka bir habere de uyabilecek tamamen jenerik görselleri reddet.',
            generatedForRealPerson
              ? 'Bu haber belirli bir gerçek kişiyi merkezine alıyor ve bu görsel AI üretimidir. Görselde insan, insan yüzü, beden, siluet veya gerçek kişiyi taklit eden portre varsa usable=false ver. Yalnız ürün, obje, mekân, etkinlik veya soyut olmayan konu ayrıntıları kabul edilebilir.'
              : 'Gerçek kişileri gösteren kaynak fotoğraflar ancak haberle doğrudan ilişkiliyse kabul edilebilir; AI illüstrasyonlarda gerçek bir kişiyi taklit eden yüzleri reddet.',
            'visualScore alanını 0-100 ver. Haberle doğrudan ilişki %35, editoryal/estetik güç %25, ana sayfa küçük kartında etkileyicilik %20, kompozisyon ve okunabilirlik %20 ağırlığında düşün.',
            'Konferans salonunda uzaktan çekilmiş panel/kürsü fotoğrafı genellikle düşük-orta puan almalı; eser, sanatçı, performans, mekân, zanaat detayı veya güçlü atmosfer görüntüsü daha yüksek puan alabilir.',
            'hasHuman görselde herhangi bir insan, yüz, beden ya da belirgin insan silueti varsa true olsun.',
            'cropSafe görselin 16:10 ve 3:2 haber kartlarında ana özne kesilmeden merkezden kırpılmaya uygun olup olmadığını göstersin.',
            'description alanına görselde gerçekten görülenleri 8-18 kelimelik doğal Türkçe alternatif metin olarak yaz.',
            'captionTr alanına yalnız kaynak fotoğraf altyazısı varsa, tarih/yer/kişi ve kaynak bilgisini koruyan doğal Türkçe çevirisini yaz; altyazı yoksa boş bırak.',
            'kind alanı editorial-photo, illustration veya event-poster olmalı.',
            'scene alanı conference, runway, portrait, artifact, architecture, performance, exhibition, street, food, illustration, poster veya other değerlerinden biri olmalı.',
            'Haberi yeniden kategorize etme; yalnız görselin doğrudan ilişkisini ve editoryal gücünü değerlendir.',
            'Yalnız şu JSON biçiminde yanıt ver: {"usable":true,"kind":"editorial-photo","scene":"exhibition","visualScore":82,"hasHuman":false,"cropSafe":true,"description":"kısa görsel açıklaması","captionTr":"kaynak altyazısının Türkçesi veya boş dize","reason":"kısa gerekçe"}',
            `Başlık: ${article.title}`,
            `Spot: ${article.excerpt}`,
            `Mevcut kategori: ${article.category}`,
            `Gerçek kişi merkezli haber: ${article.realPersonCentered === true ? 'evet' : 'hayır'}`,
            `Görsel kökeni: ${image.origin ?? 'bilinmiyor'}`,
            `Kaynak fotoğraf altyazısı: ${image.caption || 'yok'}`,
            `Görsel boyutu: ${image.dimensions?.width ?? '?'}x${image.dimensions?.height ?? '?'}`
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
  const hasHuman = result.hasHuman === true;
  if (generatedForRealPerson && hasHuman) {
    throw new Error('Gerçek kişi merkezli haberde AI görsel insan figürü içeriyor; görsel güvenlik kapısından geçmedi.');
  }
  const scene = VISUAL_SCENES.has(result.scene) ? result.scene : 'other';
  return {
    kind: result.kind,
    scene,
    visualScore: clampScore(result.visualScore),
    hasHuman,
    cropSafe: result.cropSafe === true,
    altText: String(result.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 180),
    captionTr: String(result.captionTr ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
    reason: String(result.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
  };
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

const FAILED_CANDIDATE_STATE_SLUG = 'sanatcin-failed-candidates-state';

function normalizeFailedCandidateEntries(entries = []) {
  const cutoff = Date.now() - config.failedCandidateCacheHours * 3_600_000;
  const byUrl = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const url = String(entry?.url ?? '').trim();
    const failedAt = new Date(entry?.failedAt ?? 0).getTime();
    if (!url || !Number.isFinite(failedAt) || failedAt < cutoff) continue;
    const previous = byUrl.get(url);
    if (!previous || failedAt > new Date(previous.failedAt).getTime()) {
      byUrl.set(url, {
        url,
        failedAt: new Date(failedAt).toISOString(),
        code: String(entry?.code ?? 'SOURCE_EXTRACTION').slice(0, 80)
      });
    }
  }
  return [...byUrl.values()].sort((a, b) => new Date(b.failedAt) - new Date(a.failedAt)).slice(0, 300);
}

export async function loadFailedCandidateState({ signal } = {}) {
  try {
    const posts = await wp(`/wp/v2/posts?slug=${encodeURIComponent(FAILED_CANDIDATE_STATE_SLUG)}&status=draft&context=edit&per_page=1&_fields=id,content`, { signal });
    if (!posts.length) return [];
    const raw = posts[0]?.content?.raw ?? '';
    const parsed = JSON.parse(String(raw || '{}'));
    return normalizeFailedCandidateEntries(parsed.entries);
  } catch (error) {
    log('warn', 'Başarısız aday önbelleği okunamadı; önbelleksiz devam edilecek', {
      error: String(error?.message ?? error).slice(0, 350)
    });
    return [];
  }
}

export async function saveFailedCandidateState(entries, { signal } = {}) {
  const normalized = normalizeFailedCandidateEntries(entries);
  try {
    const posts = await wp(`/wp/v2/posts?slug=${encodeURIComponent(FAILED_CANDIDATE_STATE_SLUG)}&status=draft&context=edit&per_page=1&_fields=id`, { signal });
    const payload = {
      title: 'SanatÇin Failed Candidate State',
      slug: FAILED_CANDIDATE_STATE_SLUG,
      status: 'draft',
      content: JSON.stringify({ updatedAt: new Date().toISOString(), entries: normalized })
    };
    if (posts.length) {
      await wp(`/wp/v2/posts/${posts[0].id}`, { method: 'POST', body: JSON.stringify(payload), signal });
    } else {
      await wp('/wp/v2/posts', { method: 'POST', body: JSON.stringify(payload), signal });
    }
    return normalized;
  } catch (error) {
    log('warn', 'Başarısız aday önbelleği kaydedilemedi; yayın akışı etkilenmeyecek', {
      error: String(error?.message ?? error).slice(0, 350)
    });
    return normalized;
  }
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

function sourceImageCandidates(article) {
  const rawCandidates = sourceImageReuseAllowed(article)
    ? (article.sourceImageUrls?.length ? article.sourceImageUrls : [article.sourceImageUrl])
    : [];
  return [...new Set(rawCandidates.filter((value) => isUsableImageUrl(value)))].slice(0, 6);
}

function visualPrompt(article) {
  const facts = article.factSheet?.facts?.slice(0, 5).join(' | ') ?? '';
  const personRule = article.realPersonCentered === true
    ? 'This article is centered on a named real person. Do not depict any human figure, face, body, silhouette, portrait or lookalike. Represent the story only through relevant products, objects, venue, award, materials, workspace or event context.'
    : 'Do not depict a recognizable real person or imitate the appearance of any named person.';
  return [
    'Create one original landscape editorial illustration for a Turkish culture and lifestyle news publication.',
    `Article category: ${article.category}.`,
    `Headline: ${article.title}.`,
    `Summary: ${article.excerpt}.`,
    facts ? `Verified visual context: ${facts}.` : '',
    'Use a refined contemporary editorial-art style with realistic materials, natural light and a clear central subject.',
    'The image must communicate the topic without pretending to be documentary evidence of the exact event.',
    personRule,
    'Do not add words, letters, logos, watermarks, flags, UI, frames or decorative borders.',
    'Avoid generic stock-photo compositions, split screens, collages and repeated motifs. Compose for a 3:2 news card with generous safe crop space around the central subject.'
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
  image.scene = 'illustration';
  image.visualScore = validation.visualScore;
  image.altText = validation.altText;
  image.hasHuman = validation.hasHuman;
  image.cropSafe = validation.cropSafe;
  image.heroEligible = heroImageEligible(image.dimensions, image.cropSafe, image.scene, image.kind, image.visualScore);
  return image;
}

async function loadSourceImage(article, imageUrl, signal) {
  const response = await fetch(imageUrl, {
    redirect: 'follow',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMs)])
      : AbortSignal.timeout(config.requestTimeoutMs),
    headers: { 'user-agent': config.userAgent, accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8', referer: article.url }
  });
  if (!response.ok) throw new Error(`Kaynak görsel indirilemedi: HTTP ${response.status}`);
  const declaredContentType = response.headers.get('content-type') ?? '';
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = detectImageContentType(buffer, declaredContentType);
  const extension = extensionFor(contentType);
  if (!extension) throw new Error(`Desteklenmeyen görsel türü: ${declaredContentType || 'bilinmiyor'}`);
  if (buffer.length < 12_000) throw new Error('Kaynak görsel güvenilir kalite için çok küçük.');
  if (buffer.length > 10_000_000) throw new Error('Kaynak görsel 10 MB sınırını aşıyor.');
  const dimensions = assertImageDimensions(buffer, contentType, {
    minWidth: config.sourceImageMinWidth,
    minHeight: config.sourceImageMinHeight,
    minRatio: 0.75,
    maxRatio: 3.2
  });
  const imageHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const imageSourceHash = sourceHash(canonicalImageUrl(imageUrl));
  if (runImageHashes.has(imageHash)) throw new Error('Aynı görsel bu çalışmada başka bir haber için zaten kullanıldı.');
  const existing = await wp(`/sanatcin/v1/image-known?hash=${encodeURIComponent(imageHash)}&source_hash=${encodeURIComponent(imageSourceHash)}`, { signal });
  if (existing.known) throw new Error('Aynı görsel daha önce başka bir haberde kullanılmış.');
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

export async function preflightFeaturedImage(article, { signal } = {}) {
  const candidates = sourceImageCandidates(article);
  const errors = [];
  const loaded = [];
  for (const imageUrl of candidates) {
    try {
      loaded.push(await loadSourceImage(article, imageUrl, signal));
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (!loaded.length && !config.generateFallbackImages) {
    throw new Error(`Haber için kullanılabilir kaynak görseli bulunamadı: ${errors.slice(0, 3).join(' | ') || 'görsel adayı yok'}`);
  }
  log('info', 'Görsel ön kontrolü tamamlandı', {
    source: article.source.id,
    candidates: candidates.length,
    usableSourceImages: loaded.length,
    fallbackAvailable: config.generateFallbackImages,
    errors: errors.slice(0, 3)
  });
  return { candidates, loaded, errors };
}

export async function prepareFeaturedImage(article, { signal, preflight } = {}) {
  const prepared = preflight ?? await preflightFeaturedImage(article, { signal });
  const candidates = prepared.candidates ?? sourceImageCandidates(article);
  const errors = [...(prepared.errors ?? [])];
  const loaded = [...(prepared.loaded ?? [])];

  loaded.sort((left, right) => resolutionPreference(right.dimensions) - resolutionPreference(left.dimensions));
  let best = null;
  const reviewPool = loaded.slice(0, config.sourceImageReviewLimit);
  for (const image of reviewPool) {
    try {
      const validation = await validateEditorialImage(article, image, signal);
      const diversityPenalty = sceneDiversityPenalty(validation.scene);
      const cropPenalty = validation.cropSafe ? 0 : 8;
      const adjustedVisualScore = Math.max(0, Math.min(100,
        validation.visualScore + resolutionPreference(image.dimensions) - diversityPenalty - cropPenalty
      ));
      const reviewed = {
        ...image,
        kind: validation.kind,
        scene: validation.scene,
        visualScore: validation.visualScore,
        adjustedVisualScore,
        hasHuman: validation.hasHuman,
        cropSafe: validation.cropSafe,
        heroEligible: heroImageEligible(image.dimensions, validation.cropSafe, validation.scene, validation.kind, validation.visualScore),
        altText: validation.altText,
        visualReason: validation.reason
      };
      if (!best || reviewed.adjustedVisualScore > best.adjustedVisualScore) best = reviewed;
      if (reviewed.adjustedVisualScore >= 88 && reviewed.visualScore >= 80 && reviewed.cropSafe) break;
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (best) {
    noteVisualScene(best.scene);
    log('info', 'En güçlü kaynak görseli seçildi', {
      source: article.source.id,
      url: article.url,
      reviewed: reviewPool.length,
      dimensions: `${best.dimensions.width}x${best.dimensions.height}`,
      visualScore: best.visualScore,
      adjustedVisualScore: best.adjustedVisualScore,
      scene: best.scene,
      hasHuman: best.hasHuman,
      cropSafe: best.cropSafe,
      heroEligible: best.heroEligible
    });
    return best;
  }

  if (config.generateFallbackImages) {
    log('info', 'Yeterince güçlü kaynak görseli bulunamadı; özgün editoryal illüstrasyon denenecek', {
      source: article.source.id,
      url: article.url,
      sourceImagePolicy: config.sourceImagePolicy,
      attempted: candidates.length,
      reviewed: reviewPool.length,
      bestSourceScore: best?.visualScore ?? null,
      realPersonCentered: article.realPersonCentered === true,
      errors: errors.slice(0, 5)
    });
    try {
      const generated = await generateEditorialImage(article, signal);
      noteVisualScene(generated.scene);
      log('info', 'AI editoryal illüstrasyonu güvenlik kapısından geçti', {
        source: article.source.id,
        visualScore: generated.visualScore,
        hasHuman: generated.hasHuman,
        cropSafe: generated.cropSafe,
        heroEligible: generated.heroEligible,
        realPersonCentered: article.realPersonCentered === true
      });
      return generated;
    } catch (error) {
      errors.push(error.message);
      if (best) {
        noteVisualScene(best.scene);
        log('warn', 'Temsili illüstrasyon üretilemedi; kullanılabilir en iyi kaynak görseli korunacak', {
          source: article.source.id,
          visualScore: best.visualScore,
          scene: best.scene,
          error: error.message
        });
        return best;
      }
    }
  }

  if (best) {
    noteVisualScene(best.scene);
    log('warn', 'Kaynak görseli ideal kalite eşiğinin altında ancak yayını engellememek için en iyi uygun görsel kullanılacak', {
      source: article.source.id,
      visualScore: best.visualScore,
      scene: best.scene,
      cropSafe: best.cropSafe
    });
    return best;
  }

  log('error', 'Haber için zorunlu görsel hazırlanamadı', {
    source: article.source.id,
    url: article.url,
    attempted: candidates.length,
    errors: errors.slice(0, 5)
  });
  throw new Error('Haber için uygun bir kaynak görseli veya temsili illüstrasyon hazırlanamadı.');
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
        ? 'AI ile üretilmiş temsili editoryal illüstrasyon.'
        : (image.captionTr || image.caption || `Görsel: ${article.source.imageCredit || article.source.name}`),
      description: image.origin === 'openai-generated'
        ? 'Bu görsel haberin konusu için yapay zekâ ile üretilmiş temsili bir illüstrasyondur.'
        : `Kaynak görsel: ${image.sourceUrl}`
    }),
    signal
  });
  runImageHashes.add(image.imageHash);
  return media.id;
}

export async function syncSiteContent({ signal } = {}) {
  const pages = [];
  for (const page of SITE_PAGES) {
    const matches = await wp(`/wp/v2/pages?slug=${encodeURIComponent(page.slug)}&status=publish,draft,pending,private&_fields=id,status,slug`, { signal });
    const payload = {
      title: page.title,
      slug: page.slug,
      excerpt: page.excerpt,
      content: page.content,
      status: 'publish'
    };
    const existing = matches[0];
    const saved = existing
      ? await wp(`/wp/v2/pages/${existing.id}`, { method: 'POST', body: JSON.stringify(payload), signal })
      : await wp('/wp/v2/pages', { method: 'POST', body: JSON.stringify(payload), signal });
    pages.push({ id: saved.id, slug: page.slug, link: saved.link, action: existing ? 'updated' : 'created' });
  }

  const recentPosts = await wp('/wp/v2/posts?status=publish&per_page=100&orderby=date&order=desc&_fields=id,featured_media,meta', { signal });
  let aiCaptionsUpdated = 0;
  for (const post of recentPosts) {
    if (!post.featured_media || post.meta?.sanatcin_image_origin !== 'openai-generated') continue;
    await wp(`/wp/v2/media/${post.featured_media}`, {
      method: 'POST',
      body: JSON.stringify({
        caption: 'AI ile üretilmiş temsili editoryal illüstrasyon.',
        description: 'Bu görsel haberin konusu için AI ile üretilmiş temsili bir editoryal illüstrasyondur.'
      }),
      signal
    });
    aiCaptionsUpdated += 1;
  }
  return { pages, aiCaptionsUpdated };
}

async function buildInlineRelatedLinks(article, category, signal) {
  try {
    const posts = (await recentDuplicatePosts(signal)).filter((post) => !runPublishedPosts.has(post.id));
    const related = selectRelatedPosts(article.title, category, posts, 2);
    if (!related.length) return '';
    log('info', 'Haber içi bağlantılar hazırlandı', {
      source: article.source?.id ?? null,
      category: article.category,
      count: related.length,
      postIds: related.map((item) => item.id)
    });
    return `<aside class="sanatcin-inline-related"><strong>İlgili haberler:</strong> ${related
      .map((item) => `<a href="${escapeHtml(item.link)}">${escapeHtml(item.title)}</a>`)
      .join(' · ')}</aside>`;
  } catch (error) {
    log('warn', 'İç bağlantılar hazırlanamadı; haber bağlantısız yayımlanacak', {
      source: article.source?.id ?? null,
      category: article.category,
      error: String(error?.message ?? error).slice(0, 300)
    });
    return '';
  }
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
      payload: {
        title: article.title,
        excerpt: article.excerpt,
        status: config.publishStatus,
        categories: [category],
        imageOrigin: image.origin,
        sourceImageUrl: image.sourceUrl || null,
        imageHash: image.imageHash,
        imageCropSafe: image.cropSafe ?? null,
        imageHasHuman: image.hasHuman ?? null,
        realPersonCentered: article.realPersonCentered === true
      }
    };
  }

  const internalLinksHtml = await buildInlineRelatedLinks(article, category, signal);
  const featuredMedia = image ? await uploadFeaturedImage(article, image, signal) : null;
  const payload = {
    title: article.title,
    excerpt: article.excerpt,
    content: [article.bodyHtml, internalLinksHtml, sourceLine].filter(Boolean).join('\n'),
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
      sanatcin_editorial_mode: article.editorialMode,
      sanatcin_hero_eligible: image?.heroEligible ? 1 : 0
    }
  };
  payload.featured_media = featuredMedia;
  let post = await wp('/wp/v2/posts', { method: 'POST', body: JSON.stringify(payload), signal });
  if (config.publishStatus === 'publish') {
    post = await wp(`/wp/v2/posts/${post.id}`, { method: 'POST', body: JSON.stringify({ status: 'publish' }), signal });
  }
  if (config.publishStatus === 'publish') {
    runPublishedPosts.set(post.id, post);
    if (duplicatePostsCache) duplicatePostsCache = mergePublishedPosts(duplicatePostsCache);
  }
  return post;
}

const runPublishedPosts = new Map();
function mergePublishedPosts(posts) {
  return [...runPublishedPosts.values(), ...posts.filter((post) => !runPublishedPosts.has(post.id))].slice(0, 100);
}
let duplicatePostsCache = null;
let duplicatePostsLoadedAt = 0;
let duplicatePostsPending = null;

// Shared by both checks and concurrent workers. Refresh to see external edits.
async function recentDuplicatePosts(signal) {
  if (duplicatePostsCache && Date.now() - duplicatePostsLoadedAt < 60_000) return duplicatePostsCache;
  if (!duplicatePostsPending) {
    duplicatePostsPending = wp('/wp/v2/posts?status=publish&per_page=100&orderby=date&order=desc&_fields=id,link,title,meta,categories', { signal })
      .then((posts) => {
        duplicatePostsCache = mergePublishedPosts(posts);
        duplicatePostsLoadedAt = Date.now();
        return duplicatePostsCache;
      })
      .finally(() => { duplicatePostsPending = null; });
  }
  return duplicatePostsPending;
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
  const posts = await recentDuplicatePosts(signal);
  for (const post of posts) {
    const existingTitle = decodeTitle(post.title?.rendered);
    const similarity = titleSimilarity(title, existingTitle);
    if (likelyDuplicateTitles(title, existingTitle)) {
      throw new Error(`Benzer haber daha önce yayımlanmış: "${existingTitle}" (${Math.round(similarity.score * 100)}%).`);
    }
  }
}

export async function assertNoSimilarPublishedCandidate(sourceTitle, { signal } = {}) {
  const posts = await recentDuplicatePosts(signal);
  for (const post of posts) {
    const existingOriginalTitle = decodeTitle(post.meta?.sanatcin_original_title);
    if (!existingOriginalTitle || !likelyDuplicateTitles(sourceTitle, existingOriginalTitle)) continue;
    const similarity = titleSimilarity(sourceTitle, existingOriginalTitle);
    const existingTitle = decodeTitle(post.title?.rendered) || existingOriginalTitle;
    throw new Error(`Kaynak başlığı daha önce yayımlanan haberle eşleşiyor: "${existingTitle}" (${Math.round(similarity.score * 100)}%).`);
  }
}
