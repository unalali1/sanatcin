// Newsletter selection and scheduled-send safety tests.
// Railway build gate must pass this file before autosend is enabled.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isNewsletterSendWindow,
  newsletterCampaignDate,
  renderNewsletterHtml,
  selectNewsletterPosts,
  isNewsletterReadyDossierDraft
} from '../src/newsletter.js';

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

test('newsletter aynı konuya ait benzer başlıkları ikinci kez seçmez', () => {
  const posts = [
    post(20, 'editorden', 0, '2026-09-13T10:00:00', 'Çin mikro dizileri Türkiye’de neden ilgi görüyor?'),
    post(21, 'kultur-sanat', 82, '2026-09-13T09:00:00', 'Dunhuang mirası yeni sergide izleyiciyle buluştu'),
    post(22, 'sinema', 90, '2026-09-13T08:00:00', 'The Pigeon Ring Venedik’te büyük ödülü aldı'),
    post(23, 'moda-tasarim', 78, '2026-09-13T07:00:00', 'Çin Moda Haftası genç tasarımcılara sahne açtı'),
    post(24, 'sehir-yasam', 74, '2026-09-13T06:00:00', 'Sarı Nehir boyunca yeni kültür rotası öne çıktı'),
    post(25, 'sinema', 88, '2026-09-12T08:00:00', 'The Pigeon Ring Venedik’te VR yarışmasına seçildi'),
    post(26, 'sinema', 76, '2026-09-11T08:00:00', 'Yeni Çin filmi Toronto’da ilk gösterimini yaptı')
  ];
  const selected = selectNewsletterPosts(posts, 6);
  assert.equal(selected.some((item) => item.id === 25), false);
  assert.equal(selected.some((item) => item.id === 26), true);
  assert.equal(selected.length, 6);
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

test('newsletter kampanya tarihi UTC takvim tarihini kullanır', () => {
  assert.equal(newsletterCampaignDate(new Date('2026-09-20T06:00:00Z')), '2026-09-20');
});

test('otomatik gönderim yalnız pazar 06:00-06:19 UTC penceresinde açıktır', () => {
  assert.equal(isNewsletterSendWindow(new Date('2026-09-20T06:00:00Z')), true);
  assert.equal(isNewsletterSendWindow(new Date('2026-09-20T06:19:59Z')), true);
  assert.equal(isNewsletterSendWindow(new Date('2026-09-20T06:20:00Z')), false);
  assert.equal(isNewsletterSendWindow(new Date('2026-09-19T06:00:00Z')), false);
  assert.equal(isNewsletterSendWindow(new Date('2026-09-20T05:59:59Z')), false);
});


test('newsletter yalnız tamamlanmış ve güncel Çin Sanatları Dosyası taslağını otomatik yayına uygun sayar', () => {
  const content = '<p>' + Array.from({ length: 700 }, (_, index) => 'kaligrafi' + index).join(' ') + '</p>';
  const ready = {
    id: 90,
    status: 'draft',
    slug: 'cin-sanatlari-dosyasi-cin-kaligrafisi',
    date_gmt: '2026-09-18T01:00:00Z',
    title: { raw: 'Çin kaligrafisi: Bir fırça darbesinin binlerce yıllık hikâyesi' },
    excerpt: { raw: 'Çin kaligrafisinin tarihini, tekniklerini ve estetik ilkelerini kaynaklarla ele alan haftalık dosya.' },
    content: { raw: content },
    featured_media: 321,
    categories: [12, 44]
  };
  assert.equal(isNewsletterReadyDossierDraft(ready, {
    dossierCategoryId: 44,
    now: new Date('2026-09-20T06:00:00Z'),
    minWords: 650
  }), true);

  assert.equal(isNewsletterReadyDossierDraft({ ...ready, featured_media: 0 }, {
    dossierCategoryId: 44,
    now: new Date('2026-09-20T06:00:00Z')
  }), false);
});
