import test from 'node:test';
import assert from 'node:assert/strict';
import { rankedHeadlineCandidates as rank, HEADLINE_SCORE_WEIGHTS } from '../src/headline-editor.js';

const scores = (accuracy = 29, turkish = 24, interest = 18, clarity = 15, seo = 10) => ({
  accuracy, turkish, interest, clarity, seo
});
const good = (title, points = scores(), angle = 'gelişme') => ({ title, scores: points, angle });
const candidates = [
  good('Ming tacında 518 ince altın telin ustalığı'),
  good('Wanli İmparatoru’nun tacı Pekin’de sergileniyor', scores(30,24,16,15,9)),
  good('Pekin’de Ming hanedanından altın taç sergisi', scores(30,20,13,14,8))
];
const factSheet = { facts: ['Pekin’de sergi var.', 'Taç 518 altın telden oluşuyor.'], people: ['Wanli'] };

test('başlık değerlendirme ölçütlerinin toplamı 100 puandır', () => {
  assert.equal(Object.values(HEADLINE_SCORE_WEIGHTS).reduce((a,b) => a+b, 0), 100);
});

test('üç aday arasından en yüksek geçerli puanı seçer', () => {
  assert.equal(rank({ candidates }, { factSheet })[0].title, candidates[0].title);
});

test('kaynakta olmayan sayıyı 100 puan verilse bile reddeder', () => {
  const hallucinated = candidates.map(candidate => ({
    ...candidate,
    title: candidate.title.replace('518', '999') + ' 999',
    scores: scores(30,25,20,15,10)
  }));
  assert.deepEqual(rank({ candidates: hallucinated }, { factSheet }), []);
});

test('eksik ölçüt puanı olan adayları reddeder', () => {
  const malformed = candidates.map(candidate => ({ ...candidate, scores: { accuracy: 30 } }));
  assert.deepEqual(rank({ candidates: malformed }, { factSheet }), []);
});

test('üç alternatif verilmemişse mevcut başlığı korumaya imkân verir', () => {
  assert.deepEqual(rank({ candidates: candidates.slice(0,2) }, { factSheet }), []);
  assert.deepEqual(rank({ title: candidates[0].title }, { factSheet }), []);
});

test('85 puan altındaki adayları geçirmez', () => {
  const weak = candidates.map(candidate => ({ ...candidate, scores: scores(20,15,12,11,8) }));
  assert.deepEqual(rank({ candidates: weak }, { factSheet }), []);
});

test('sık tekrarlanan klişe yüksek puanı düşürür', () => {
  const vague = candidates.map(candidate => ({
    ...candidate, title: 'Pekin’de Ming hanedanından altın taç öne çıkıyor',
    scores: scores(29,24,18,15,10)
  }));
  assert.deepEqual(rank({ candidates: vague }, { factSheet }), []);
});

test('high-scoring but contextually unclear culture arts titles lose to a clear alternative', () => {
  const options = [
    good('Suchness defilesinde osmanthus kokusu keselerle yayıldı', scores(30,25,20,15,10)),
    good('Şanghay Moda Haftası’nda kıyafetlere osmanthus kokusu eşlik etti', scores(29,23,18,14,9)),
    good('Tasarımcı yeni koleksiyonda kokuyla giysileri birleştirdi', scores(28,22,17,13,8))
  ];
  const ranking = rank({ candidates: options }, { body: 'Şanghay Moda Haftası kapsamında Suchness koleksiyonu tanıtıldı.' });
  assert.equal(ranking[0].title, options[1].title);
  assert.ok(!ranking.some(item => item.title === options[0].title));
});
