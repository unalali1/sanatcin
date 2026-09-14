import test from 'node:test';
import assert from 'node:assert/strict';
import { renderNewsletterHtml, selectNewsletterPosts } from '../src/newsletter.js';

function post(id, slug, score, date, title = `Haber ${id}`) {
  return {
    id,
    date_gmt: date,
    link: `https://sanatcin.com/haber-${id}/`,
    title: { rendered: title },
    excerpt: { rendered: `<p>${title} için kısa özet.</p>` },
    meta: { sanatcin_score: score },
    _embedded: {
      'wp:term': [[{ id: id + 100, taxonomy: 'category', slug, name: slug }]],
      'wp:featuredmedia': [{ source_url: `https://sanatcin.com/img-${id}.jpg`, media_details: { sizes: { large: { source_url: `https://sanatcin.com/img-${id}-large.jpg` } } } }]
    }
  };
}

test('newsletter editörden ve dört ana kategoriyi dengeli seçer', () => {
  const posts = [
    post(1, 'editorden', 55, '2026-09-13T10:00:00'),
    post(2, 'kultur-sanat', 80, '2026-09-13T09:00:00'),
    post(3, 'kultur-sanat', 90, '2026-09-12T09:00:00'),
    post(4, 'sinema', 70, '2026-09-13T08:00:00'),
    post(5, 'moda-tasarim', 75, '2026-09-13T07:00:00'),
    post(6, 'sehir-yasam', 65, '2026-09-13T06:00:00'),
    post(7, 'sinema', 95, '2026-09-11T08:00:00')
  ];
  const selected = selectNewsletterPosts(posts, 6);
  assert.deepEqual(selected.map((item) => item.id), [1, 3, 7, 5, 6, 2]);
});

test('newsletter HTML görsel, başlık ve link içerir', () => {
  const html = renderNewsletterHtml([post(10, 'sinema', 80, '2026-09-13T10:00:00', 'Örnek Başlık')], {
    siteUrl: 'https://sanatcin.com',
    logoUrl: 'https://sanatcin.com/logo.png'
  });
  assert.match(html, /Örnek Başlık/);
  assert.match(html, /img-10-large\.jpg/);
  assert.match(html, /haber-10/);
  assert.match(html, /SanatÇin Bülteni/);
});
