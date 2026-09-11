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

export function applyAiScores(candidates, items, now = new Date()) {
  const byId = new Map(items.map((item) => [String(item.id), item]));
  return candidates.map((candidate) => {
    const ai = byId.get(String(candidate.id));
    if (!ai) return { ...candidate, eligible: false, category: 'uygunsuz', score: 0, scoreReason: 'Yapay zekâ editoryal değerlendirmesi alınamadı.' };
    const eligible = ai.eligible === true && allowedCategories.has(ai.category);
    const category = eligible ? ai.category : 'uygunsuz';
    const interest = Math.max(0, Math.min(100, Number(ai.interest) || 0));
    const relevance = Math.max(0, Math.min(100, Number(ai.relevance) || 0));
    const score =
      freshnessPoints(candidate.publishedAt, now) +
      interest * 0.30 +
      relevance * 0.20 +
      Math.min(10, candidate.source.quality ?? 5);
    return { ...candidate, eligible, category, score: eligible ? Math.round(score * 10) / 10 : 0, scoreReason: String(ai.reason ?? '').slice(0, 240) };
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

async function rerankBatch(batch, signal) {
  const response = await client.responses.create({
    model: config.openaiModel,
    input: [
      {
        role: 'system',
        content: 'SanatÇin için haber seçen kıdemli bir Türkçe kültür-sanat editörüsün. Yalnız geçerli JSON ver. Finans, ekonomi, borsa, bankacılık, siyaset, askerî gündem, spor, sıradan protokol, reklam ve zayıf PR metinleri kesinlikle kapsam dışıdır. Türkiye’deki okur için güncellik, somut gelişme, görsel güç, özgünlük ve kültürel değer arıyoruz.'
      },
      {
        role: 'user',
        content: `Her adayı bağımsız değerlendir; hiçbir adayı atlama. Yalnız gerçek kültür-sanat, sinema, moda-tasarım ve şehir yaşamı haberleri eligible=true olabilir. Finans/ekonomi/siyaset/spor/protokol/kurumsal PR için eligible=false ve category="uygunsuz" ver. Uygun adayları kultur-sanat, sinema, moda-tasarim veya sehir-yasam kategorisine koy. Kaynağın varsayılan kategorisini gerektiğinde değiştir. interest ve relevance alanlarını 0-100 puanla. Aynı olayı tekrar eden adaylara düşük interest ver. JSON biçimi: {"items":[{"id":"...","eligible":true,"category":"...","interest":0,"relevance":0,"reason":"kısa gerekçe"}]}. Adaylar:\n${JSON.stringify(batch)}`
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

export async function rerankCandidates(candidates, { signal } = {}) {
  if (!candidates.length) return [];
  const shortlist = buildBalancedShortlist(candidates);
  const input = shortlist.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      summary: candidate.summary?.slice(0, 350) ?? '',
      source: candidate.source.name,
      preliminary_category: candidate.category,
      published_at: candidate.publishedAt
    }));
  const items = await rerankInputsResilient(input, { signal });
  return applyAiScores(shortlist, items);
}
