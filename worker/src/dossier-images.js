import OpenAI from 'openai';
import { load } from 'cheerio';
import { topicDisplayName } from './dossier-topics.js';

function text(value = '') {
  return load(`<div>${String(value ?? '')}</div>`).text().replace(/\s+/g, ' ').trim();
}

function allowedLicense(value = '') {
  const license = text(value).toLowerCase();
  if (!license) return false;
  if (license.includes('public domain') || license === 'pd' || license.includes('cc0')) return true;
  if (license.includes('cc by-sa') || license.includes('creative commons attribution-share alike')) return true;
  if (license === 'cc by' || /^cc by \d/.test(license) || license.includes('creative commons attribution ')) return true;
  return false;
}

function imageScore(candidate) {
  const width = Number(candidate.width) || 0;
  const height = Number(candidate.height) || 0;
  const ratio = height ? width / height : 0;
  let score = 45;
  if (width >= 2000 && height >= 1200) score += 18;
  else if (width >= 1400 && height >= 800) score += 14;
  else if (width >= 1000 && height >= 600) score += 9;
  else if (width >= 700 && height >= 450) score += 4;
  if (ratio >= 1.2 && ratio <= 1.9) score += 8;
  if (candidate.description?.length >= 30) score += 4;
  if (candidate.artist?.length >= 2) score += 3;
  return Math.min(100, score);
}

async function searchOne(query, signal) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', query);
  url.searchParams.set('gsrnamespace', '6');
  url.searchParams.set('gsrlimit', '12');
  url.searchParams.set('prop', 'imageinfo');
  url.searchParams.set('iiprop', 'url|size|extmetadata');
  url.searchParams.set('iiurlwidth', '1400');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  const response = await fetch(url, {
    signal,
    headers: { 'user-agent': process.env.USER_AGENT || 'SanatCinBot/1.0', accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`Wikimedia Commons araması başarısız: HTTP ${response.status}`);
  const data = await response.json();
  return Object.values(data?.query?.pages || {});
}

export async function discoverCommonsImages(topic, { signal } = {}) {
  const queries = [...new Set([...(topic.imageQueries || []), topic.title])].slice(0, 4);
  const candidates = new Map();
  for (const query of queries) {
    const pages = await searchOne(query, signal);
    for (const page of pages) {
      const info = page?.imageinfo?.[0];
      if (!info?.thumburl || !info?.descriptionurl) continue;
      const meta = info.extmetadata || {};
      const license = text(meta.LicenseShortName?.value || meta.License?.value || meta.UsageTerms?.value);
      if (!allowedLicense(license)) continue;
      const width = Number(info.width) || 0;
      const height = Number(info.height) || 0;
      if (width < 650 || height < 380) continue;
      const key = String(info.descriptionurl);
      if (candidates.has(key)) continue;
      candidates.set(key, {
        title: text(page.title || '').replace(/^File:/i, '').slice(0, 220),
        thumbUrl: info.thumburl,
        originalUrl: info.url || info.thumburl,
        sourcePage: info.descriptionurl,
        width,
        height,
        license,
        licenseUrl: meta.LicenseUrl?.value || '',
        artist: text(meta.Artist?.value || meta.Credit?.value || '').slice(0, 240),
        description: text(meta.ImageDescription?.value || meta.ObjectName?.value || '').slice(0, 420),
        query
      });
    }
  }
  return [...candidates.values()].map((candidate) => ({ ...candidate, baseScore: imageScore(candidate) }))
    .sort((a, b) => b.baseScore - a.baseScore)
    .slice(0, 18);
}

function parseJson(value) {
  const raw = String(value ?? '').replace(/^```json\s*|\s*```$/g, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Görsel değerlendirmesi geçerli JSON döndürmedi.');
  return JSON.parse(raw.slice(start, end + 1));
}

export async function selectDossierImages(topic, candidates, {
  apiKey = process.env.OPENAI_API_KEY || '',
  model = process.env.DOSSIER_VISION_MODEL || process.env.OPENAI_FACT_MODEL || 'gpt-5.6-luna',
  target = Number(process.env.DOSSIER_IMAGE_TARGET || 5),
  signal
} = {}) {
  const pool = candidates.slice(0, 10);
  if (!pool.length) return [];
  if (!apiKey) return pool.slice(0, Math.max(1, Math.min(target, 6)));
  const client = new OpenAI({ apiKey, timeout: 120000, maxRetries: 1 });
  const content = [{
    type: 'input_text',
    text: [
      `SanatÇin dosya konusu: ${topicDisplayName(topic)}`,
      'Aşağıdaki Wikimedia Commons görsellerini tarihsel ve editoryal uygunluk açısından değerlendir.',
      'Her aday için relevance ve visualQuality 0-100 ver.',
      'Yanlış nesne/dönem/sanat geleneğini gösteren, logo/afiş/harita/aşırı metinli veya konuya dolaylı görselleri düşük puanla.',
      'Aynı nesnenin çok benzer varyasyonlarından yalnız en iyisini seç.',
      'Kapak için mümkünse yatay ve güçlü bir görüntü; gövde için eser detayı, üretim, mimari/mekân veya tarihsel örnek gibi tamamlayıcı çeşitlilik tercih et.',
      'Yalnız JSON ver: {"items":[{"index":0,"relevance":90,"visualQuality":82,"role":"hero|detail|process|context|other","reason":"..."}]}'
    ].join('\n')
  }];
  pool.forEach((candidate, index) => {
    content.push({ type: 'input_text', text: `Aday ${index}: ${candidate.title}. Açıklama: ${candidate.description}. Lisans: ${candidate.license}. Boyut: ${candidate.width}x${candidate.height}` });
    content.push({ type: 'input_image', image_url: candidate.thumbUrl, detail: 'low' });
  });
  try {
    const response = await client.responses.create({ model, input: [{ role: 'user', content }] }, { signal });
    const parsed = parseJson(response.output_text);
    const reviews = new Map((Array.isArray(parsed?.items) ? parsed.items : []).map((item) => [Number(item.index), item]));
    const ranked = pool.map((candidate, index) => {
      const review = reviews.get(index) || {};
      const relevance = Math.max(0, Math.min(100, Number(review.relevance) || 0));
      const visualQuality = Math.max(0, Math.min(100, Number(review.visualQuality) || candidate.baseScore));
      const finalScore = relevance * 0.62 + visualQuality * 0.28 + candidate.baseScore * 0.10;
      return { ...candidate, relevance, visualQuality, role: text(review.role || 'other'), reviewReason: text(review.reason).slice(0, 220), finalScore };
    }).filter((x) => x.relevance >= 62 && x.visualQuality >= 55)
      .sort((a, b) => b.finalScore - a.finalScore);
    const selected = [];
    const seenRoles = new Set();
    for (const item of ranked) {
      if (selected.length >= Math.max(1, Math.min(target, 6))) break;
      const roleKey = item.role || 'other';
      const duplicateRole = seenRoles.has(roleKey) && ['hero', 'process', 'context'].includes(roleKey);
      if (duplicateRole && selected.length < 3) continue;
      selected.push(item);
      seenRoles.add(roleKey);
    }
    return selected.length ? selected : pool.slice(0, Math.max(1, Math.min(target, 6)));
  } catch {
    return pool.slice(0, Math.max(1, Math.min(target, 6)));
  }
}
