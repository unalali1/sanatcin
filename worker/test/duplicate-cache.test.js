import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNoSimilarPublishedTitle, assertNoSimilarPublishedCandidate } from '../src/wordpress.js';

test('concurrent and early/final duplicate checks share one WordPress request', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    await Promise.resolve();
    return { ok: true, status: 200, json: async () => [{
      id: 1, title: { rendered: 'Pekin’de bağımsız sinema festivali başladı' },
      meta: { sanatcin_original_title: 'Independent cinema festival opens in Beijing' }
    }] };
  };
  try {
    await Promise.all([
      assertNoSimilarPublishedTitle('Şanghay’da yeni bir tasarım koleksiyonu tanıtıldı'),
      assertNoSimilarPublishedCandidate('A new collection of ceramic tableware')
    ]);
    await assert.rejects(assertNoSimilarPublishedTitle('Pekin’de bağımsız sinema festivali başladı'), /Benzer haber/);
    await assert.rejects(assertNoSimilarPublishedCandidate('Independent cinema festival opens in Beijing'), /daha önce/);
    assert.equal(requests, 1);
  } finally { globalThis.fetch = originalFetch; }
});
