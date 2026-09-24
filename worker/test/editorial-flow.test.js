import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateForRound } from '../src/selection.js';
import { createRunBudget } from '../src/run-budget.js';
import { editorialCoverage } from '../src/run-report.js';
import { classifyError } from '../src/errors.js';
import { heroImageEligible, normalizeNewsroomTerms, newsroomLanguageIssues, editorialFluencyProfile } from '../src/quality.js';

const candidate = (id, source, score = 80, group = source) => ({
  id, title: `Film ${id}`, score, editorialFit: 8, source: { id: source, publisherGroup: group, quality: 9 }
});
const options = { fallbackActive: true, hardMinimum: 54, preferredMinimum: 62 };

test('a failed cinema source yields the next attempt to another publisher', () => {
  const queue = [candidate('1', 'cgtn', 90), candidate('2', 'china-daily', 75)];
  const selected = candidateForRound(queue, {}, { ...options, sourceFailures: { cgtn: 1 } });
  assert.equal(selected.candidate.id, '2');
  assert.equal(queue.length, 1);
});

test('two extraction failures cannot consume all five cinema attempts', () => {
  const queue = Array.from({ length: 5 }, (_, i) => candidate(`bad-${i}`, 'cgtn', 90));
  queue.push(candidate('good', 'china-daily', 75));
  const budget = createRunBudget({ maxAttemptsPerCategory: 5, maxRunMinutes: 15 });
  const failures = {};
  const attempted = [];
  while (budget.canAttempt('sinema')) {
    const next = candidateForRound(queue, {}, { ...options, sourceFailures: failures }).candidate;
    if (!next) break;
    budget.noteAttempt('sinema');
    attempted.push(next.id);
    if (next.id === 'good') break;
    failures[next.source.id] = (failures[next.source.id] ?? 0) + 1;
  }
  assert.deepEqual(attempted, ['bad-0', 'good']);
  assert.equal(budget.attemptsFor('sinema'), 2);
  assert.equal(candidateForRound([candidate('bad', 'cgtn')], {}, { ...options, sourceFailures: { cgtn: 2 } }).candidate, null);
});

test('publisher overflow only happens after other qualified publishers are exhausted', () => {
  const args = { ...options, publisherUseCounts: { daily: 2 }, allowPublisherOverflow: true };
  const queue = [candidate('overflow', 'daily-culture', 95, 'daily'), candidate('alternative', 'other', 65)];
  assert.equal(candidateForRound(queue, {}, args).candidate.id, 'alternative');
  assert.equal(candidateForRound(queue, {}, args).candidate.id, 'overflow');
});

test('source switching never relaxes quality floors or explicit exclusions', () => {
  const args = { ...options, sourceFailures: { cgtn: 1 }, excludedSourceIds: new Set(['other']) };
  const queue = [candidate('weak', 'weak', 53), candidate('excluded', 'other', 88), candidate('usable', 'cgtn', 70)];
  assert.equal(candidateForRound(queue, {}, args).candidate.id, 'usable');
});

test('four publications with an empty cinema category report 75 percent coverage', () => {
  const report = editorialCoverage({ 'kultur-sanat': 2, sinema: 0, 'moda-tasarim': 1, 'sehir-yasam': 1 }, [{ heroEligible: false }]);
  assert.deepEqual(report.missingCategories, ['sinema']);
  assert.equal(report.categoryCoveragePercent, 75);
  assert.equal(report.heroCoverageWarning, true);
  assert.equal(editorialCoverage({ 'kultur-sanat': 1, sinema: 1, 'moda-tasarim': 1, 'sehir-yasam': 1 }, [{ heroEligible: true }]).heroCoverageWarning, false);
});

test('hero enforces resolution, ratio, crop and scene without changing card thresholds', () => {
  assert.equal(heroImageEligible({ width: 1256, height: 706 }, true, 'exhibition', 'editorial-photo'), false);
  assert.equal(heroImageEligible({ width: 1400, height: 1000 }, true, 'exhibition', 'editorial-photo'), true);
  assert.equal(heroImageEligible({ width: 1600, height: 800 }, true, 'exhibition', 'editorial-photo'), false);
  assert.equal(heroImageEligible({ width: 1600, height: 1000 }, true, 'artifact', 'editorial-photo'), false);
  assert.equal(heroImageEligible({ width: 1600, height: 1000 }, true, 'conference', 'editorial-photo'), false);
  assert.equal(heroImageEligible({ width: 1600, height: 1000 }, false, 'performance', 'editorial-photo'), false);
});

test('observed jade translation defects no longer get a perfect fluency score', () => {
  const article = { title: 'Liu He’nin mührü Hotan yeşiminin izini sürüyor', text: 'Bu malzeme Çincede yeşim çakıl malzemesi olarak adlandırılıyor.' };
  assert.ok(newsroomLanguageIssues(article).length >= 3);
  assert.ok(editorialFluencyProfile(article).score < 86);
  assert.equal(normalizeNewsroomTerms('Pekin’deki National Art Museum of China'), 'Pekin’deki Çin Ulusal Sanat Müzesi');
  assert.equal(normalizeNewsroomTerms('Gao Yingpo ve Guan Yu'), 'Gao Yingpo ve Guan Yu');
});

test('source-title duplicate is classified as duplicate rather than editorial failure', () => {
  assert.equal(classifyError(new Error('Kaynak başlığı daha önce yayımlanan haberle eşleşiyor')).code, 'DUPLICATE');
});
