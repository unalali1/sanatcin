import test from 'node:test';
import assert from 'node:assert/strict';
import { insertAfterParagraph, secondaryCandidatePassesThreshold } from '../src/secondary-image.js';

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
