import test from 'node:test';
import assert from 'node:assert/strict';
import { APPROVED_EDITORIAL_EXAMPLES, EDITORIAL_STYLE_STANDARD, editorialExamplesFor } from '../src/editorial-examples.js';
import { headlineEditorialWarnings, translationIssues } from '../src/quality.js';

test('13 Ekim WordPress revizyonları beş özgün eski/yeni başlık örneği sağlar', () => {
  assert.deepEqual(APPROVED_EDITORIAL_EXAMPLES.map(item => item.postId), [1184, 1177, 1172, 1165, 1162]);
  for (const item of APPROVED_EDITORIAL_EXAMPLES) {
    assert.notEqual(item.before, item.after);
    assert.ok(item.principle.length > 30);
    assert.ok(item.after.length >= 32 && item.after.length <= 82, item.after);
    assert.ok(item.approvedSpot.length >= 100, item.after);
    assert.equal(headlineEditorialWarnings(item.after).length, 0, item.after);
  }
});

test('kategoriye göre seçilen editoryal örnekler yeni olgu gibi sunulmaz', () => {
  const film = editorialExamplesFor('sinema', 2);
  assert.equal(film.length, 2);
  assert.match(film[0].after, /10 tarihî mekân/);
  assert.deepEqual(Object.keys(film[0]).sort(), ['after', 'before', 'principle']);
  assert.equal(editorialExamplesFor('moda-tasarim', 1)[0].postId, undefined);
  assert.match(EDITORIAL_STYLE_STANDARD, /doğrulanmış/);
});

test('onaylı giriş örnekleri Çince kalıntı veya metin hakkında meta-anlatım içermez', () => {
  for (const item of APPROVED_EDITORIAL_EXAMPLES) {
    if (!item.approvedLead) continue;
    assert.ok(item.approvedLead.length >= 120);
    assert.doesNotMatch(item.approvedLead, /kaynak metne göre|kaynakta belirtil/i);
    assert.ok(item.approvedLead.includes(' '));
  }
});
