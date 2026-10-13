// Pure, conservative title selection helpers. Semantic truth is checked by the caller.
export const HEADLINE_RUBRIC = Object.freeze({
  sourceFidelity: 30,
  newsValue: 25,
  turkishFluency: 20,
  readerInterest: 15,
  clarity: 10
});

const normalize = value => String(value ?? '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('tr-TR');

export function headlineCandidates(result = {}, currentTitle = '') {
  const isBatch = Array.isArray(result?.candidates);
  const raw = isBatch ? result.candidates : (result?.title ? [result.title] : []);
  // For the new multi-angle contract, never silently pass one weak draft as three choices.
  if (isBatch && raw.length !== 3) return [];
  // Structured model output must carry the three intended editorial angles.
  if (isBatch && raw.every(item => item && typeof item === 'object')) {
    const angles = raw.map(item => item.angle);
    if (new Set(angles).size !== 3 || !['main', 'distinctive', 'cultural'].every(angle => angles.includes(angle))) return [];
  }
  const seen = new Set([normalize(currentTitle)]);
  const titles = [];
  for (const item of raw) {
    const title = String(typeof item === 'string' ? item : item?.title ?? '').trim().replace(/\s+/gu, ' ');
    const key = normalize(title);
    if (title.length < 32 || title.length > 82 || !key || seen.has(key)) continue;
    seen.add(key);
    titles.push(title);
  }
  return titles;
}

export function chooseVerifiedHeadline(judgement = {}, currentTitle = '', eligibleTitles = [], { legacy = false } = {}) {
  if (judgement?.accepted === true && typeof judgement.selectedTitle === 'string') {
    const selected = eligibleTitles.find(title => normalize(title) === normalize(judgement.selectedTitle));
    // A model cannot insert a fourth unvetted headline or choose a sub-90 graded headline.
    const score = Number(judgement.score);
    if (selected && Number.isFinite(score) && score >= 90) return selected;
    return currentTitle;
  }
  // Compatibility with pre-existing unit tests and one-title legacy output only;
  // a three-choice judgement without an explicit selectedTitle fails closed.
  if (legacy && eligibleTitles.length === 1 && judgement?.preferred === 'B') return eligibleTitles[0];
  return currentTitle;
}
