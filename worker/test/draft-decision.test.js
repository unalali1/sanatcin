import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessDraftTransition, selectEditorialDraft } from '../src/draft-decision.js';
import { editorialFluencyProfile } from '../src/quality.js';

const snapshots = JSON.parse(readFileSync(new URL('./fixtures/editorial-2026-10-17.json', import.meta.url)));
const initial = snapshots.filter(row => row.parent > 0);
const corrected = new Map(snapshots.filter(row => row.parent === 0).map(row => [row.id, row]));
const entity = value => value.replace(/&#(\d+);/gu, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&(?:nbsp|amp|quot|lt|gt);/gu, token => ({ '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>' })[token]);
const plain = value => entity(value.replace(/<[^>]*>/gu, '')).replace(/\s+/gu, ' ').trim();
function draft(row) {
  const paragraphs = [...row.html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu)].map(match => plain(match[1]));
  return { title: row.title, excerpt: (paragraphs[1] ?? '').slice(0, 145), paragraphs, text: paragraphs.join('\n\n') };
}

test('20 different historical culture and arts texts have identifiable first revisions', () => {
  assert.equal(initial.length, 20);
  assert.equal(new Set(initial.map(row => row.parent)).size, 20);
  assert.equal(initial.filter(row => corrected.has(row.parent)).length, 7);
  for (const row of initial) {
    assert.ok(draft(row).text.length > 500, `revision ${row.id} has a body`);
    assert.ok(row.date <= '2026-10-17 05:10:00', `revision ${row.id} precedes manual correction`);
  }
});

for (const row of initial) {
  test(`historical ${row.parent}: style choice and factual safety are separate`, () => {
    const before = draft(row);
    const style = { ...before, paragraphs: [...before.paragraphs] };
    style.text = style.paragraphs.join('\n\n');
    const chosen = selectEditorialDraft(before, style, {}, { preferred: 'B', aScore: 70, bScore: 85 });
    const assessment = assessDraftTransition(before, style, {});
    const preexistingSafety = assessment.blocking.length > 0 || assessment.repairFindings.length > 0;
    assert.equal(chosen.selected, preexistingSafety ? null : 'B');

    // A visible new unverified Chinese name must block publication even if the judge likes it.
    const unsafe = { ...style, paragraphs: [...style.paragraphs, '未核实'] };
    unsafe.text = unsafe.paragraphs.join('\n\n');
    assert.equal(assessDraftTransition(before, unsafe, {}).blocking.length > 0, true);
    assert.equal(selectEditorialDraft(before, unsafe, {}, { preferred: 'B', aScore: 60, bScore: 99 }).selected, null);
  });
}

test('a clearly better Turkish version survives a purely stylistic A vote', () => {
  const before = draft(initial.find(row => row.parent === 1338));
  const after = { ...before, title: 'Çifte Dokuz Festivali’nde yükseğe çıkma geleneği ne anlatıyor?' };
  const decision = selectEditorialDraft(before, after, {}, { preferred: 'A', reason: 'A üslubunu tercih ettim', aScore: 75, bScore: 87 });
  assert.equal(decision.selected, 'B');
  assert.equal(decision.reason, 'style_override');
});

test('judge evidence of an unresolved factual conflict requires editor review', () => {
  const before = draft(initial.find(row => row.parent === 1338));
  const after = { ...before, title: `${before.title} yeniden` };
  const decision = selectEditorialDraft(before, after, {}, {
    preferred: 'A', factualConflict: { field: 'tarih', evidence: 'Olgu fişindeki tarih' }
  });
  assert.equal(decision.selected, null);
  assert.equal(decision.reason, 'judge_factual_conflict');
});

test('17 October first publication and later hand edits are distinct comparison groups', () => {
  const pairs = initial.filter(row => corrected.has(row.parent)).map(row => ({ before: draft(row), after: draft(corrected.get(row.parent)) }));
  assert.equal(pairs.length, 7);
  assert.ok(pairs.every(({before, after}) => before.text !== after.text));
  const profiles = pairs.map(({before, after}) => ({ before: editorialFluencyProfile(before).score, after: editorialFluencyProfile(after).score }));
  assert.equal(profiles.length, 7);
  // The heuristic is a diagnostic, not a factual fidelity score or a model replay.
  assert.ok(profiles.every(pair => Number.isFinite(pair.before) && Number.isFinite(pair.after)));
});
