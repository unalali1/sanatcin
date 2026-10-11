import test from 'node:test';
import assert from 'node:assert/strict';
import { newsroomFindings, headlineRevisionIssues } from '../src/editorial-review.js';
import { editorialFluencyProfile } from '../src/quality.js';

test('11 October Peng’an calques produce explicit findings despite an otherwise fluent article', () => {
  const draft = { title: 'Peng’an’da halk geçitleri turistik alanlara taşındı', text: 'Programda Han tarzı flaş moblar düzenlendi.' };
  assert.deepEqual(newsroomFindings(draft).map(x => x.code), ['literal_folk_parade', 'literal_han_flashmob']);
  assert.ok(editorialFluencyProfile(draft).score < 82);
  assert.equal(editorialFluencyProfile(draft).findings.length, 2);
});

test('natural alternatives, quotes and substring collisions are not blocked', () => {
  for (const text of ['Geleneksel gösterilerin yer aldığı geçit töreni düzenlendi.', 'Han döneminden esinlenen toplu gösteriler yapıldı.', 'Gazeteci, “halk geçitleri” çevirisini eleştirdi.', 'Mahalk geçitleri']) {
    assert.deepEqual(newsroomFindings({ text }), [], text);
  }
  for (const text of ['HALK GEÇİTLERİ', 'Halk geçidinde değil halk geçitlerinde dans edildi.']) {
    assert.ok(newsroomFindings({ text }).some(x => x.code === 'literal_folk_parade'), text);
  }
});

test('official titles, foreign institution names and fashion terminology require context, not rejection', () => {
  const findings = newsroomFindings({ text: 'Beijing Music Festival, kültürel miras taşıyıcısı ile kumaş odaklı ölçülü minimalizmi tartıştı.' });
  assert.equal(findings.length, 3);
  assert.ok(findings.every(x => x.severity === 'review'));
});

test('spot repetition is advisory and punctuation insensitive', () => {
  const excerpt = 'Şanghay’da açılan sergi, geleneksel dokuma tekniklerini çağdaş sanatçıların yeni eserleri üzerinden anlatıyor.';
  assert.ok(newsroomFindings({ excerpt, paragraphs: [excerpt + ' Sergi yarın açılacak.'] }).some(x => x.code === 'spot_lead_repeat'));
  assert.deepEqual(newsroomFindings({ excerpt, paragraphs: ['Yeni sergi dokuma ustalarının çalışmalarına ayrıldı.'] }), []);
});

test('Dutoit headline cannot regress to a calendar announcement; surname and fresh news remain valid', () => {
  const before = 'Pekin Müzik Festivali’ni 90 yaşındaki Charles Dutoit açtı';
  const facts = { people: ['Charles Dutoit'] };
  assert.equal(headlineRevisionIssues(before, 'Pekin Müzik Festivali Mozart konseriyle başladı', facts).length, 1);
  assert.deepEqual(headlineRevisionIssues(before, 'Dutoit’nin yönettiği konserle Pekin Müzik Festivali başladı', facts), []);
  assert.deepEqual(headlineRevisionIssues(before, 'Pekin Müzik Festivali’nde Mozart’ın bütün keman konçertoları', facts), []);
  assert.deepEqual(headlineRevisionIssues('Pekin’de müzik buluşması', 'Pekin Müzik Festivali Mozart konseriyle başladı'), []);
});
