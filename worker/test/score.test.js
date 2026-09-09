import test from 'node:test';
import assert from 'node:assert/strict';
import { freshnessPoints, hasExcludedTopic, inferCategory, scoreCandidate, selectByCategory } from '../src/score.js';
import { applyAiScores } from '../src/rank.js';

const source = { id: 'test', name: 'Test', quality: 9, defaultCategory: null };

test('başlıktan sinema kategorisini bulur', () => {
  assert.equal(inferCategory({ title: 'Chinese film sets a new box office record', summary: '', source }), 'sinema');
});

test('24 saatlik haber en yüksek güncellik puanını alır', () => {
  const now = new Date('2026-09-08T12:00:00Z');
  assert.equal(freshnessPoints('2026-09-08T01:00:00Z', now), 35);
  assert.equal(freshnessPoints('2026-08-20T01:00:00Z', now), 0);
});

test('kategori başına ikiden fazla haber seçmez', () => {
  const candidates = Array.from({ length: 5 }, (_, index) => scoreCandidate({
    id: `${index}`, title: `New film premiere ${index}`, summary: 'cinema', url: `https://example.com/${index}`, publishedAt: new Date().toISOString(), source
  }));
  assert.equal(selectByCategory(candidates, 2).length, 2);
});

test('AI puanı kategori ve ilgi değerini nihai skora uygular', () => {
  const now = new Date('2026-09-08T12:00:00Z');
  const candidate = scoreCandidate({ id:'a', title:'New museum opens', summary:'art', url:'https://example.com/a', publishedAt:'2026-09-08T01:00:00Z', source }, now);
  const [ranked] = applyAiScores([candidate], [{ id:'a', eligible:true, category:'kultur-sanat', interest:90, relevance:100, reason:'özgün sergi' }], now);
  assert.equal(ranked.category, 'kultur-sanat');
  assert.equal(ranked.score, 91);
});

test('bankacılık haberi kaynak kategorisi olsa bile kapsam dışı kalır', () => {
  const candidate = { id:'f', title:'Bank capital injection reaches 50 billion yuan', summary:'financial institution', url:'https://example.com/f', publishedAt:new Date().toISOString(), source:{ ...source, defaultCategory:'sehir-yasam' } };
  assert.equal(hasExcludedTopic(candidate), true);
  const scored = scoreCandidate(candidate);
  assert.equal(scored.eligible, false);
  assert.equal(scored.category, 'uygunsuz');
});

test('AI kapsam dışı kararı deterministik kategoriyi geri getirmez', () => {
  const candidate = scoreCandidate({ id:'p', title:'New city museum opens', summary:'culture', url:'https://example.com/p', publishedAt:new Date().toISOString(), source });
  const [ranked] = applyAiScores([candidate], [{ id:'p', eligible:false, category:'uygunsuz', interest:0, relevance:0, reason:'protokol haberi' }]);
  assert.equal(ranked.eligible, false);
  assert.equal(ranked.category, 'uygunsuz');
  assert.equal(ranked.score, 0);
});

test('AI değerlendirmesi gelmeyen aday yayıma alınmaz', () => {
  const candidate = scoreCandidate({ id:'missing', title:'New museum opens in Shanghai', summary:'culture and art', url:'https://example.com/missing', publishedAt:new Date().toISOString(), source });
  const [ranked] = applyAiScores([candidate], []);
  assert.equal(ranked.eligible, false);
  assert.equal(ranked.category, 'uygunsuz');
});
