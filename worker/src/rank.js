import OpenAI from 'openai';
import { config } from './config.js';
import { mapLimit } from './concurrency.js';
import { log } from './logger.js';
import { freshnessPoints } from './score.js';

const client = new OpenAI({
  apiKey: config.openaiApiKey,
  timeout: config.aiRequestTimeoutMs,
  // Büyük bir sıralama isteğini aynı boyutta tekrar etmek yerine, başarısız
  // partiyi aşağıda iki küçük parçaya ayırarak bir kez daha deniyoruz.
  maxRetries: 0
});
const allowedCategories = new Set(['kultur-sanat', 'sinema', 'moda-tasarim', 'sehir-yasam']);
const CINEMA_HINTS = /(?:^|[^\p{L}])(?:film|sinema|movie|box office|director|actor|actress|series|television|tv|drama|documentary|animation|premiere|screening|screenwriter|dizi|belgesel|yönetmen|oyuncu|prömiyer|gösterim)\p{L}*|(?:电影|影院|票房|导演|演员|电视剧|纪录片|动画|首映)/iu;

export function looksLikeCinemaCandidate(candidate = {}) {
  if (candidate.category === 'sinema' || candidate.source?.defaultCategory === 'sinema') return true;
  return CINEMA_HINTS.test(`${candidate.title ?? ''} ${candidate.summary ?? ''}`);
}
const wpAuth = `Basic ${Buffer.from(`${config.wpUsername}:${config.wpAppPassword}`).toString('base64')}`;

// Moda havuzunda uzman kaynakları öne çıkarır; China Daily gibi genel kaynakları
// cezalandırmaz. Bu yalnız moda-tasarım kategorisinde küçük bir pozitif sinyaldir.
const categorySourceBoosts = {
  'moda-tasarim': {
    'jingdaily-fashion': 3,
    'radii-fashion': 3,
    'dao-fashion-retail': 2,
    'china-daily-fashion': 2
  }
};

function categorySourceBoost(candidate, category) {
  return categorySourceBoosts[category]?.[candidate.source?.id] ?? 0;
}

function clamp(value, minimum, maximum, fallback = minimum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;|&#038;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function wpJson(path, { signal } = {}) {
  const response = await fetch(`${config.wpBaseUrl}/wp-json${path}`, {
    signal,
    headers: { authorization: wpAuth, accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`WordPress bağlam isteği ${response.status}: ${(await response.text()).slice(0, 250)}`);
  return response.json();
}

async function loadRecentEditorialContext(signal) {
  if (!config.wpBaseUrl || !config.wpUsername || !config.wpAppPassword) return [];
  const after = new Date(Date.now() - config.recentTopicLookbackDays * 86_400_000).toISOString();
  try {
    const posts = await wpJson(`/wp/v2/posts?status=publish&after=${encodeURIComponent(after)}&per_page=80&orderby=date&order=desc&_fields=date,title,excerpt,meta`, { signal });
    return posts
      .filter((post) => post?.meta?.sanatcin_source_url)
      .slice(0, 50)
      .map((post) => ({
        date: post.date,
        published_at: post.date,
        source_name: post?.meta?.sanatcin_source_name ?? '',
        source_url: post?.meta?.sanatcin_source_url ?? '',
        title: stripHtml(post.title?.rendered).slice(0, 180),
        excerpt: stripHtml(post.excerpt?.rendered).slice(0, 220)
      }))
      .filter((post) => post.title);
  } catch (error) {
    log('warn', 'Yakın dönem konu hafızası yüklenemedi; yalnız bugünkü adaylarla devam edilecek', {
      error: String(error?.message ?? error).slice(0, 400)
    });
    return [];
  }
}

function parseHealthState(raw = '') {
  try {
    const parsed = JSON.parse(String(raw).trim());
    return Array.isArray(parsed?.runs) ? parsed : { runs: [] };
  } catch {
    return { runs: [] };
  }
}

async function loadSourceHealth(signal) {
  const result = new Map();
  if (!config.wpBaseUrl || !config.wpUsername || !config.wpAppPassword) return result;
  try {
    const posts = await wpJson('/wp/v2/posts?slug=sanatcin-source-health-state&status=draft&context=edit&per_page=1&_fields=id,content', { signal });
    const state = parseHealthState(posts?.[0]?.content?.raw ?? '');
    const cutoff = Date.now() - config.sourceHealthLookbackDays * 86_400_000;
    const runs = state.runs
      .filter((run) => new Date(run.time ?? 0).getTime() >= cutoff)
      .sort((left, right) => new Date(right.time ?? 0) - new Date(left.time ?? 0));
    const sourceIds = new Set(runs.flatMap((run) => Object.keys(run.sources ?? {})));
    for (const sourceId of sourceIds) {
      const stats = runs.map((run) => run.sources?.[sourceId]).filter(Boolean);
      const attempted = stats.reduce((sum, item) => sum + (Number(item.attempted) || 0), 0);
      const rejected = stats.reduce((sum, item) => sum + (Number(item.rejected) || 0), 0);
      const published = stats.reduce((sum, item) => sum + (Number(item.published) || 0), 0);
      const badRun = (item) => Boolean(item.error) || ((Number(item.attempted) || 0) >= 2 && (Number(item.published) || 0) === 0 && (Number(item.rejected) || 0) >= 2);
      let consecutiveBadRuns = 0;
      for (const item of stats) {
        if (!badRun(item)) break;
        consecutiveBadRuns += 1;
      }
      const badRuns = stats.filter(badRun).length;
      const failureRate = stats.length ? badRuns / stats.length : 0;
      const rejectionRate = attempted ? rejected / attempted : 0;
      const penalty = Math.min(12, Math.round((failureRate * 6 + rejectionRate * 6) * 10) / 10);
      result.set(sourceId, {
        blocked: consecutiveBadRuns >= 2,
        consecutiveBadRuns,
        failureRate,
        rejectionRate,
        conversionRate: attempted ? published / attempted : 0,
        penalty
      });
    }
  } catch (error) {
    log('warn', 'Kaynak sağlık geçmişi yüklenemedi; kaynak cezası olmadan devam edilecek', {
      error: String(error?.message ?? error).slice(0, 400)
    });
  }
  return result;
}

export function sourceCrowdingPenalty(previousCount = 0) {
  if (previousCount <= 0) return 0;
  if (previousCount === 1) return 3;
  if (previousCount === 2) return 8;
  return 15;
}

export function calculateSameSourcePenalty(sourceName, previousPosts = [], now = new Date()) {
  const normalizedCurrent = String(sourceName ?? '').toLocaleLowerCase('tr-TR').trim();
  if (!normalizedCurrent) return 0;
  const cutoff = now.getTime() - 48 * 60 * 60 * 1000;
  const count = previousPosts.filter((post) => {
    const normalizedPrior = String(post?.source_name ?? '').toLocaleLowerCase('tr-TR').trim();
    const publishedAt = new Date(post?.published_at ?? 0).getTime();
    return normalizedPrior === normalizedCurrent && publishedAt >= cutoff && publishedAt <= now.getTime();
  }).length;
  if (count <= 1) return 0;
  if (count === 2) return 4;
  return 8;
}

function allowFit6Exception(editorialFit, storyStrength, freshness, institutionalEvent, commercialDominant) {
  return editorialFit === 6
    && storyStrength >= 85
    && freshness >= 27
    && !institutionalEvent
    && !commercialDominant;
}

export function applyAiScores(candidates, items, now = new Date(), sourceHealth = new Map(), previousPosts = []) {
  const byId = new Map(items.map((item) => [String(item.id), item]));
  return candidates.map((candidate) => {
    const ai = byId.get(String(candidate.id));
    if (!ai) return { ...candidate, eligible: false, category: 'uygunsuz', score: 0, scoreReason: 'Yapay zekâ editoryal değerlendirmesi alınamadı.' };
    const editorialFit = clamp(ai.fit, 0, 10, 7);
    const interest = clamp(ai.interest, 0, 100, 0);
    const relevance = clamp(ai.relevance, 0, 100, 0);
    const storyStrength = clamp(ai.storyStrength, 0, 100, 50);
    const institutionalEvent = ai.institutionalEvent === true;
    const commercialDominant = ai.commercialDominant === true;
    const recentTopicRepeat = ai.recentTopicRepeat === true;
    const realPersonCentered = ai.realPersonCentered === true;
    const health = sourceHealth.get(candidate.source?.id) ?? { blocked: false, penalty: 0 };
    const baseEligible = ai.eligible === true && allowedCategories.has(ai.category);
    const freshness = freshnessPoints(candidate.publishedAt, now);
    const fit6ExceptionApplied = allowFit6Exception(editorialFit, storyStrength, freshness, institutionalEvent, commercialDominant);
    const eligible = baseEligible
      && (editorialFit >= config.minEditorialFit || fit6ExceptionApplied)
      && !(commercialDominant && editorialFit <= 6)
      && !health.blocked;
    const category = eligible ? ai.category : 'uygunsuz';
    const sourceBoost = eligible ? categorySourceBoost(candidate, category) : 0;
    const fitAdjustment = (editorialFit - 7) * 4;
    const institutionalPenalty = institutionalEvent ? (editorialFit <= 6 ? 8 : 4) : 0;
    const commercialPenalty = commercialDominant ? 10 : 0;
    const recentTopicPenalty = recentTopicRepeat ? 10 : 0;
    const sourceHealthPenalty = Number(health.penalty) || 0;
    const sameSourcePenalty = calculateSameSourcePenalty(candidate.source?.name, previousPosts, now);
    const rawScore =
      freshness +
      interest * 0.20 +
      relevance * 0.15 +
      storyStrength * 0.25 +
      Math.min(10, candidate.source.quality ?? 5) +
      sourceBoost +
      fitAdjustment -
      institutionalPenalty -
      commercialPenalty -
      recentTopicPenalty -
      sourceHealthPenalty -
      sameSourcePenalty;
    const healthReason = health.blocked
      ? 'Kaynak son koşularda tekrarlayan işlem hataları verdiği için geçici olarak devre dışı.'
      : sourceHealthPenalty > 0
        ? `Kaynak sağlık cezası ${sourceHealthPenalty}.`
        : '';
    return {
      ...candidate,
      eligible,
      category,
      interest,
      relevance,
      storyStrength,
      editorialFit,
      institutionalEvent,
      commercialDominant,
      recentTopicRepeat,
      recentTopicPenalty,
      realPersonCentered,
      topicCluster: String(ai.topicCluster ?? '').trim().toLowerCase().slice(0, 80),
      contentType: String(ai.contentType ?? '').trim().toLowerCase().slice(0, 40),
      sourceBoost,
      sourceHealthPenalty,
      sourceHealthBlocked: health.blocked === true,
      sameSourcePenalty,
      fit6ExceptionApplied,
      institutionalPenalty,
      commercialPenalty,
      score: eligible ? Math.max(0, Math.min(100, Math.round(rawScore * 10) / 10)) : 0,
      scoreReason: `${String(ai.reason ?? '').slice(0, 260)} ${healthReason}`.trim().slice(0, 360)
    };
  });
}

function publisherGroupId(candidate = {}) {
  return candidate.source?.publisherGroup ?? candidate.source?.id ?? 'unknown';
}

function appendWithPublisherCap(selected, used, publisherCounts, candidate, publisherCap) {
  if (!candidate || used.has(candidate.id)) return false;
  const group = publisherGroupId(candidate);
  if ((publisherCounts.get(group) ?? 0) >= publisherCap) return false;
  selected.push(candidate);
  used.add(candidate.id);
  publisherCounts.set(group, (publisherCounts.get(group) ?? 0) + 1);
  return true;
}

export function buildBalancedShortlist(candidates, maxCandidates = config.maxAiCandidates) {
  const eligible = candidates.filter((candidate) => candidate.eligible !== false);
  const selected = [];
  const used = new Set();
  const publisherCounts = new Map();
  // AI öncesinde tek bir yayıncı ailesinin değerlendirme havuzunu kaplamasını engeller.
  // 60 adaylık normal havuzda üst sınır 14'tür; yeterli alternatif yoksa son doldurma
  // turunda kota gevşetilir ve sistem kapasite kaybetmez.
  const publisherCap = Math.max(6, Math.ceil(maxCandidates * 0.22));

  // Sinema adayları genel kültür akışında kolayca kaybolabildiği için AI değerlendirme
  // havuzunda ayrı bir taban kota korunur. Kaynaklar yayıncı ailesine göre dönüşümlü
  // sıralanır; bu bir yayın kotası değil, editör modelinin daha çeşitli sinema adayları
  // görmesini sağlayan değerlendirme kotasıdır.
  const cinemaReserve = Math.min(config.cinemaAiReserve, maxCandidates);
  const cinemaCandidates = diversifyBySource(
    eligible
      .filter(looksLikeCinemaCandidate)
      .sort((a, b) => b.score - a.score)
  );
  for (const candidate of cinemaCandidates) {
    if (selected.length >= cinemaReserve) break;
    appendWithPublisherCap(selected, used, publisherCounts, candidate, publisherCap);
  }

  const remainingCapacity = Math.max(0, maxCandidates - selected.length);
  const perCategory = Math.max(1, Math.floor(remainingCapacity / allowedCategories.size));
  for (const category of allowedCategories) {
    let added = 0;
    const group = diversifyBySource(
      eligible
        .filter((candidate) => !used.has(candidate.id) && candidate.category === category)
        .sort((a, b) => b.score - a.score)
    );
    for (const candidate of group) {
      if (added >= perCategory || selected.length >= maxCandidates) break;
      if (appendWithPublisherCap(selected, used, publisherCounts, candidate, publisherCap)) added += 1;
    }
  }

  if (selected.length < maxCandidates) {
    const remainder = diversifyBySource(
      eligible
        .filter((candidate) => !used.has(candidate.id))
        .sort((a, b) => b.score - a.score)
    );
    for (const candidate of remainder) {
      if (selected.length >= maxCandidates) break;
      appendWithPublisherCap(selected, used, publisherCounts, candidate, publisherCap);
    }
  }

  // Çeşitlilik kotası nedeniyle boş kapasite kaldıysa güvenli şekilde gevşet.
  if (selected.length < maxCandidates) {
    const remainder = eligible
      .filter((candidate) => !used.has(candidate.id))
      .sort((a, b) => b.score - a.score);
    for (const candidate of remainder) {
      if (selected.length >= maxCandidates) break;
      selected.push(candidate);
      used.add(candidate.id);
    }
  }
  return selected.slice(0, maxCandidates);
}

export function selectCinemaRescueCandidates(shortlist, ranked, limit = 8) {
  const rankedById = new Map(ranked.map((candidate) => [String(candidate.id), candidate]));
  return diversifyBySource(
    shortlist
      .filter(looksLikeCinemaCandidate)
      .filter((candidate) => {
        const current = rankedById.get(String(candidate.id));
        return !current?.eligible || current.category !== 'sinema';
      })
      .sort((a, b) => b.score - a.score)
  ).slice(0, Math.max(0, limit));
}

function mergeRankedCandidates(primary, replacements) {
  const replacementById = new Map(replacements.map((candidate) => [String(candidate.id), candidate]));
  const merged = primary.map((candidate) => replacementById.get(String(candidate.id)) ?? candidate);
  const known = new Set(merged.map((candidate) => String(candidate.id)));
  for (const candidate of replacements) {
    if (!known.has(String(candidate.id))) merged.push(candidate);
  }
  return merged;
}

export function diversifyBySource(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const sourceId = candidate.source?.publisherGroup ?? candidate.source?.id ?? 'unknown';
    if (!groups.has(sourceId)) groups.set(sourceId, []);
    groups.get(sourceId).push(candidate);
  }

  const queues = [...groups.values()]
    .map((items) => items.sort((left, right) => right.score - left.score))
    .sort((left, right) => right[0].score - left[0].score);
  const diversified = [];
  let added = true;
  while (added) {
    added = false;
    for (const queue of queues) {
      const candidate = queue.shift();
      if (!candidate) continue;
      diversified.push(candidate);
      added = true;
    }
  }
  return diversified;
}

const TOPIC_STOP_WORDS = new Set([
  'the', 'and', 'with', 'from', 'into', 'over', 'after', 'before', 'amid', 'for', 'its',
  'china', 'chinese', 'culture', 'cultural', 'art', 'artist', 'artists', 'museum', 'gallery',
  'exhibition', 'festival', 'film', 'films', 'cinema', 'fashion', 'design', 'new', 'opens', 'opened'
]);

function topicTokens(candidate) {
  return `${candidate.title ?? ''} ${candidate.summary ?? ''}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((token) => token.length > 5 && token.endsWith('s') ? token.slice(0, -1) : token)
    .filter((token) => token.length > 3 && !TOPIC_STOP_WORDS.has(token));
}

export function topicSimilarity(left, right) {
  const a = new Set(topicTokens(left));
  const b = new Set(topicTokens(right));
  if (!a.size || !b.size) return { score: 0, shared: [] };
  const shared = [...a].filter((token) => b.has(token));
  const union = new Set([...a, ...b]).size;
  return { score: shared.length / union, shared };
}

export function isNearTopicRepeat(candidate, selected) {
  return selected.some((prior) => {
    const candidateCluster = String(candidate.topicCluster ?? '').trim().toLowerCase();
    const priorCluster = String(prior.topicCluster ?? '').trim().toLowerCase();
    if (candidateCluster && priorCluster && candidateCluster === priorCluster) return true;
    const similarity = topicSimilarity(candidate, prior);
    const hasDistinctiveSharedTerm = similarity.shared.some((token) => token.length >= 7);
    return similarity.score >= 0.42
      || (similarity.shared.length >= 3 && similarity.score >= 0.16)
      || (similarity.shared.length >= 2 && hasDistinctiveSharedTerm && similarity.score >= 0.08);
  });
}

// Konu tekrarını sert biçimde silmek yerine, önce farklı başlıkları öne taşır.
// Kuyrukta yalnız benzer konular kaldıysa adayı korur ama küçük bir puan indirimi
// uygular; böylece sistem işlemez hale gelmeden ikinci slot eşiği devreye girebilir.
export function diversifyByTopic(candidates) {
  const remaining = [...candidates];
  const selected = [];
  while (remaining.length) {
    let index = remaining.findIndex((candidate) => !isNearTopicRepeat(candidate, selected));
    let topicPenalty = 0;
    if (index < 0) {
      index = 0;
      topicPenalty = 6;
    }
    const candidate = remaining.splice(index, 1)[0];
    selected.push(topicPenalty > 0
      ? {
          ...candidate,
          score: Math.max(0, Math.round((candidate.score - topicPenalty) * 10) / 10),
          topicPenalty,
          scoreReason: `${candidate.scoreReason || ''} Aynı gün benzer konu nedeniyle çeşitlilik puanı düşürüldü.`.trim()
        }
      : candidate);
  }
  return selected;
}

async function rerankBatch(batch, signal, recentContext = [], { cinemaRescue = false } = {}) {
  const history = recentContext.length
    ? `\n\nSon ${config.recentTopicLookbackDays} günde SanatÇin'de yayımlanan otomatik haberler. Bunları yalnız konu tekrarı denetimi için kullan:\n${JSON.stringify(recentContext)}`
    : '';
  const response = await client.responses.create({
    model: config.openaiSelectionModel,
    input: [
      {
        role: 'system',
        content: [
          'SanatÇin için haber seçen kıdemli bir Türkçe kültür-sanat editörüsün. Yalnız geçerli JSON ver.',
          'SanatÇin genel Çin haber sitesi değildir; sanat, kültür, moda, tasarım, sinema ve şehir kültürü ekseni belirleyicidir.',
          'Finans, makroekonomi, ihracat, üretim kapasitesi, otomotiv, sıradan teknoloji, diplomasi, askerî gündem, spor, protokol, reklam ve zayıf PR metinleri kültürel/yaratıcı bağ açık ve asli değilse kapsam dışıdır.',
          'Türkiye’deki okur için güncellik, somut gelişme, özgünlük, kültürel değer, geniş okuyucu ilgisi, güçlü hikâye değeri ve görsel potansiyel arıyoruz.',
          'Kategori ölçütlerini ayrı uygula: kultur-sanat için eser, sergi, miras, edebiyat ve yaratıcı üretim; sinema için film, festival, gösterim, ödül ve yaratıcı ekipte somut gelişme; moda-tasarim için tasarım, zanaat, koleksiyon, mimari ve yaratıcı eğilim; sehir-yasam için kent kültürü, kamusal mekân, yerel yaşam, gastronomi ve anlamlı etkinlik. Magazin, marka PR’ı, turizm tanıtımı veya sıradan açılış haberi kategori kotası uğruna yükseltilmemeli.',
          'Kategori kotasını doldurmak uğruna zayıf bir adayı uygun sayma; ancak orta düzey ama gerçek kültür-sanat haberlerini yalnız çok çarpıcı olmadıkları için reddetme.',
          cinemaRescue
            ? 'Bu ikinci değerlendirme yalnız sinema/film-TV kapsamı için yapılıyor. Film, dizi, belgesel, animasyon, yönetmen/oyuncu yaratıcı çalışması, festival, gösterim, ödül, gişe veya izleyici verisi somut bir yapım/hikâye gelişmesine bağlıysa sinema kategorisini gereksiz yere reddetme. Salt ünlü magazini, marka PR’ı veya yalnız ticari sektör verisi yine uygun değildir.'
            : ''
        ].filter(Boolean).join(' ')
      },
      {
        role: 'user',
        content: `Her adayı bağımsız değerlendir; hiçbir adayı atlama. Yalnız gerçek kültür-sanat, sinema, moda-tasarım ve şehir yaşamı haberleri eligible=true olabilir. Uygun adayları kultur-sanat, sinema, moda-tasarim veya sehir-yasam kategorisine koy; kaynağın varsayılan kategorisini gerektiğinde değiştir.\n\nfit alanı SanatÇin editoryal uyumunu 0-10 puanlasın: 0-4 konu dışı/zayıf uyum, 5-6 ancak daha güçlü aday yoksa kullanılabilecek gerçek ama ikincil kültür/lifestyle haberi, 7-8 güçlü uyum, 9-10 markanın merkezinde olması gereken içerik.\n\ninterest ve relevance alanlarını 0-100 puanla. storyStrength alanı da 0-100 olsun ve şu soruyu ölçsün: “Bu haber Türkiye'deki bir okura Çin'i gerçekten yeni, özgün veya insani bir açıdan anlatıyor mu?” Rutin açılış, toplantı ve kurumsal duyurular düşük; özgün insan hikâyesi, sıra dışı eser, güçlü kültürel dönüşüm, dikkat çekici yaratıcı başarı veya geniş okur merakı taşıyan haber yüksek storyStrength almalı.\n\nTürkiye’de tanınmayan küçük bir kurumun rutin toplantısı, açılış töreni, konferansı veya kurumsal buluşması daha geniş bir kültürel sonuç, önemli isim, sıra dışı eser ya da özgün insan hikâyesi taşımıyorsa institutionalEvent=true ver ve fit'i 6'nın üstüne çıkarma. İhracat, satış, pazar payı, üretim, fabrika, şirket satın alması veya sektör büyüklüğü haberin ana gövdesiyse ve yaratıcı/kültürel unsur tali kalıyorsa commercialDominant=true ver; bu tür içerik çoğu durumda eligible=false olmalı. Moda/tasarım sektöründeki gerçek yaratıcı trendleri yalnız ticari veri içeriyor diye commercialDominant sayma.\n\nrecentTopicRepeat=true yalnız aday son dönemde yayımlanmış bir haberle aynı olayın devamı ya da semantik olarak çok dar biçimde aynı hikâyeyi tekrar ediyorsa olsun. Genel olarak aynı sanat dalında olmak tekrar değildir. Aynı olay zaten yayımlandıysa eligible=false; benzer ama yeni gelişme ise interest ve storyStrength'i düşür. realPersonCentered=true başlık/spot belirli ve gerçek bir kişiyi haberin ana öznesi yapıyorsa ver; bu alan görsel güvenliği için kullanılacak. topicCluster aynı olay veya çok dar hikâye için kısa ve kanonik bir etiket olsun (ör. "beijing-fashion-week-2026"); contentType ise exhibition, festival, film-release, award, heritage, design, city-life, profile veya other değerlerinden biri olsun.\n\nJSON biçimi: {"items":[{"id":"...","eligible":true,"category":"...","fit":0,"interest":0,"relevance":0,"storyStrength":0,"institutionalEvent":false,"commercialDominant":false,"recentTopicRepeat":false,"realPersonCentered":false,"topicCluster":"kısa-kanonik-etiket","contentType":"exhibition|festival|film-release|award|heritage|design|city-life|profile|other","reason":"kısa gerekçe"}]}. Adaylar:\n${JSON.stringify(batch)}${history}`
      }
    ]
  }, { signal });
  const raw = response.output_text.replace(/^```json\s*|\s*```$/g, '').trim();
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.items) ? parsed.items : [];
}

function chunks(items, size) {
  const result = [];
  for (let offset = 0; offset < items.length; offset += size) {
    result.push(items.slice(offset, offset + size));
  }
  return result;
}

function errorMessage(error) {
  return String(error?.message ?? error).slice(0, 500);
}

export async function rerankInputsResilient(input, {
  signal,
  batchSize = config.aiBatchSize,
  concurrency = config.aiRerankConcurrency,
  rerank = rerankBatch,
  logger = log
} = {}) {
  const batches = chunks(input, batchSize);
  let failedParts = 0;
  let recoveredParts = 0;

  const results = await mapLimit(batches, concurrency, async (batch, batchIndex) => {
    const batchNumber = batchIndex + 1;
    const startedAt = Date.now();
    logger('info', 'AI sıralama partisi başladı', {
      batch: batchNumber,
      totalBatches: batches.length,
      candidates: batch.length
    });

    try {
      const items = await rerank(batch, signal);
      logger('info', 'AI sıralama partisi tamamlandı', {
        batch: batchNumber,
        totalBatches: batches.length,
        candidates: batch.length,
        evaluated: items.length,
        elapsedMs: Date.now() - startedAt
      });
      return items;
    } catch (error) {
      if (signal?.aborted) throw error;

      const midpoint = Math.ceil(batch.length / 2);
      const retryParts = batch.length > 1
        ? [batch.slice(0, midpoint), batch.slice(midpoint)].filter((part) => part.length)
        : [batch];
      logger('warn', 'AI sıralama partisi başarısız; küçük parçalara bölünerek yeniden denenecek', {
        batch: batchNumber,
        totalBatches: batches.length,
        candidates: batch.length,
        retryParts: retryParts.length,
        elapsedMs: Date.now() - startedAt,
        error: errorMessage(error)
      });

      const recovered = [];
      for (let retryIndex = 0; retryIndex < retryParts.length; retryIndex += 1) {
        const retryPart = retryParts[retryIndex];
        const retryStartedAt = Date.now();
        try {
          const items = await rerank(retryPart, signal);
          recovered.push(...items);
          recoveredParts += 1;
          logger('info', 'AI sıralama alt partisi tamamlandı', {
            batch: batchNumber,
            retryPart: retryIndex + 1,
            retryParts: retryParts.length,
            candidates: retryPart.length,
            evaluated: items.length,
            elapsedMs: Date.now() - retryStartedAt
          });
        } catch (retryError) {
          if (signal?.aborted) throw retryError;
          failedParts += 1;
          logger('error', 'AI sıralama alt partisi başarısız; yalnız bu adaylar atlanacak', {
            batch: batchNumber,
            retryPart: retryIndex + 1,
            retryParts: retryParts.length,
            candidates: retryPart.length,
            elapsedMs: Date.now() - retryStartedAt,
            error: errorMessage(retryError)
          });
        }
      }
      return recovered;
    }
  });

  const items = results.flat();
  if (input.length > 0 && items.length === 0) {
    throw new Error('Tüm yapay zekâ sıralama partileri başarısız oldu.');
  }
  logger(failedParts > 0 ? 'warn' : 'info', 'AI sıralama aşaması tamamlandı', {
    candidates: input.length,
    evaluated: items.length,
    batches: batches.length,
    recoveredParts,
    failedParts
  });
  return items;
}

function rerankInput(candidate) {
  return {
    id: candidate.id,
    title: candidate.title,
    summary: candidate.summary?.slice(0, 450) ?? '',
    source: candidate.source.name,
    preliminary_category: candidate.category,
    published_at: candidate.publishedAt
  };
}

export async function rerankCandidates(candidates, { signal } = {}) {
  if (!candidates.length) return [];
  const [recentContext, sourceHealth] = await Promise.all([
    loadRecentEditorialContext(signal),
    loadSourceHealth(signal)
  ]);
  const blockedSources = [...sourceHealth.entries()].filter(([, health]) => health.blocked).map(([sourceId]) => sourceId);
  const eligibleCandidates = candidates.filter((candidate) => !sourceHealth.get(candidate.source?.id)?.blocked);
  log('info', 'Editoryal seçim bağlamı hazırlandı', {
    recentTopics: recentContext.length,
    sourceHealthEntries: sourceHealth.size,
    blockedSources
  });
  const shortlist = buildBalancedShortlist(eligibleCandidates);
  const contextualRerank = (batch, batchSignal) => rerankBatch(batch, batchSignal, recentContext);
  const items = await rerankInputsResilient(shortlist.map(rerankInput), { signal, rerank: contextualRerank });
  let ranked = applyAiScores(shortlist, items, new Date(), sourceHealth, recentContext);

  // Genel editör turunda sinema adayları gereğinden fazla elenmişse, zaten kısa listeye
  // girmiş güçlü sinema adaylarını ikinci kez yalnız sinema ölçütleriyle değerlendir.
  // Bu tur uygunluk eşiğini düşürmez; yalnız kategori yorumunu daha isabetli hale getirir.
  const cinemaCount = ranked.filter((candidate) => candidate.eligible && candidate.category === 'sinema').length;
  if (cinemaCount < 2) {
    const cinemaRescuePool = selectCinemaRescueCandidates(shortlist, ranked, Math.min(8, config.cinemaAiReserve));
    if (cinemaRescuePool.length) {
      log('info', 'Sinema post-AI kurtarma turu başladı', {
        existingCinema: cinemaCount,
        candidates: cinemaRescuePool.length
      });
      try {
        const cinemaRerank = (batch, batchSignal) => rerankBatch(batch, batchSignal, recentContext, { cinemaRescue: true });
        const cinemaItems = await rerankInputsResilient(cinemaRescuePool.map(rerankInput), {
          signal,
          rerank: cinemaRerank
        });
        const cinemaRescued = applyAiScores(cinemaRescuePool, cinemaItems, new Date(), sourceHealth, recentContext)
          .filter((candidate) => candidate.eligible && candidate.category === 'sinema');
        ranked = mergeRankedCandidates(ranked, cinemaRescued);
        log('info', 'Sinema post-AI kurtarma turu tamamlandı', {
          evaluated: cinemaRescuePool.length,
          rescued: cinemaRescued.length,
          totalCinema: ranked.filter((candidate) => candidate.eligible && candidate.category === 'sinema').length
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        log('warn', 'Sinema post-AI kurtarma turu başarısız; ilk AI sıralaması korunacak', {
          candidates: cinemaRescuePool.length,
          error: errorMessage(error)
        });
      }
    }
  }

  if (config.rescueAiCandidates <= 0 || shortlist.length >= eligibleCandidates.length) return ranked;
  const counts = Object.fromEntries([...allowedCategories].map((category) => [
    category,
    ranked.filter((candidate) => candidate.eligible && candidate.category === category).length
  ]));
  const sparseCategories = new Set(
    Object.entries(counts)
      .filter(([, count]) => count < config.categoryRescueMinCandidates)
      .map(([category]) => category)
  );
  if (!sparseCategories.size) return ranked;

  const used = new Set(shortlist.map((candidate) => candidate.id));
  const remainder = eligibleCandidates.filter((candidate) => !used.has(candidate.id) && candidate.eligible !== false);
  const preferred = remainder
    .filter((candidate) => sparseCategories.has(candidate.category))
    .sort((left, right) => right.score - left.score);
  const backup = remainder
    .filter((candidate) => !sparseCategories.has(candidate.category))
    .sort((left, right) => right.score - left.score);
  const rescuePool = [...preferred, ...backup].slice(0, config.rescueAiCandidates);
  if (!rescuePool.length) return ranked;

  log('info', 'Kategori kurtarma AI turu başladı', {
    sparseCategories: [...sparseCategories],
    candidates: rescuePool.length
  });
  try {
    const rescueItems = await rerankInputsResilient(rescuePool.map(rerankInput), { signal, rerank: contextualRerank });
    const rescued = applyAiScores(rescuePool, rescueItems, new Date(), sourceHealth, recentContext);
    log('info', 'Kategori kurtarma AI turu tamamlandı', {
      evaluated: rescued.length,
      eligible: rescued.filter((candidate) => candidate.eligible).length,
      queues: Object.fromEntries([...allowedCategories].map((category) => [
        category,
        rescued.filter((candidate) => candidate.eligible && candidate.category === category).length
      ]))
    });
    return [...ranked, ...rescued];
  } catch (error) {
    if (signal?.aborted) throw error;
    log('warn', 'Kategori kurtarma AI turu başarısız; başarılı ilk AI sıralaması korunacak', {
      sparseCategories: [...sparseCategories],
      candidates: rescuePool.length,
      error: errorMessage(error)
    });
    return ranked;
  }
}
