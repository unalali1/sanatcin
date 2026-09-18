import OpenAI from 'openai';
import { load } from 'cheerio';
import { topicDisplayName } from './dossier-topics.js';

const AUTHORITATIVE_TYPES = new Set(['museum', 'university', 'unesco', 'government', 'cultural-institution', 'academic']);

function text(value = '') {
  return load(`<div>${String(value ?? '')}</div>`).text().replace(/\s+/g, ' ').trim();
}

function parseJson(value) {
  const raw = String(value ?? '').replace(/^```json\s*|\s*```$/g, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Dosya modeli geçerli JSON döndürmedi.');
  return JSON.parse(raw.slice(start, end + 1));
}

function wordCountHtml(html = '') {
  return text(html).split(/\s+/).filter(Boolean).length;
}

function canonicalUrl(value = '') {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return '';
  }
}

function normalizeResearch(raw, topic) {
  const sources = [];
  const seen = new Set();
  for (const item of Array.isArray(raw?.sources) ? raw.sources : []) {
    const url = canonicalUrl(item?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({
      title: text(item?.title).slice(0, 220),
      url,
      publisher: text(item?.publisher).slice(0, 160),
      sourceType: text(item?.sourceType).toLowerCase().replace(/[^a-z-]/g, '') || 'other',
      usedFor: text(item?.usedFor).slice(0, 280)
    });
  }
  const facts = (Array.isArray(raw?.facts) ? raw.facts : [])
    .map((item, index) => ({
      id: Number(item?.id) || index + 1,
      claim: text(item?.claim).slice(0, 700),
      confidence: ['high', 'medium'].includes(item?.confidence) ? item.confidence : 'medium',
      sourceUrls: [...new Set((Array.isArray(item?.sourceUrls) ? item.sourceUrls : []).map(canonicalUrl).filter(Boolean))].slice(0, 5)
    }))
    .filter((item) => item.claim && item.sourceUrls.length);
  return {
    topic,
    angle: text(raw?.angle).slice(0, 500),
    thesis: text(raw?.thesis).slice(0, 700),
    facts,
    timeline: (Array.isArray(raw?.timeline) ? raw.timeline : []).map((x) => ({ period: text(x?.period).slice(0, 100), event: text(x?.event).slice(0, 400) })).filter((x) => x.event).slice(0, 12),
    glossary: (Array.isArray(raw?.glossary) ? raw.glossary : []).map((x) => ({ tr: text(x?.tr).slice(0, 120), zh: text(x?.zh).slice(0, 80), pinyin: text(x?.pinyin).slice(0, 100), note: text(x?.note).slice(0, 300) })).filter((x) => x.tr).slice(0, 12),
    sources,
    imageQueries: [...new Set((Array.isArray(raw?.imageQueries) ? raw.imageQueries : topic.imageQueries || []).map(text).filter(Boolean))].slice(0, 6)
  };
}

function validateResearch(research) {
  if (research.sources.length < 4) throw new Error(`Dosya için en az 4 güvenilir kaynak gerekli; ${research.sources.length} bulundu.`);
  const domains = new Set(research.sources.map((source) => {
    try { return new URL(source.url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }).filter(Boolean));
  if (domains.size < 3) throw new Error(`Dosya için en az 3 bağımsız alan adı gerekli; ${domains.size} bulundu.`);
  const authoritative = research.sources.filter((source) => AUTHORITATIVE_TYPES.has(source.sourceType));
  if (authoritative.length < 2) throw new Error(`Dosya için en az 2 kurumsal/akademik kaynak gerekli; ${authoritative.length} bulundu.`);
  if (research.facts.length < 10) throw new Error(`Dosya için yeterli doğrulanabilir olgu yok: ${research.facts.length}.`);
  return research;
}

async function responsesWithWebSearch(client, request, signal) {
  let lastError;
  for (const type of ['web_search', 'web_search_preview']) {
    try {
      return await client.responses.create({ ...request, tools: [{ type }] }, { signal });
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      if (!/tool|web_search|unsupported|unknown|invalid/i.test(message)) throw error;
    }
  }
  throw lastError || new Error('Web arama aracı kullanılamadı.');
}

export async function researchDossierTopic(topic, {
  apiKey = process.env.OPENAI_API_KEY || '',
  model = process.env.DOSSIER_RESEARCH_MODEL || process.env.OPENAI_FACT_MODEL || 'gpt-5.6-luna',
  signal
} = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY eksik.');
  const client = new OpenAI({ apiKey, timeout: 120000, maxRetries: 1 });
  const response = await responsesWithWebSearch(client, {
    model,
    input: [{
      role: 'system',
      content: [
        'SanatÇin için geleneksel Çin sanatları üzerine kaynak temelli araştırma yapan kıdemli kültür tarihi araştırmacısısın.',
        'Her önemli tarih, hanedan, teknik, malzeme, coğrafi köken, sanatçı/usta ve UNESCO iddiasını web kaynaklarıyla doğrula.',
        'Tek bir haber metnine dayanma. Müze koleksiyonları, UNESCO, üniversiteler, akademik kurumlar, kamu kültür kurumları ve güvenilir ansiklopedik/müze kaynaklarını önceliklendir.',
        'Pazarlama metni, turizm reklamı, SEO içerik çiftliği ve kaynaksız blogları temel kaynak yapma.',
        'Çelişkili tarihler veya tartışmalı kökenler varsa kesin hüküm verme; facts içinde confidence=medium kullan ve ihtilafı açıkla.',
        'Türkçe okur için tarihsel bağlam, teknik üretim süreci, estetik ilkeler, semboller, önemli merkezler/ekoller ve günümüzdeki devamlılık birlikte araştırılmalı.',
        'Özgün Çince eser, teknik, akım ve kültürel kavram adlarını güvenilir kaynaklardan doğrula; glossary alanında doğal Türkçe karşılık, Çince karakter ve doğru pinyin birlikte bulunsun. Kaynakla doğrulanmayan Çince yazım veya pinyin üretme.',
        'Fildişi gibi koruma/hukuk boyutu olan konularda güncel etik ve koruma bağlamını mutlaka belirt.',
        'Yalnız geçerli JSON döndür.'
      ].join(' ')
    }, {
      role: 'user',
      content: [
        `Konu: ${topicDisplayName(topic)}`,
        `Araştırma sorguları: ${(topic.queries || []).join(' | ')}`,
        'En az 12 doğrulanabilir olgu, 4-8 kaynak ve en az 3 farklı alan adı kullan.',
        'Kaynakların en az ikisi museum, university, unesco, government, cultural-institution veya academic türünde olsun.',
        'JSON şeması:',
        '{"angle":"...","thesis":"...","facts":[{"id":1,"claim":"...","confidence":"high|medium","sourceUrls":["https://..."]}],"timeline":[{"period":"...","event":"..."}],"glossary":[{"tr":"...","zh":"...","pinyin":"...","note":"..."}],"sources":[{"title":"...","url":"https://...","publisher":"...","sourceType":"museum|university|unesco|government|cultural-institution|academic|reference|other","usedFor":"..."}],"imageQueries":["..."]}'
      ].join('\n')
    }]
  }, signal);
  return validateResearch(normalizeResearch(parseJson(response.output_text), topic));
}

export async function verifyDossierResearch(research, {
  apiKey = process.env.OPENAI_API_KEY || '',
  model = process.env.DOSSIER_RESEARCH_MODEL || process.env.OPENAI_FACT_MODEL || 'gpt-5.6-luna',
  signal
} = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY eksik.');
  const client = new OpenAI({ apiKey, timeout: 120000, maxRetries: 1 });
  const response = await responsesWithWebSearch(client, {
    model,
    input: [{
      role: 'system',
      content: [
        'Geleneksel Çin sanatları dosyası için bağımsız ikinci fact-check yapıyorsun.',
        'Aşağıdaki her olguyu web üzerinden yeniden kontrol et.',
        'verified yalnız en az bir güvenilir kaynakla desteklenen iddialara verilmeli.',
        'Tarih, hanedan, UNESCO statüsü, teknik süreç veya köken konusunda belirsizlik varsa caution; yanlışsa drop.',
        'Ayrıca glossary içindeki Türkçe karşılık, Çince karakter ve pinyin üçlüsünü kaynaklarla ayrı ayrı doğrula. Yalnız üçü de destekleniyorsa verified ver; düzeltilebiliyorsa corrected, doğrulanamıyorsa drop ver.',
        'Yalnız geçerli JSON döndür.'
      ].join(' ')
    }, {
      role: 'user',
      content: `Konu: ${research.topic.title}\nOlgular: ${JSON.stringify(research.facts)}\nDoğrulanacak terimler: ${JSON.stringify(research.glossary.map((item, index) => ({ id: index + 1, ...item })))}\nJSON: {"checks":[{"id":1,"status":"verified|caution|drop","correctedClaim":"gerekirse düzeltilmiş ifade","sourceUrls":["https://..."]}],"glossaryChecks":[{"id":1,"status":"verified|corrected|drop","tr":"doğrulanmış Türkçe karşılık","zh":"doğrulanmış Çince karakterler","pinyin":"doğrulanmış pinyin","sourceUrls":["https://..."]}]}`
    }]
  }, signal);
  const raw = parseJson(response.output_text);
  const checks = new Map((Array.isArray(raw?.checks) ? raw.checks : []).map((x) => [Number(x.id), x]));
  const facts = [];
  for (const fact of research.facts) {
    const check = checks.get(Number(fact.id));
    if (!check || check.status === 'drop') continue;
    const claim = text(check.correctedClaim || fact.claim).slice(0, 700);
    const sourceUrls = [...new Set([...(fact.sourceUrls || []), ...((Array.isArray(check.sourceUrls) ? check.sourceUrls : []).map(canonicalUrl).filter(Boolean))])].slice(0, 6);
    if (!claim || !sourceUrls.length) continue;
    facts.push({ ...fact, claim, sourceUrls, verification: check.status === 'caution' ? 'caution' : 'verified' });
  }
  if (facts.length < 9) throw new Error(`İkinci fact-check sonrası yeterli olgu kalmadı: ${facts.length}.`);
  const glossaryChecks = new Map((Array.isArray(raw?.glossaryChecks) ? raw.glossaryChecks : []).map((x) => [Number(x.id), x]));
  const glossary = [];
  for (const [index, item] of research.glossary.entries()) {
    const check = glossaryChecks.get(index + 1);
    if (!check || check.status === 'drop') continue;
    const tr = text(check.tr || item.tr).slice(0, 120);
    const zh = text(check.zh || item.zh).slice(0, 80);
    const pinyin = text(check.pinyin || item.pinyin).slice(0, 100);
    const sourceUrls = [...new Set((Array.isArray(check.sourceUrls) ? check.sourceUrls : []).map(canonicalUrl).filter(Boolean))].slice(0, 5);
    if (!tr || !zh || !pinyin || !sourceUrls.length) continue;
    glossary.push({ ...item, tr, zh, pinyin, sourceUrls, verification: check.status === 'corrected' ? 'corrected' : 'verified' });
  }
  if (!glossary.length) throw new Error('İkinci fact-check sonrası doğrulanmış Çince terim kalmadı.');
  return { ...research, facts, glossary };
}

function sourceListHtml(sources) {
  const items = sources.map((source) => `<li><a href="${source.url}" target="_blank" rel="noopener noreferrer nofollow">${text(source.publisher || source.title)}</a>${source.title && source.title !== source.publisher ? ` — ${text(source.title)}` : ''}</li>`).join('');
  return `<h2>Kaynaklar ve ileri okuma</h2><ul class="sanatcin-dossier-sources">${items}</ul>`;
}

async function requestArticle(client, model, research, signal, repairNote = '') {
  const response = await client.responses.create({
    model,
    input: [{
      role: 'system',
      content: [
        'SanatÇin için Türkçe uzun form kültür-sanat editörüsün.',
        'Kaynak araştırmasındaki doğrulanmış olgular kesin factual sınırdır; bunların dışında tarih, sayı, kişi, kurum, teknik ayrıntı veya UNESCO statüsü uydurma.',
        'Metin Türkiye Türkçesinde doğal, akıcı, dergi kalitesinde ve öğretici olmalı; İngilizce/Çince cümle yapısını taklit etme.',
        'Türkçede yerleşik karşılığı bulunmayan Çince eser, teknik, akım veya kültürel kavram adlarında doğal Türkçe karşılığı esas al. İlk kullanımda kısa standardı uygula: Doğal Türkçe Karşılık (“中文名称”, Pinyin). Türkçe karşılık anlamı, çağrışımı ve varsa kelime oyununu mümkün olduğunca korumalıdır. Sonraki kullanımlarda yalnız Türkçe karşılığı kullan. Çince ad veya pinyin araştırmada doğrulanmamışsa uydurma.',
        'Başlık açıklayıcı ve merak uyandırıcı olsun, clickbait olmasın. Bilinmeyen Çince terimi açıklamasız başlığın merkezine koyma.',
        'Giriş sahici ve somut olsun; sonra tarih, yapım tekniği/malzeme, estetik düşünce, semboller, merkezler/ekoller, önemli örnekler ve günümüzdeki devamlılık arasında doğal bir anlatı kur.',
        'CV listesi, turistik tanıtım dili, propaganda, kaynakta olmayan övgü ve klişelerden kaçın.',
        '1200-1800 Türkçe kelime hedefle. 6-10 anlamlı H2 alt başlık kullan. Son bölüm soru işaretiyle bitmesin.',
        'Kaynak listesini yazma; sistem ayrıca ekleyecek.',
        repairNote,
        'Yalnız geçerli JSON döndür.'
      ].filter(Boolean).join(' ')
    }, {
      role: 'user',
      content: `Konu: ${topicDisplayName(research.topic)}\nAçı: ${research.angle}\nTez: ${research.thesis}\nDoğrulanmış olgular: ${JSON.stringify(research.facts)}\nZaman çizelgesi: ${JSON.stringify(research.timeline)}\nTerimler: ${JSON.stringify(research.glossary)}\nJSON: {"title":"...","excerpt":"110-190 karakter spot","contentHtml":"<p>...</p><h2>...</h2>...","seoDescription":"..."}`
    }]
  }, { signal });
  return parseJson(response.output_text);
}

export async function writeDossierArticle(research, {
  apiKey = process.env.OPENAI_API_KEY || '',
  model = process.env.DOSSIER_EDITOR_MODEL || process.env.OPENAI_EDITOR_MODEL || 'gpt-5.6-terra',
  signal
} = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY eksik.');
  const client = new OpenAI({ apiKey, timeout: 150000, maxRetries: 1 });
  let raw = await requestArticle(client, model, research, signal);
  let contentHtml = String(raw?.contentHtml || '').trim();
  let count = wordCountHtml(contentHtml);
  if (count < 1150 || count > 1900) {
    raw = await requestArticle(client, model, research, signal, `İlk taslağın kelime sayısı ${count}; metni 1200-1800 kelime aralığına getir.`);
    contentHtml = String(raw?.contentHtml || '').trim();
    count = wordCountHtml(contentHtml);
  }
  if (!raw?.title || !raw?.excerpt || !contentHtml) throw new Error('Dosya yazımı eksik alan döndürdü.');
  if (count < 1050 || count > 2050) throw new Error(`Dosya uzunluğu güvenli aralık dışında: ${count} kelime.`);
  const title = text(raw.title).slice(0, 120);
  const excerpt = text(raw.excerpt).slice(0, 240);
  if (title.length < 28) throw new Error('Dosya başlığı çok kısa.');
  if (excerpt.length < 90) throw new Error('Dosya spotu çok kısa.');
  return {
    topic: research.topic,
    title,
    excerpt,
    seoDescription: text(raw.seoDescription).slice(0, 220),
    contentHtml: `${contentHtml}${sourceListHtml(research.sources)}`,
    wordCount: count,
    research
  };
}
