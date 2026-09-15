import OpenAI from 'openai';
import { config } from './config.js';
import { mapLimit } from './concurrency.js';
import { log } from './logger.js';
import { freshnessPoints } from './score.js';
import { titleSimilarity } from './quality.js';

const client = new OpenAI({
  apiKey: config.openaiApiKey,
  timeout: config.aiRequestTimeoutMs,
  // Büyük bir sıralama isteğini aynı boyutta tekrar etmek yerine, başarısız
  // partiyi aşağıda iki küçük parçaya ayırarak bir kez daha deniyoruz.
  maxRetries: 0
});
const allowedCategories = new Set(['kultur-sanat', 'sinema', 'moda-tasarim', 'sehir-yasam']);

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

export function sourceCrowdingPenalty(previousCount = 0) {
  if (previousCount <= 0) return 0;
  if (previousCount === 1) return 3;
  if (previousCount === 2) return 8;
  return 15;
}

export function applyAiScores(candidates, items, now = new Date()) {
  const byId = new Map(items.map((item) => [String(item.id), item]));
  return candidates.map((candidate) => {
    const ai = byId.get(String(candidate.id));
    if (!ai) return { ...candidate, eligible: false, category: 'uygunsuz', score: 0, scoreReason: 'Yapay zekâ editoryal değerlendirmesi alınamadı.' };
    const editorialFit = clamp(ai.fit, 0, 10, 7);
    const interest = clamp(ai.interest, 0, 100, 0);
    const relevance = clamp(ai.relevance, 0, 100, 0);
    const institutionalEvent = ai.institutionalEvent === true;
    const commercialDominant = ai.commercialDominant === true;
    const baseEligible = ai.eligible === true && allowedCategories.has(ai.category);
    const eligible = baseEligible
      && editorialFit >= config.minEditorialFit
      && !(commercialDominant && editorialFit <= 6);
    const category = eligible ? ai.category : 'uygunsuz';
    const sourceBoost = eligible ? categorySourceBoost(candidate, category) : 0;
    const fitAdjustment = (editorialFit - 7) * 4;
    const institutionalPenalty = institutionalEvent ? (editorialFit <= 6 ? 8 : 4) : 0;
    const commercialPenalty = commercialDominant ? 10 : 0;
    const rawScore =
      freshnessPoints(candidate.publishedAt, now) +
      interest * 0.30 +
      relevance * 0.20 +
      Math.min(10, candidate.source.quality ?? 5) +
      sourceBoost +
      fitAdjustment -
      institutionalPenalty -
      commercialPenalty;
    return {
      ...candidate,
      eligible,
      category,
      interest,
      relevance,
      editorialFit,
      institutionalEvent,
      commercialDominant,
      sourceBoost,
      institutionalPenalty,
      commercialPenalty,
      score: eligible ? Math.max(0, Math.min(100, Math.round(rawScore * 10) / 10)) : 0,
      scoreReason: String(ai.reason ?? '').slice(0, 320)
    };
  });
}

export function buildBalancedShortlist(candidates, maxCandidates = config.maxAiCandidates) {
  const eligible = candidates.filter((candidate) => candidate.eligible !== false);
  const selected = [];
  const used = new Set();
  const perCategory = Math.max(1, Math.floor(maxCandidates / allowedCategories.size));

  for (const category of allowedCategories) {
    const group = eligible
      .filter((candidate) => candidate.category === category)
      .sort((a, b) => b.score - a.score)
      .slice(0, perCategory);
    for (const candidate of group) {
      selected.push(candidate);
      used.add(candidate.id);
    }
  }

  if (selected.length < maxCandidates) {
    const remainder = eligible
      .filter((candidate) => !used.has(candidate.id))
      .sort((a, b) => b.score - a.score)
      .slice(0, maxCandidates - selected.length);
    selected.push(...remainder);
  }
  return selected.slice(0, maxCandidates);
}

export function diversifyBySource(candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const sourceId = candidate.source?.id ?? 'unknown';
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

function isNearTopicRepeat(candidate, selected) {
  return selected.some((prior) => {
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

async function rerankBatch(batch, signal) {
  const response = await client.responses.create({
    model: config.openaiSelectionModel,
    input: [
      {
        role: 'system',
        content: [
          'SanatÇin için haber seçen kıdemli bir Türkçe kültür-sanat editörüsün. Yalnız geçerli JSON ver.',
          'SanatÇin genel Çin haber sitesi değildir; sanat, kültür, moda, tasarım, sinema ve şehir kültürü ekseni belirleyicidir.',
          'Finans, makroekonomi, ihracat, üretim kapasitesi, otomotiv, sıradan teknoloji, diplomasi, askerî gündem, spor, protokol, reklam ve zayıf PR metinleri kültürel/yaratıcı bağ açık ve asli değilse kapsam dışıdır.',
          'Türkiye’deki okur için güncellik, somut gelişme, özgünlük, kültürel değer, geniş okuyucu ilgisi ve güçlü görsel potansiyel arıyoruz.',
          'Kategori kotasını doldurmak uğruna zayıf bir adayı uygun sayma; ancak orta düzey ama gerçek kültür-sanat haberlerini yalnız çok çarpıcı olmadıkları için reddetme.'
        ].join(' ')
      },
      {
        role: 'user',
        content: `Her adayı bağımsız değerlendir; hiçbir adayı atlama. Yalnız gerçek kültür-sanat, sinema, moda-tasarım ve şehir yaşamı haberleri eligible=true olabilir. Uygun adayları kultur-sanat, sinema, moda-tasarim veya sehir-yasam kategorisine koy; kaynağın varsayılan kategorisini gerektiğinde değiştir.\n\nfit alanı SanatÇin editoryal uyumunu 0-10 puanlasın: 0-4 konu dışı/zayıf uyum, 5-6 ancak daha güçlü aday yoksa kullanılabilecek gerçek ama ikincil kültür/lifestyle haberi, 7-8 güçlü uyum, 9-10 markanın merkezinde olması gereken içerik.\n\ninterest ve relevance alanlarını 0-100 puanla. Türkiye’de tanınmayan küçük bir kurumun rutin toplantısı, açılış töreni, konferansı veya kurumsal buluşması daha geniş bir kültürel sonuç, önemli isim, sıra dışı eser ya da özgün insan hikâyesi taşımıyorsa institutionalEvent=true ver ve fit'i 6'nın üstüne çıkarma. İhracat, satış, pazar payı, üretim, fabrika, şirket satın alması veya sektör büyüklüğü haberin ana gövdesiyse ve yaratıcı/kültürel unsur tali kalıyorsa commercialDominant=true ver; bu tür içerik çoğu durumda eligible=false olmalı. Moda/tasarım sektöründeki gerçek yaratıcı trendleri yalnız ticari veri içeriyor diye commercialDominant sayma. Aynı olay veya aynı dar temayı tekrar eden adaylara düşük interest ver.\n\nJSON biçimi: {"items":[{"id":"...","eligible":true,"category":"...","fit":0,"interest":0,"relevance":0,"institutionalEvent":false,"commercialDominant":false,"reason":"kısa gerekçe"}]}. Adaylar:\n${JSON.stringify(batch)}`
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
        evaluated: items.length
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
        error: errorMessage(error)
      });

      const recovered = [];
      for (let retryIndex = 0; retryIndex < retryParts.length; retryIndex += 1) {
        const retryPart = retryParts[retryIndex];
        try {
          const items = await rerank(retryPart, signal);
          recovered.push(...items);
          recoveredParts += 1;
          logger('info', 'AI sıralama alt partisi tamamlandı', {
            batch: batchNumber,
            retryPart: retryIndex + 1,
            retryParts: retryParts.length,
            candidates: retryPart.length,
            evaluated: items.length
          });
        } catch (retryError) {
          if (signal?.aborted) throw retryError;
          failedParts += 1;
          logger('error', 'AI sıralama alt partisi başarısız; yalnız bu adaylar atlanacak', {
            batch: batchNumber,
            retryPart: retryIndex + 1,
            retryParts: retryParts.length,
            candidates: retryPart.length,
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
  const shortlist = buildBalancedShortlist(candidates);
  const items = await rerankInputsResilient(shortlist.map(rerankInput), { signal });
  const ranked = applyAiScores(shortlist, items);

  if (config.rescueAiCandidates <= 0 || shortlist.length >= candidates.length) return ranked;
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
  const remainder = candidates.filter((candidate) => !used.has(candidate.id) && candidate.eligible !== false);
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
  const rescueItems = await rerankInputsResilient(rescuePool.map(rerankInput), { signal });
  const rescued = applyAiScores(rescuePool, rescueItems);
  log('info', 'Kategori kurtarma AI turu tamamlandı', {
    evaluated: rescued.length,
    eligible: rescued.filter((candidate) => candidate.eligible).length,
    queues: Object.fromEntries([...allowedCategories].map((category) => [
      category,
      rescued.filter((candidate) => candidate.eligible && candidate.category === category).length
    ]))
  });
  return [...ranked, ...rescued];
}