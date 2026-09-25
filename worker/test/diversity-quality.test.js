import test from 'node:test';
import assert from 'node:assert/strict';
import { likelyDuplicateTitles, normalizeNewsroomTerms, numericFactRegression } from '../src/quality.js';
import { buildBalancedShortlist } from '../src/rank.js';
import { preflightCandidates } from '../src/preflight.js';

test('festival prefix cannot conflate a gala with legends or another year', () => {
  assert.equal(likelyDuplicateTitles('2026 Mid-Autumn Festival Gala: Behind the scenes of a stage spectacle', 'Mid-Autumn Festival: Three legends of mooncakes and the Jade Rabbit'), false);
  assert.equal(likelyDuplicateTitles('Çin’de Güz Ortası Bayramı galasının sahne arkası', 'Çin’de Güz Ortası Bayramı: Ay çöreğinden Yeşim Tavşan’a üç efsane'), false);
  assert.equal(likelyDuplicateTitles('London returns twelve stolen Chinese cultural relics', 'London returns twelve stolen Chinese cultural relics to China'), true);
});

test('each category gets space even when cinema and one publisher dominate', () => {
  const categories = ['kultur-sanat', 'sinema', 'moda-tasarim', 'sehir-yasam'];
  const candidates = categories.flatMap((category, c) => Array.from({ length: 24 }, (_, i) => ({
    id: `${c}-${i}`, category, title: category === 'sinema' ? `Film premiere ${i}` : `Story ${i}`,
    score: 100 - c * 10 - i, source: { id: `s${i % 3}`, publisherGroup: `p${i % 3}` }
  })));
  const result = buildBalancedShortlist(candidates, 20);
  assert.equal(result.length, 20);
  for (const category of categories) assert.ok(result.filter(x => x.category === category).length >= 4);
  assert.equal(new Set(result.map(x => x.id)).size, 20);
});

test('preflight rejects only confirmed bad bodies, reuses good ones and retains network failures', async () => {
  const items = ['good', 'gallery', 'timeout', 'unvisited'].map(id => ({ id, url: id, source: {} }));
  const result = await preflightCandidates(items, items.slice(0, 3), { extract: async c => {
    if (c.id === 'gallery') throw new Error('Kaynak kısa duyuru veya görsel altyazı dizisi');
    if (c.id === 'timeout') throw new Error('fetch failed');
    return { ...c, text: 'Real article body' };
  } });
  assert.deepEqual(result.candidates.map(x => x.id), ['good', 'timeout', 'unvisited']);
  assert.equal(result.articles.get('good').text, 'Real article body');
  assert.equal(result.rejected.size, 1);
});

test('preflight obeys its deadline and does not drop unverified candidates', async () => {
  const items = Array.from({length: 12}, (_, i) => ({ id: i, url: String(i), source: {} }));
  let calls = 0;
  const result = await preflightCandidates(items, items, { concurrency: 2, maxMs: 10, extract: async (c, { signal }) => {
    calls++;
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }));
  } });
  assert.equal(calls, 2);
  assert.equal(result.candidates.length, 12);
  assert.equal(result.rejected.size, 0);
});

test('newsroom terms do not rewrite another country’s national day', () => {
  assert.equal(normalizeNewsroomTerms('Çin Ulusal Günü tatili ve Orta Sonbahar Festivali'), 'Çin Milli Bayramı tatili ve Güz Ortası Bayramı');
  assert.equal(normalizeNewsroomTerms('Fransa Ulusal Günü'), 'Fransa Ulusal Günü');
});

test('polishing keeps dates and counts even when moved between headline and body', () => {
  const before = { title: '12 eser', text: '23 Eylül 2026 tarihinde iade edildi.' };
  assert.equal(numericFactRegression(before, { title: 'Eserler iade edildi', text: '12 eser 23 Eylül 2026 tarihinde teslim edildi.' }), false);
  assert.equal(numericFactRegression(before, { title: 'Eserler iade edildi', text: '23 Eylül 2026 tarihinde teslim edildi.' }), true);
});
