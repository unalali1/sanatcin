import test from 'node:test';
import assert from 'node:assert/strict';
import { insertAfterParagraph, insertFiguresAfterParagraphs, secondaryCandidatePassesThreshold } from '../src/secondary-image.js';
import { inlineImageFindings, uniqueEditorialImages } from '../src/image-quality.js';

test('ikinci görsel ikinci paragraftan sonra yerleştirilir', () => {
  const html = '<p>Birinci paragraf.</p>\n<p>İkinci paragraf.</p>\n<p>Üçüncü paragraf.</p>';
  const figure = '<figure class="sanatcin-secondary-image">İkinci görsel</figure>';
  const result = insertAfterParagraph(html, figure, 2);
  assert.equal(
    result,
    '<p>Birinci paragraf.</p>\n<p>İkinci paragraf.</p>\n<figure class="sanatcin-secondary-image">İkinci görsel</figure>\n\n<p>Üçüncü paragraf.</p>'
  );
});

test('paragraf sayısı beklenenden azsa ikinci görsel gövdenin sonuna eklenir', () => {
  const html = '<p>Tek paragraf.</p>';
  const figure = '<figure>Görsel</figure>';
  assert.equal(insertAfterParagraph(html, figure, 2), '<p>Tek paragraf.</p>\n<figure>Görsel</figure>');
});

test('birden fazla kaynak görsel gövde boyunca dağıtılır', () => {
  const html = '<p>Bir.</p><p>İki.</p><p>Üç.</p><p>Dört.</p><p>Beş.</p>';
  const result = insertFiguresAfterParagraphs(html, [
    '<figure id="a">A</figure>',
    '<figure id="b">B</figure>'
  ], 2);

  assert.match(result, /<p>İki\.<\/p>\n<figure id="a">A<\/figure>/);
  assert.match(result, /<p>Dört\.<\/p>\n<figure id="b">B<\/figure>/);
});

test('ikinci görsel kalite ve ilişki eşiklerini birlikte geçmelidir', () => {
  const strong = {
    dimensions: { width: 1200, height: 800 },
    relevanceScore: 82,
    qualityScore: 76
  };
  const weakQuality = { ...strong, qualityScore: 60 };
  const weakRelevance = { ...strong, relevanceScore: 65 };
  const tooSmall = { ...strong, dimensions: { width: 800, height: 600 } };

  assert.equal(secondaryCandidatePassesThreshold(strong), true);
  assert.equal(secondaryCandidatePassesThreshold(weakQuality), false);
  assert.equal(secondaryCandidatePassesThreshold(weakRelevance), false);
  assert.equal(secondaryCandidatePassesThreshold(tooSmall), false);
});

test('one portrait with different filenames is excluded by bytes while distinct performance photos survive', () => {
  const primary = { imageHash: 'portrait', sourceUrl: 'https://example.org/artist-1200x800.jpg' };
  const candidates = [
    { imageHash: 'portrait', sourceUrl: 'https://cdn.example.org/copy-of-artist.jpg' },
    { imageHash: 'resize', sourceUrl: 'https://example.org/artist-640x420.jpg' },
    { imageHash: 'stage-one', sourceUrl: 'https://example.org/stage-one.jpg' },
    { imageHash: 'stage-two', sourceUrl: 'https://example.org/stage-two.jpg' }
  ];
  const result = uniqueEditorialImages(primary, candidates);
  assert.equal(result.duplicates.length, 2);
  assert.deepEqual(result.images.map(item => item.imageHash), ['stage-one', 'stage-two']);
});

test('inline figures cannot repeat a source photo or appear after the source line', () => {
  const html = '<p>Haber.</p><figure><img src="https://example.org/artist-1000x600.jpg"></figure>'
    + '<figure><img src="https://example.org/artist-400x240.jpg"></figure>'
    + '<aside class="sanatcin-source">Kaynak</aside><figure><img src="https://example.org/stage.jpg"></figure>';
  assert.deepEqual(inlineImageFindings(html).map(item => item.code), ['duplicate_inline_image', 'figure_after_source']);
  const withFigure = insertAfterParagraph('<p>Haber.</p><aside class="sanatcin-source">Kaynak</aside>', '<figure>Yeni</figure>', 2);
  assert.ok(withFigure.indexOf('<figure>') < withFigure.indexOf('<aside'));
});
