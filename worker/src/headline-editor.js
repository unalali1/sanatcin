/** Deterministic checks around AI headline choices. Model scores are advisory. */
import { contextualArtsFindings } from './arts-editor.js';
export const HEADLINE_SCORE_WEIGHTS = Object.freeze({
  accuracy: 30,
  turkish: 25,
  interest: 20,
  clarity: 15,
  seo: 10
});

const OVERUSED = /(?:dikkat çekiyor|öne çıkıyor|buluşuyor|buluştu|sahneye taşındı|yeniden hayat buluyor|görücüye çıktı|yer alıyor|aynı sahneyi paylaştı)/iu;
const DIGIT = /(?<![\p{L}\p{N}])\d+(?:[.,]\d+)*(?![\p{L}\p{N}])/gu;
const NUMERIC_CLAIM = /\d/u;

/** Return only 85+ point candidates whose explicit facts pass basic checks. */
export function rankedHeadlineCandidates(response, { factSheet = {}, excerpt = '', body = '' } = {}) {
  const entries = response?.candidates;
  // Never fall back to an unreviewed single AI suggestion.
  if (!Array.isArray(entries) || entries.length !== 3) return [];
  const evidence = String(JSON.stringify(factSheet)) + ' ' + excerpt + ' ' + body;
  const allowedNumbers = new Set(evidence.match(DIGIT) ?? []);
  const seen = new Set();
  const ranking = [];

  for (const candidate of entries) {
    const title = String(candidate?.title ?? '').replace(/\s+/gu, ' ').trim();
    const canonical = title.toLocaleLowerCase('tr-TR');
    if (!title || seen.has(canonical)) continue;
    seen.add(canonical);
    if (title.length < 32 || title.length > 82 || /[\u3400-\u9fff]/u.test(title)) continue;
    if (NUMERIC_CLAIM.test(title) && (title.match(DIGIT) ?? []).some(number => !allowedNumbers.has(number))) continue;
    if (contextualArtsFindings({ title, excerpt, text: body }, factSheet)
      .some(item => item.severity === 'repair' && (item.field === 'title' || item.field === 'title_spot'))) continue;

    let score = 0;
    let valid = true;
    for (const [key, max] of Object.entries(HEADLINE_SCORE_WEIGHTS)) {
      const value = candidate?.scores?.[key];
      if (!Number.isInteger(value) || value < 0 || value > max) {
        valid = false;
        break;
      }
      score += value;
    }
    if (!valid) continue;
    // Tired phrases must demonstrate significantly higher merit elsewhere.
    if (OVERUSED.test(title)) score -= 12;
    if (score < 85) continue;
    ranking.push({
      title,
      score,
      angle: String(candidate?.angle ?? '').slice(0, 48),
      reason: String(candidate?.reason ?? '').slice(0, 160)
    });
  }
  return ranking.sort((a, b) => b.score - a.score);
}
