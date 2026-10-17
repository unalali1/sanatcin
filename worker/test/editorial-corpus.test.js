import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newsroomFindings } from '../src/editorial-review.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const rows = [...fixture('editorial-2026-10-17.json'), ...fixture('editorial-2026-10-14-extra.json')];
const first = rows.filter(row => row.parent > 0);
const paired = rows.filter(row => row.parent === 0);
const excerpts = new Map(fixture('editorial-excerpts-2026-10-17.json').map(row => [row.id, row.excerpt]));
export const categoryIds = {
  sinema: [1333, 1153, 1165, 1220, 1240],
  'moda-tasarim': [1341, 1358, 1159, 1172, 1243, 1232],
  'sahne-sanatlari': [1330, 1344, 1120, 1139, 1177, 1215, 1269],
  'geleneksel-kultur': [1338, 1212, 1227, 1246, 1249, 1184, 1252],
  'gorsel-sanatlar': [1347, 1123, 1130, 1134, 1162]
};

test('30 first publications cover five arts desks without mixing seven manual edits', () => {
  assert.equal(first.length, 30);
  assert.equal(new Set(first.map(row => row.parent)).size, 30);
  assert.equal(paired.length, 7);
  assert.ok(first.every(row => row.date >= '2026-10-12' && row.date < '2026-10-18'));
  const classified = Object.values(categoryIds).flat();
  assert.equal(classified.length, 30);
  assert.equal(new Set(classified).size, 30);
  assert.deepEqual([...classified].sort((a,b) => a-b), first.map(row => row.parent).sort((a,b) => a-b));
  assert.ok(Object.values(categoryIds).every(ids => ids.length >= 5 && ids.length <= 7));
  assert.ok(first.every(row => excerpts.has(row.id)));
});

test('the five 17 October examples are detectable in their actual first-publication text', () => {
  const byPost = new Map(first.map(row => [row.parent, row]));
  for (const [id, code] of [
    [1358, 'fragrance_axis'], [1341, 'runway_scent_angle'],
    [1330, 'opera_technique'], [1333, 'oscar_qualification']
  ]) {
    const row = byPost.get(id);
    assert.ok(newsroomFindings({ title: row.title, excerpt: excerpts.get(row.id), text: row.html.replace(/<[^>]*>/gu, ' ') }).some(item => item.code === code), `${id}: ${code}`);
  }
  const fashion = byPost.get(1341);
  const findings = newsroomFindings({ title: fashion.title, text: fashion.html.replace(/<[^>]*>/gu, ' ') });
  assert.ok(findings.some(item => item.code === 'runway_narrative' || item.code === 'fashion_looks'));
});
