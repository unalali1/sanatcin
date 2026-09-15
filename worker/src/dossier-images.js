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

export function shortDossierCaption(value = '', fallback = 'Görsel kaynağı') {
  const cleaned = text(value).replace(/[|·•:;]+$/g, '').trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && words.length <= 6 && cleaned.length <= 72) return cleaned;
  const fallbackClean = text(fallback).replace(/[|·•:;]+$/g, '').trim();
  const fallbackWords = fallbackClean.split(/\s+/).filter(Boolean);
  if (fallbackWords.length > 6) return fallbackWords.slice(0, 6).join(' ');
  return fallbackClean || 'Görsel kaynağı';
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

function roleHeroBonus(role = '') {
  if (role === 'hero' || role === 'artwork') return 8;
  if (role === 'detail') return 4;
  if (role === 'process') return -2;
  if (role === 'context') return -12;
  return -6;
}

export function orderDossierImages(reviewed, target = 5) {
  const maxTarget = Math.max(1, Math.min(Number(target) || 5, 6));
  if (!reviewed.length) return [];
  const ranked = [...reviewed].sort((a, b) => b.finalScore - a.finalScore);
  const strongHero = ranked.filter((item) =>
    item.relevance >= 70 && item.visualQuality >= 62 && item.subjectCentrality >= 68 && item.heroSuitability >= 62
  );
  const heroPool = strongHero.length ? strongHero : ranked;
  const hero = [...heroPool].sort((a, b) => b.heroScore - a.heroScore)[0];
  const selected = hero ? [hero] : [];
  const seenRoles = new Set(hero ? [hero.role || 'other'] : []);
  for (const item of ranked) {
    if (selected.length >= maxTarget) break;
    if (hero && item.sourcePage === hero.sourcePage) continue;
    const roleKey = item.role || 'other';
    const duplicateRole = seenRoles.has(roleKey) && ['hero', 'artwork', 'process', 'context'].includes(roleKey);
    if (duplicateRole && selected.length < 3) continue;
    selected.push(item);
    seenRoles.add(roleKey);
  }
  return selected;
}

export async function selectDossierImages(topic, candidates, {
  apiKey = process.env.OPENAI_API_KEY || '',
  model = process.env.DOSSIER_VISION_MODEL || process.env.OPENAI_FACT_MODEL || 'gpt-5.6-luna',
  target = Number(process.env.DOSSIER_IMAGE_TARGET || 5),
  signal
} = {}) {
  const pool = candidates.slice(0, 10);
  if (!pool.length) return [];
  const maxTarget = Math.max(1, Math.min(target, 6));
  if (!apiKey) return pool.slice(0, maxTarget).map((item) => ({ ...item, captionTr: shortDossierCaption('', topic.title) }));
  const client = new OpenAI({ apiKey, timeout: 120000, maxRetries: 1 });
  const content = [{
    type: 'input_text',
    text: [
      `SanatÇin dosya konusu: ${topicDisplayName(topic)}`,
      'Aşağıdaki Wikimedia Commons görsellerini tarihsel ve editoryal uygunluk açısından değerlendir.',
      'Her aday için relevance, visualQuality, subjectCentrality ve heroSuitability 0-100 ver.',
      'subjectCentrality: dosyanın ana konusu görselin merkezinde ve ilk bakışta anlaşılır mı? Kaligrafi yazısı gibi konu yalnız arka planda/yan unsur ise düşük ver.',
      'heroSuitability: bu görsel yazının en üstünde kapak olarak kullanıldığında konuyu güçlü ve temsil edici biçimde anlatır mı?',
      'Kapakta doğrudan temsil gücü, estetik kalite ve kompozisyon; yalnız yatay olmasından daha önemlidir.',
      'Genel etkinlik, turistik ortam, konuya dolaylı bağlanan dekorasyon veya tesadüfen konu unsuru içeren kareleri kapakta düşük puanla.',
      'Tarihsel eser, güçlü müze sunumu, zanaatın kendisi veya konuyu açıkça gösteren üretim anı kapakta önceliklidir.',
      'Yanlış nesne/dönem/sanat geleneğini gösteren, logo/afiş/harita/aşırı metinli görselleri düşük puanla.',
      'Aynı nesnenin çok benzer varyasyonlarından yalnız en iyisini seç.',
      'Gövde için eser detayı, üretim, mimari/mekân veya tarihsel örnek gibi tamamlayıcı çeşitlilik tercih et.',
      'captionTr alanında görseli açıklayan 2-5 kelimelik doğal Türkçe bir ifade yaz; dosya adı, fotoğrafçı, lisans veya “Wikimedia Commons” yazma.',
      'Yalnız JSON ver: {"items":[{"index":0,"relevance":90,"visualQuality":82,"subjectCentrality":95,"heroSuitability":88,"role":"hero|artwork|detail|process|context|other","captionTr":"Kaligrafi tomarları","reason":"..."}]}'
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
    const reviewed = pool.map((candidate, index) => {
      const review = reviews.get(index) || {};
      const relevance = Math.max(0, Math.min(100, Number(review.relevance) || 0));
      const visualQuality = Math.max(0, Math.min(100, Number(review.visualQuality) || candidate.baseScore));
      const subjectCentrality = Math.max(0, Math.min(100, Number(review.subjectCentrality) || 0));
      const heroSuitability = Math.max(0, Math.min(100, Number(review.heroSuitability) || 0));
      const role = text(review.role || 'other');
      const finalScore = relevance * 0.35 + visualQuality * 0.25 + subjectCentrality * 0.25 + candidate.baseScore * 0.15;
      const heroScore = heroSuitability * 0.45 + subjectCentrality * 0.25 + relevance * 0.20 + visualQuality * 0.10 + roleHeroBonus(role);
      return {
        ...candidate,
        relevance,
        visualQuality,
        subjectCentrality,
        heroSuitability,
        role,
        captionTr: shortDossierCaption(review.captionTr, topic.title),
        reviewReason: text(review.reason).slice(0, 220),
        finalScore,
        heroScore
      };
    }).filter((x) => x.relevance >= 62 && x.visualQuality >= 55 && x.subjectCentrality >= 55);
    const ordered = orderDossierImages(reviewed, maxTarget);
    return ordered.length ? ordered : pool.slice(0, maxTarget).map((item) => ({ ...item, captionTr: shortDossierCaption('', topic.title) }));
  } catch {
    return pool.slice(0, maxTarget).map((item) => ({ ...item, captionTr: shortDossierCaption('', topic.title) }));
  }
}
