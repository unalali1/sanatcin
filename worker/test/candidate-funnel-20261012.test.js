import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryFunnel } from '../src/run-report.js';
import { inferCategory, isDeathNewsCandidate, scoreCandidate } from '../src/score.js';
import { discoverFullSizeEditorialImages } from '../src/fetch.js';
import { passesPublicationFit } from '../src/selection.js';

const source = (defaultCategory = 'kultur-sanat') => ({ id: 'culture-feed', defaultCategory, quality: 9 });

test('discovery diagnostics separate raw duplicates and date exclusions', () => {
  const funnel = discoveryFunnel({
    discovered: 243, unique: 75, fresh: 71, known: 12, cachedFailed: 0,
    aiCandidates: 59, queued: 9, published: 2
  });
  assert.equal(funnel.duplicateEntries, 168);
  assert.equal(funnel.staleEntries, 4);
  assert.equal(funnel.knownOrFailedSkipped, 12);
  assert.equal(funnel.selectionDeferred, 50);
  assert.equal(funnel.queuedButUnpublished, 7);
});

test('funnel sanitizes counters without creating negative stage drops', () => {
  const funnel = discoveryFunnel({ discovered: -5, unique: 4, fresh: 8, aiCandidates: '3', queued: 9 });
  assert.equal(funnel.counts.discovered, 0);
  assert.equal(funnel.duplicateEntries, 0);
  assert.equal(funnel.staleEntries, 0);
  assert.equal(funnel.selectionDeferred, 0);
});

test('explicit film festival can escape a general culture source default', () => {
  assert.equal(inferCategory({
    title: 'New documentary film festival to open in Beijing',
    summary: 'Filmmakers present screenings and documentaries.',
    source: source()
  }), 'sinema');
});

test('Chinese-language film premiere headline gets a cinema preliminary category', () => {
  assert.equal(inferCategory({
    title: '上海电影首映吸引年轻观众', summary: '新的影片活动', source: source()
  }), 'sinema');
});

test('film photography is not confused with a movie premiere', () => {
  assert.equal(inferCategory({
    title: 'Film photography exhibition opens in Beijing',
    summary: 'An exhibition about analog cameras and negatives.',
    source: source()
  }), 'kultur-sanat');
});

test('specialist fashion category remains authoritative even with cinema terms', () => {
  assert.equal(inferCategory({
    title: 'Movie premiere outfits shape Shanghai fashion week',
    summary: 'Fashion design and new outfits', source: source('moda-tasarim')
  }), 'moda-tasarim');
});

test('excluded death story remains ineligible after pre-categorization', () => {
  const story = { title: 'Film director dies at 72', summary: 'A documentary filmmaker died', source: source() };
  assert.equal(isDeathNewsCandidate(story), true);
  assert.equal(scoreCandidate(story).eligible, false);
});

test('recover linked original editorial images without arbitrary navigation links', () => {
  const html = '<main><figure><a href="/media/photo-large.jpg"><img src="/media/thumb.jpg" data-full-src="/media/photo-large.jpg"></a><figcaption>Photo: China Daily</figcaption></figure><a href="/contact">Contact</a></main>';
  assert.deepEqual(discoverFullSizeEditorialImages(html, 'https://example.org/story'), [
    'https://example.org/media/photo-large.jpg'
  ]);
});

test('recover multiple different lazy-loaded image variants in editorial figures', () => {
  const html = '<article><figure><img data-zoom-image="//img.example.org/a.webp"></figure><figure><img data-echo="/b.jpg"></figure><figure><img data-srcset="/small.jpg 400w, /large.jpg 1600w"></figure></article>';
  assert.deepEqual(discoverFullSizeEditorialImages(html, 'https://example.org/story'), [
    'https://img.example.org/a.webp',
    'https://example.org/b.jpg',
    'https://example.org/large.jpg',
    'https://example.org/small.jpg'
  ]);
});

test('source image rescue never includes logo, svg or non-http URLs', () => {
  const html = '<main><figure><img data-full-src="javascript:alert(1)" data-large="/images/logo.svg"><a href="/images/logo.png"><img src="/thumb.png"></a></figure></main>';
  assert.deepEqual(discoverFullSizeEditorialImages(html, 'https://example.org/story'), []);
});

test('image rescue does not bypass the seven-point editorial quality floor', () => {
  assert.equal(passesPublicationFit({ editorialFit: 6, categoryFit: 9 }), false);
  assert.equal(passesPublicationFit({ editorialFit: 8, categoryFit: 6 }), false);
  assert.equal(passesPublicationFit({ editorialFit: 7, categoryFit: 7 }), true);
});
