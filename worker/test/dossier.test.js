import test from 'node:test';
import assert from 'node:assert/strict';
import { DOSSIER_TOPICS, nextUnusedTopic } from '../src/dossier-topics.js';
import { orderDossierImages, shortDossierCaption } from '../src/dossier-images.js';
import { dossierFigureHtml, injectDossierImages, isoWeekKey, isoWeekStart } from '../src/dossier-wordpress.js';
import { applyDossierNewsletterBonus } from '../src/newsletter-dossier.js';

test('Çin Sanatları Dosyası 52 benzersiz haftalık konu içerir', () => {
  assert.equal(DOSSIER_TOPICS.length, 52);
  assert.equal(new Set(DOSSIER_TOPICS.map((topic) => topic.slug)).size, 52);
  assert.equal(new Set(DOSSIER_TOPICS.map((topic) => topic.id)).size, 52);
  assert.ok(new Set(DOSSIER_TOPICS.map((topic) => topic.group)).size >= 7);
  for (const topic of DOSSIER_TOPICS) {
    assert.ok(topic.title.length >= 5);
    assert.ok(topic.zh.length >= 1);
    assert.ok(topic.pinyin.length >= 2);
    assert.ok(topic.queries.length >= 2);
    assert.ok(topic.imageQueries.length >= 2);
  }
});

test('kullanılmış konu atlanarak sıradaki dosya seçilir', () => {
  const used = new Set([DOSSIER_TOPICS[0].slug, DOSSIER_TOPICS[1].slug]);
  assert.equal(nextUnusedTopic(used).slug, DOSSIER_TOPICS[2].slug);
});

test('ISO hafta anahtarı pazartesi-pazar arasında sabit kalır', () => {
  const monday = new Date('2026-09-14T01:00:00Z');
  const sunday = new Date('2026-09-20T22:00:00Z');
  assert.equal(isoWeekKey(monday), isoWeekKey(sunday));
  assert.equal(isoWeekStart(monday).toISOString(), '2026-09-14T00:00:00.000Z');
});

test('dosya gövde görselleri ana görsel tekrarlanmadan paragraflara dağıtılır', () => {
  const html = '<p>Birinci paragraf.</p><p>İkinci paragraf.</p><p>Üçüncü paragraf.</p><p>Dördüncü paragraf.</p><p>Beşinci paragraf.</p><p>Altıncı paragraf.</p>';
  const images = [
    { mediaUrl: 'https://example.com/hero.jpg', altText: 'hero', captionLabel: 'Ana eser', sourcePage: 'https://commons.wikimedia.org/hero' },
    { mediaUrl: 'https://example.com/detail.jpg', altText: 'detay', captionLabel: 'Eser detayı', sourcePage: 'https://commons.wikimedia.org/detail' },
    { mediaUrl: 'https://example.com/process.jpg', altText: 'üretim', captionLabel: 'Üretim süreci', sourcePage: 'https://commons.wikimedia.org/process' }
  ];
  const result = injectDossierImages(html, images);
  assert.doesNotMatch(result, /hero\.jpg/);
  assert.match(result, /detail\.jpg/);
  assert.match(result, /process\.jpg/);
  assert.ok(result.indexOf('detail.jpg') > result.indexOf('İkinci paragraf'));
});

test('görsel altı yalnız kısa Türkçe ifade ve kaynak bağlantısı gösterir', () => {
  const html = dossierFigureHtml({
    mediaUrl: 'https://example.com/image.jpg',
    altText: 'Kaligrafi örneği',
    captionLabel: 'Kaligrafi tomarları',
    sourcePage: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
    title: 'Long filename.jpg',
    credit: 'Fotoğrafçı · CC BY-SA 4.0'
  });
  assert.match(html, />Kaligrafi tomarları<\/a>/);
  assert.match(html, /commons\.wikimedia\.org/);
  assert.doesNotMatch(html, /Long filename/);
  assert.doesNotMatch(html, /CC BY/);
  assert.equal(shortDossierCaption('  Wang Xianzhi örneği  '), 'Wang Xianzhi örneği');
});

test('kapak seçimi genel bağlam fotoğrafı yerine güçlü ve doğrudan görseli öne alır', () => {
  const context = {
    sourcePage: 'context', role: 'context', relevance: 80, visualQuality: 88,
    subjectCentrality: 58, heroSuitability: 45, finalScore: 79, heroScore: 55
  };
  const artwork = {
    sourcePage: 'artwork', role: 'artwork', relevance: 88, visualQuality: 80,
    subjectCentrality: 94, heroSuitability: 90, finalScore: 86, heroScore: 94
  };
  const process = {
    sourcePage: 'process', role: 'process', relevance: 84, visualQuality: 78,
    subjectCentrality: 82, heroSuitability: 72, finalScore: 82, heroScore: 78
  };
  const ordered = orderDossierImages([context, process, artwork], 3);
  assert.equal(ordered[0].sourcePage, 'artwork');
  assert.equal(ordered.length, 3);
});

function newsletterPost(id, slugs, score = 75) {
  return {
    id,
    newsletterScore: score,
    _embedded: {
      'wp:term': [slugs.map((slug, index) => ({ id: id * 10 + index, taxonomy: 'category', slug, name: slug }))]
    }
  };
}

test('newsletter bonusu yalnız Çin Sanatları Dosyası kategorisine uygulanır', () => {
  const posts = [
    newsletterPost(1, ['kultur-sanat', 'cin-sanatlari-dosyasi'], 78),
    newsletterPost(2, ['kultur-sanat'], 82)
  ];
  const boosted = applyDossierNewsletterBonus(posts, 10);
  assert.equal(boosted[0].newsletterScore, 88);
  assert.equal(boosted[0].newsletterScoreBonus, 10);
  assert.equal(boosted[1].newsletterScore, 82);
  assert.equal(boosted[1].newsletterScoreBonus, undefined);
});
