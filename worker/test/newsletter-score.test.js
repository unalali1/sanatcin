import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateNewsletterScore,
  newsletterVisualStrength,
  scoreNewsletterPosts,
  selectNewsletterPostsByScore,
  newsletterTopicSimilarity,
  buildNewsletterSubject,
  validateNewsletterSelection
} from '../src/newsletter-score.js';

function post(id, slug, score, date, title = `Haber ${id}`, width = 1200, height = 800, sourceName = `Kaynak ${id}`) {
  return {
    id,
    date_gmt: date,
    link: `https://sanatcin.com/haber-${id}/`,
    title: { rendered: title },
    excerpt: { rendered: `<p>${title} için kısa özet.</p>` },
    meta: { sanatcin_score: score, sanatcin_source_name: sourceName, sanatcin_source_url: `https://example.com/source-${id}` },
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

test('kategori dengesi tercihtir; kalite eşiğinin altındaki kategori haberi zorla seçilmez', () => {
  const items = [
    { ...post(1, 'editorden', 74, '2026-09-14T10:00:00Z', 'Editörden haftanın kültür notları'), newsletterScore: 74 },
    { ...post(2, 'kultur-sanat', 82, '2026-09-14T09:00:00Z', 'Dunhuang mağaralarında yeni sergi açıldı'), newsletterScore: 82 },
    { ...post(3, 'sinema', 60, '2026-09-14T08:00:00Z', 'Çin filmi Toronto festivalinde gösterildi'), newsletterScore: 91 },
    { ...post(4, 'moda-tasarim', 60, '2026-09-14T07:00:00Z', 'Yerel moda etkinliği küçük bir sergi açtı'), newsletterScore: 66 },
    { ...post(5, 'sehir-yasam', 60, '2026-09-14T06:00:00Z', 'Pekin hutonglarında gece yürüyüşleri artıyor'), newsletterScore: 77 },
    { ...post(6, 'kultur-sanat', 60, '2026-09-13T06:00:00Z', 'Bronz Çağı kazılarında yeni bulgular ortaya çıktı'), newsletterScore: 88 },
    { ...post(7, 'sinema', 60, '2026-09-13T05:00:00Z', 'Yeni animasyon filmi gişede öne çıktı'), newsletterScore: 86 },
    { ...post(8, 'sehir-yasam', 60, '2026-09-13T04:00:00Z', 'Şanghay kıyısında yeni kültür rotası açıldı'), newsletterScore: 84 },
    { ...post(9, 'kultur-sanat', 60, '2026-09-13T03:00:00Z', 'Seladon ustalarının yeni kuşağı atölyelerde yetişiyor'), newsletterScore: 83 }
  ];
  const selected = selectNewsletterPostsByScore(items, 8, { minScore: 68, maxPerSource: 2, categoryDiversityBonus: 5 });
  assert.equal(selected.some((item) => item.id === 4), false);
  assert.equal(selected.some((item) => item.id === 6), true);
  assert.equal(selected.length, 8);
});

test('aynı kaynaktan en fazla iki haber seçilir', () => {
  const items = [
    { ...post(1, 'kultur-sanat', 80, '2026-09-14T10:00:00Z', 'Arkeoloji parkında yeni keşif', 1200, 800, 'China Daily – Culture'), newsletterScore: 95 },
    { ...post(2, 'sinema', 80, '2026-09-14T09:00:00Z', 'Bağımsız film festivali başladı', 1200, 800, 'China Daily – Culture'), newsletterScore: 94 },
    { ...post(3, 'moda-tasarim', 80, '2026-09-14T08:00:00Z', 'Genç tasarımcıların yeni koleksiyonu', 1200, 800, 'China Daily – Culture'), newsletterScore: 93 },
    { ...post(4, 'sehir-yasam', 80, '2026-09-14T07:00:00Z', 'Kent parklarında yeni kamusal sanat', 1200, 800, 'Xinhua – Culture'), newsletterScore: 92 },
    { ...post(5, 'kultur-sanat', 80, '2026-09-14T06:00:00Z', 'Müze koleksiyonuna bronz eser eklendi', 1200, 800, 'CGTN – Culture'), newsletterScore: 91 },
    { ...post(6, 'sinema', 80, '2026-09-14T05:00:00Z', 'Belgesel yönetmeni yeni projesini anlattı', 1200, 800, 'Sixth Tone'), newsletterScore: 90 },
    { ...post(7, 'moda-tasarim', 80, '2026-09-14T04:00:00Z', 'Pekin moda haftasında zanaat vurgusu', 1200, 800, 'Jing Daily – Fashion'), newsletterScore: 89 },
    { ...post(8, 'sehir-yasam', 80, '2026-09-14T03:00:00Z', 'Gece pazarları kültür etkinlikleriyle canlandı', 1200, 800, 'Chinaculture.org'), newsletterScore: 88 },
    { ...post(9, 'kultur-sanat', 80, '2026-09-14T02:00:00Z', 'Kaligrafi sergisi yeni eserlerle açıldı', 1200, 800, 'ArtAsiaPacific'), newsletterScore: 87 }
  ];
  const selected = selectNewsletterPostsByScore(items, 8, { minScore: 68, maxPerSource: 2, categoryDiversityBonus: 0 });
  assert.equal(selected.filter((item) => item.meta.sanatcin_source_name.startsWith('China Daily')).length, 2);
  assert.equal(selected.length, 8);
});

test('semantik olarak aynı konu farklı başlıklarla tekrar seçilmez', () => {
  const a = post(20, 'kultur-sanat', 80, '2026-09-14T10:00:00Z', 'Dunhuang’da dijital miras sergisi açıldı');
  const b = post(21, 'kultur-sanat', 80, '2026-09-14T09:00:00Z', 'Mogao mağaraları teknolojiyle yeniden ziyaretçi karşısında');
  a.excerpt.rendered = '<p>Dunhuang Mogao mağaralarının dijital miras sergisi yeni teknoloji ve sanat eserlerini ziyaretçilerle buluşturuyor.</p>';
  b.excerpt.rendered = '<p>Dunhuang Mogao mağaraları dijital teknoloji kullanılarak miras sergisi kapsamında sanat eserleriyle ziyaretçilere sunuluyor.</p>';
  const similarity = newsletterTopicSimilarity(a, b);
  assert.ok(similarity.semanticScore >= 0.5);
  assert.ok(similarity.semanticShared >= 4);
});

test('hero seçimi toplam puanın yanında görsel gücü ve okur ilgisini de dikkate alır', () => {
  const a = { ...post(30, 'kultur-sanat', 80, '2026-09-14T10:00:00Z', 'Arkeoloji haberi', 600, 400, 'Kaynak A'), newsletterScore: 90, newsletterScoreComponents: { visualStrength: 63, readerInterest: 70 } };
  const b = { ...post(31, 'sinema', 80, '2026-09-14T09:00:00Z', 'Güçlü görselli festival haberi', 1800, 1200, 'Kaynak B'), newsletterScore: 87, newsletterScoreComponents: { visualStrength: 98, readerInterest: 95 } };
  const c = { ...post(32, 'sehir-yasam', 80, '2026-09-14T08:00:00Z', 'Şehir kültürü haberi', 1200, 800, 'Kaynak C'), newsletterScore: 82, newsletterScoreComponents: { visualStrength: 90, readerInterest: 80 } };
  const d = { ...post(33, 'moda-tasarim', 80, '2026-09-14T07:00:00Z', 'Tasarım haberi', 1200, 800, 'Kaynak D'), newsletterScore: 80, newsletterScoreComponents: { visualStrength: 90, readerInterest: 78 } };
  const selected = selectNewsletterPostsByScore([a, b, c, d], 4, { minScore: 68, maxPerSource: 2, categoryDiversityBonus: 0 });
  assert.equal(selected[0].id, 31);
});

test('dinamik konu satırı kısa kalır ve seçkinin ana hikâyesini taşır', () => {
  const items = [
    post(40, 'kultur-sanat', 80, '2026-09-14T10:00:00Z', 'Çin’in üç bin yıllık bakır madeni arkeolojik park oldu'),
    post(41, 'sinema', 80, '2026-09-14T09:00:00Z', 'Yeni Çin filmi Toronto’da ilk gösterimini yaptı')
  ];
  const subject = buildNewsletterSubject(items);
  assert.ok(subject.startsWith('SanatÇin | '));
  assert.ok(subject.length <= 72);
});

test('final kalite kapısı eksik görseli ve düşük puanı gönderimden önce durdurur', () => {
  const items = [
    { ...post(50, 'kultur-sanat', 80, '2026-09-14T10:00:00Z', 'Müze haberi'), newsletterScore: 85 },
    { ...post(51, 'sinema', 80, '2026-09-14T09:00:00Z', 'Sinema haberi'), newsletterScore: 84 },
    { ...post(52, 'moda-tasarim', 80, '2026-09-14T08:00:00Z', 'Moda haberi'), newsletterScore: 83 },
    { ...post(53, 'sehir-yasam', 80, '2026-09-14T07:00:00Z', 'Şehir haberi'), newsletterScore: 67 }
  ];
  items[1]._embedded['wp:featuredmedia'] = [];
  const validation = validateNewsletterSelection(items, { minItems: 4, maxItems: 8, minScore: 68, maxPerSource: 2 });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.includes('Öne çıkan görseli olmayan')));
  assert.ok(validation.errors.some((error) => error.includes('Kalite eşiğinin altında')));
});
