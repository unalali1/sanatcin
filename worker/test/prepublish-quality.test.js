import test from 'node:test';
import assert from 'node:assert/strict';
import { prepublishQuality, assertPrepublishQuality } from '../src/prepublish-quality.js';
import { buildEditorialReport, log } from '../src/logger.js';

const source = {
  url: 'https://example.org/arts/film',
  title: 'A film wins the Busan prize',
  text: 'The film won a prize at Busan. The award makes it eligible to apply to the Oscars. The festival ended October 15.'
};
const factSheet = { facts: ['Film Busan’da ödül kazandı.', 'Oscar için başvuru hakkı elde etti.'], numbers: ['15'] };
const draft = {
  title: 'Film Busan’da büyük ödülü kazandı',
  excerpt: 'Yapım, festivaldeki ana yarışmanın ardından Oscar için başvuru hakkı da elde etti; gösterimler 15 Ekim’de sona erdi.',
  paragraphs: [
    'Film, Busan’daki ana yarışmada büyük ödülü kazandı. Böylece Oscar için başvuru hakkı elde etti.',
    'Festivalde filmin yönetmeni ve oyuncuları gösterime katıldı.',
    'Yapımın gelecek gösterimleri henüz açıklanmadı.'
  ]
};

test('a fluent but unsupported headline number is a stage A stop', () => {
  const review = prepublishQuality({ source, factSheet, draft: { ...draft, title: 'Film Busan’da 27 ödül kazandı' } });
  assert.ok(review.accuracy.some(item => item.code === 'unsupported_headline_number' && item.severity === 'critical'));
  assert.throws(() => assertPrepublishQuality(review), /QUALITY_FACT/);
});

test('a fluent body cannot add a source-absent number', () => {
  const review = prepublishQuality({ source, factSheet, draft: { ...draft, paragraphs: [...draft.paragraphs, 'Filmi 99 ülkede izleyici bekliyor.'] } });
  assert.ok(review.accuracy.some(item => item.code === 'unsupported_body_number'));
  assert.equal(review.publishable, false);
});

test('Oscar application right cannot turn into a nomination even if title sounds natural', () => {
  const review = prepublishQuality({ source, factSheet, draft: { ...draft, title: 'Busan’da ödül kazanan film Oscar’a aday oldu' } });
  assert.ok(review.accuracy.some(item => item.code === 'oscar_candidacy_overclaim'));
});

test('correct claim with a mechanical arts title needs repair, not a guessed factual change', () => {
  const review = prepublishQuality({ source, factSheet, draft: { ...draft, title: 'Asya markaları gurme kokuları tatlı ekseninin dışına taşıdı' } });
  assert.equal(review.accuracy.length, 0);
  assert.ok(review.language.some(item => item.code === 'fragrance_axis' && item.severity === 'major'));
  assert.throws(() => assertPrepublishQuality(review), /QUALITY_LANGUAGE/);
});

test('valid copy with a small stylistic difference does not trigger an automatic stop', () => {
  const review = prepublishQuality({ source, factSheet, draft });
  assert.equal(review.publishable, true);
  assert.doesNotThrow(() => assertPrepublishQuality(review));
});

test('an invalid or missing source link is a stage A stop', () => {
  const review = prepublishQuality({ source: { ...source, url: 'javascript:alert(1)' }, factSheet, draft });
  assert.ok(review.accuracy.some(item => item.code === 'source_link_invalid'));
});

test('a one-letter corruption of a verified full person name is stopped', () => {
  const review = prepublishQuality({ source, factSheet: { ...factSheet, people: ['Charles Dutoit'] },
    draft: { ...draft, title: 'Charles Dutoi Busan’da büyük ödülü kazandı' } });
  assert.ok(review.accuracy.some(item => item.code === 'verified_person_typo'));
});

test('existing daily report includes gate, draft and duplicate-image decisions', () => {
  log('info', 'Yayın öncesi editoryal kapı', { articleUrl: source.url, passed: true, headlineRewritten: true, mechanicalExpressionsCorrected: 2, accuracy: [], language: [] });
  log('info', 'Editoryal taslak kararı', { articleUrl: source.url, selected: 'polished_or_repaired', reason: 'style_override', remainingIssues: [] });
  log('warn', 'Yinelenen görseller ayıklandı', { articleUrl: source.url, count: 2 });
  log('warn', 'Yayın öncesi editoryal kapı', { articleUrl: 'https://example.org/arts/other', passed: false, headlineRewritten: false,
    mechanicalExpressionsCorrected: 0, accuracy: [{ severity: 'critical', code: 'unsupported_body_number' }], language: [] });
  const report = buildEditorialReport({ sourceStats: { example: { attempted: 2, published: 1, rejected: 1 } }, results: [{ postId: 1 }] });
  assert.deepEqual({ processed: report.editorialQuality.candidatesProcessed, passed: report.editorialQuality.articlesPassed,
    rewritten: report.editorialQuality.headlinesRewritten, corrected: report.editorialQuality.mechanicalExpressionsCorrected,
    duplicate: report.editorialQuality.duplicateImagesRemoved },
  { processed: 2, passed: 1, rewritten: 1, corrected: 2, duplicate: 2 });
  assert.equal(report.editorialQuality.draftDecisions.at(-1).reason, 'style_override');
  assert.equal(report.editorialQuality.sourceAccuracyStopped, 1);
  assert.equal(report.editorialQuality.editorReferrals, 1);
});
