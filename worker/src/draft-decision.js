import { editorialFluencyProfile, translationIssues, numericFactRegression, nativeNameRegression } from './quality.js';
import { newsroomFindings } from './editorial-review.js';

// These are publication safety faults, not a mandate to reject stylistic variation.
const BLOCKING = /Çince karakter|doğrulanmış yerel ad|kaynak-site artığı|yinelenen cümle|akıcı Türkçe haber dili olarak doğrulanamadı/iu;

export function assessDraftTransition(before, after, factSheet) {
  const beforeIssues = translationIssues(before, factSheet);
  const afterIssues = translationIssues(after, factSheet);
  const addedIssues = afterIssues.filter(issue => !beforeIssues.includes(issue));
  const factRegression = numericFactRegression(before, after);
  const namingRegression = nativeNameRegression(before, after, factSheet.nativeNames);
  return {
    factRegression, namingRegression, addedIssues,
    blocking: afterIssues.filter(issue => BLOCKING.test(issue)),
    language: addedIssues.filter(issue => !BLOCKING.test(issue)),
    repairFindings: newsroomFindings(after).filter(item => item.severity === 'repair')
  };
}

export function selectEditorialDraft(before, after, factSheet, decision = {}) {
  const assessment = assessDraftTransition(before, after, factSheet);
  if (assessment.factRegression || assessment.namingRegression || assessment.blocking.length || assessment.repairFindings.length) {
    return { selected: null, reason: 'unresolved_safety', assessment };
  }
  if (decision.factualConflict?.field && decision.factualConflict?.evidence) {
    return { selected: null, reason: 'judge_factual_conflict', assessment };
  }
  const a = editorialFluencyProfile(before);
  const b = editorialFluencyProfile(after);
  const betterLanguage = b.score >= a.score + 2 || b.newsroomIssueCount < a.newsroomIssueCount
    || (Number.isFinite(decision.bScore) && Number.isFinite(decision.aScore) && decision.bScore >= decision.aScore + 3);
  const worseLanguage = b.score < a.score - 5 || b.newsroomIssueCount > a.newsroomIssueCount;
  const selected = decision.preferred === 'B' || (decision.preferred === 'A' && betterLanguage && !worseLanguage) ? 'B' : 'A';
  return { selected, reason: selected === 'B' && decision.preferred === 'A' ? 'style_override' : 'judge_preference', assessment,
    scores: { before: a.score, after: b.score } };
}
