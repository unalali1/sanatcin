import OpenAI from 'openai';
import { config } from './config.js';
import { freshnessPoints } from './score.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });
const allowedCategories = new Set(['kultur-sanat', 'sinema', 'moda-tasarim', 'sehir-yasam']);

export function applyAiScores(candidates, items, now = new Date()) {
  const byId = new Map(items.map((item) => [String(item.id), item]));
  return candidates.map((candidate) => {
    const ai = byId.get(String(candidate.id));
    if (!ai) return candidate;
    const category = allowedCategories.has(ai.category) ? ai.category : candidate.category;
    const interest = Math.max(0, Math.min(100, Number(ai.interest) || 0));
    const relevance = Math.max(0, Math.min(100, Number(ai.relevance) || 0));
    const score =
      freshnessPoints(candidate.publishedAt, now) +
      interest * 0.30 +
      relevance * 0.20 +
      Math.min(10, candidate.source.quality ?? 5);
    return { ...candidate, category, score: Math.round(score * 10) / 10, scoreReason: String(ai.reason ?? '').slice(0, 240) };
  });
}

export async function rerankCandidates(candidates) {
  if (!candidates.length) return [];
  const batch = candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 80)
    .map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      summary: candidate.summary?.slice(0, 350) ?? '',
      source: candidate.source.name,
      preliminary_category: candidate.category,
      published_at: candidate.publishedAt
    }));

  const response = await client.responses.create({
    model: config.openaiModel,
    input: [
      {
        role: 'system',
        content: 'SanatÇin için haber seçen kıdemli bir Türkçe kültür-sanat editörüsün. Yalnız geçerli JSON ver. Siyasi propaganda, sıradan protokol, reklam ve zayıf PR metinlerine düşük puan ver. Türkiye’deki okur için yenilik, görsel güç, özgünlük ve somut kültürel değer arıyoruz.'
      },
      {
        role: 'user',
        content: `Her adayı dört kategoriden birine koy: kultur-sanat, sinema, moda-tasarim, sehir-yasam. interest ve relevance alanlarını 0-100 puanla. Aynı olayı tekrar eden adaylara düşük interest ver. JSON biçimi: {"items":[{"id":"...","category":"...","interest":0,"relevance":0,"reason":"kısa gerekçe"}]}. Adaylar:\n${JSON.stringify(batch)}`
      }
    ]
  });
  const raw = response.output_text.replace(/^```json\s*|\s*```$/g, '').trim();
  const parsed = JSON.parse(raw);
  return applyAiScores(candidates, Array.isArray(parsed.items) ? parsed.items : []);
}

