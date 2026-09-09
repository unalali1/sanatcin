import OpenAI from 'openai';
import { config } from './config.js';
import { freshnessPoints } from './score.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });
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
        content: 'SanatÇin için haber seçen kıdemli bir Türkçe kültür-sanat editörüsün. Yalnız geçerli JSON ver. Finans, ekonomi, borsa, bankacılık, siyaset, askerî gündem, spor, sıradan protokol, reklam ve zayıf PR metinleri kesinlikle kapsam dışıdır. Türkiye’deki okur için yenilik, görsel güç, özgünlük ve somut kültürel değer arıyoruz.'
      },
      {
        role: 'user',
        content: `Önce her adayın yayın kapsamına girip girmediğini belirle. Yalnız gerçek kültür-sanat, sinema, moda-tasarım ve şehir yaşamı haberleri eligible=true olabilir. Finans/ekonomi/siyaset/spor/protokol/kurumsal PR için eligible=false ve category="uygunsuz" ver. Uygun adayları kultur-sanat, sinema, moda-tasarim veya sehir-yasam kategorisine koy. interest ve relevance alanlarını 0-100 puanla. Aynı olayı tekrar eden adaylara düşük interest ver. JSON biçimi: {"items":[{"id":"...","eligible":true,"category":"...","interest":0,"relevance":0,"reason":"kısa gerekçe"}]}. Adaylar:\n${JSON.stringify(batch)}`
      }
    ]
  });
  const raw = response.output_text.replace(/^```json\s*|\s*```$/g, '').trim();
  const parsed = JSON.parse(raw);
  return applyAiScores(candidates, Array.isArray(parsed.items) ? parsed.items : []);
}
