import test from 'node:test';
import assert from 'node:assert/strict';
import { HEADLINE_RUBRIC, headlineCandidates, chooseVerifiedHeadline } from '../src/headline-selection.js';

const old = 'Şanghay’da çağdaş zanaata odaklanan yeni sergi açıldı';
const choices = [
  'Şanghay’daki sergide geleneksel zanaat yeniden yorumlanıyor',
  'Şanghay sergisinde 18 sanatçının 42 eseri buluşuyor',
  'Şanghay’da geleneksel zanaat çağdaş yorum kazanıyor'
];

test('başlık kalite değerlendirmesinde doğruluk en yüksek ağırlıktadır', () => {
  assert.equal(Object.values(HEADLINE_RUBRIC).reduce((a, b) => a + b, 0), 100);
  assert.equal(HEADLINE_RUBRIC.sourceFidelity, 30);
});

test('tam üç açı, tekrar ve karakter güvenliği olmadan otomatik başlık seçimi yapılmaz', () => {
  assert.deepEqual(headlineCandidates({ candidates: choices }, old), choices);
  assert.deepEqual(headlineCandidates({ candidates: choices.slice(0, 2) }, old), []);
  assert.equal(headlineCandidates({ candidates: [old, choices[1], choices[1]] }, old).length, 1);
  assert.deepEqual(headlineCandidates({ candidates: ['', 'A', 'Çok kısa'] }, old), []);
});

test('hakem sadece izinli ve 90 veya üstü başlığı seçebilir', () => {
  assert.equal(chooseVerifiedHeadline({ accepted: true, selectedTitle: choices[2], score: 94 }, old, choices), choices[2]);
  assert.equal(chooseVerifiedHeadline({ accepted: true, selectedTitle: choices[2], score: 89 }, old, choices), old);
  assert.equal(chooseVerifiedHeadline({ accepted: true, selectedTitle: 'Yeni ama doğrulanmayan başlık', score: 100 }, old, choices), old);
  assert.equal(chooseVerifiedHeadline({ accepted: false, selectedTitle: choices[2], score: 99 }, old, choices), old);
  assert.equal(chooseVerifiedHeadline({ preferred: 'B' }, old, choices), old);
  assert.equal(chooseVerifiedHeadline({ preferred: 'B' }, old, [choices[2]], { legacy: true }), choices[2]);
});
