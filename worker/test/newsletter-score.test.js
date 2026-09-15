import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateNewsletterScore,
  newsletterVisualStrength,
  scoreNewsletterPosts,
  selectNewsletterPostsByScore
} from '../src/newsletter-score.js';

function post(id, slug, score, date, title = `Haber ${id}`, width = 1200, height = 800) {
  return {
    id,
    date_gmt: date,
    link: `https://sanatcin.com/haber-${id}/`,
    title: { rendered: title },
    excerpt: { rendered: `<p>${title} için kısa özet.</p>` },
    meta: { sanatcin_score: score },
    _embedded: {
      'wp:term': [[{ id: id + 100, taxonomy: 'category', slug, name: slug }]],
      'wp:featuredmedia': [{
        source_url: `https://sanatcin.com/img-${id}.jpg`,
        alt_text: `${title} görseli`,
        media_details: { width, height, sizes: { large: { source_url: `https://sanatcin.com/img-${id}-large.jpg`, width, height } } }
      }]
    }
  };
}

test('newsletterScore önerilen altı ağırlığı uygular', () => {
  const score = calculateNewsletterScore({
    weeklyImportance: 100,
    editorialFit: 80,
    originality: 60,
    visualStrength: 40,
    readerInterest: 20,
    recency: 100
  });
  assert.equal(score, 69);
});

test('yüksek çözünürlüklü öne çıkan görsel daha güçlü görsel puanı alır', () => {
  const high = post(1, 'kultur-sanat', 70, '2026-09-14T10:00:00Z', 'Yüksek görsel', 1800, 1200);
  const low = post(2, 'kultur-sanat', 70, '2026-09-14T10:00:00Z', 'Düşük görsel', 600, 400);
  assert.ok(newsletterVisualStrength(high) > newsletterVisualStrength(low));
});

test('AI anahtarı yoksa newsletterScore deterministik fallback ile yine üretilir', async () => {
  const posts = [
    post(1, 'kultur-sanat', 80, '2026-09-14T10:00:00Z'),
    post(2, 'sinema', 70, '2026-09-13T10:00:00Z')
  ];
  const scored = await scoreNewsletterPosts(posts, { apiKey: '', now: new Date('2026-09-15T10:00:00Z') });
  assert.equal(scored.length, 2);
  assert.ok(scored.every((item) => Number.isFinite(item.newsletterScore)));
  assert.ok(scored.every((item) => item.newsletterScoreMode === 'deterministic'));
});

test('kategori dengesi korunur ve seçilen en yüksek newsletterScore hero olur', () => {
  const items = [
    { ...post(1, 'editorden', 60, '2026-09-14T10:00:00Z'), newsletterScore: 74 },
    { ...post(2, 'kultur-sanat', 60, '2026-09-14T09:00:00Z'), newsletterScore: 82 },
    { ...post(3, 'sinema', 60, '2026-09-14T08:00:00Z'), newsletterScore: 91 },
    { ...post(4, 'moda-tasarim', 60, '2026-09-14T07:00:00Z'), newsletterScore: 79 },
    { ...post(5, 'sehir-yasam', 60, '2026-09-14T06:00:00Z'), newsletterScore: 77 },
    { ...post(6, 'kultur-sanat', 60, '2026-09-13T06:00:00Z'), newsletterScore: 88 }
  ];
  const selected = selectNewsletterPostsByScore(items, 6);
  assert.equal(selected[0].id, 3);
  assert.ok(selected.some((item) => item.id === 1));
  assert.ok(selected.some((item) => item.id === 2));
  assert.ok(selected.some((item) => item.id === 4));
  assert.ok(selected.some((item) => item.id === 5));
});
