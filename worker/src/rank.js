import OpenAI from 'openai';
import { config } from './config.js';
import { freshnessPoints } from './score.js';

const client = new OpenAI({
  apiKey: config.openaiApiKey,
  timeout: config.aiRequestTimeoutMs,
  maxRetries: config.aiMaxRetries
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
  const items = [];
  for (let offset = 0; offset < input.length; offset += config.aiBatchSize) {
    items.push(...await rerankBatch(input.slice(offset, offset + config.aiBatchSize), signal));
  }
  return applyAiScores(shortlist, items);
}
