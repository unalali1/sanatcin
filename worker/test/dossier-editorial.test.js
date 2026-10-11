import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { narrativeQualityHints, splitSources } from '../src/dossier-polish.js';

test('haftalık dosya editörlüğü haber dilini, tarihsel bağları ve güncel durumu gözetir', () => {
  const hints = narrativeQualityHints().join(' ');
  assert.match(hints, /haber dili/i);
  assert.match(hints, /tarihsel gelişim/i);
  assert.match(hints, /ayırt edici/i);
  assert.match(hints, /günümüzdeki durum/i);
  assert.match(hints, /neden-sonuç/i);
  assert.match(hints, /hayalî sahne/i);
  assert.match(hints, /Doğrulanmış olgu/i);
});

test('araştırma ve ilk taslak da aynı üçlü bağlamı ister, günlük haber promptuna dokunulmaz', () => {
  const research = readFileSync(new URL('../src/dossier-research.js', import.meta.url), 'utf8');
  assert.match(research, /tarihsel gelişim/i);
  assert.match(research, /ayırt edici teknik\/estetik/i);
  assert.match(research, /günümüzdeki durum/i);
  assert.match(research, /5-7 anlamlı H2/);
});

test('kaynak listesi stil tanımlı h2 ile gelse de metinden ayrılır ve aynen korunur', () => {
  const html = '<p>Haber gövdesi.</p><h2 style="font-size:1.05rem">Kaynaklar ve ileri okuma</h2><ul class="sanatcin-dossier-sources"><li><a href="https://museum.example/a">Müze</a></li></ul>';
  const result = splitSources(html);
  assert.equal(result.body, '<p>Haber gövdesi.</p>');
  assert.equal(result.body + result.sources, html);
  assert.match(result.sources, /https:\/\/museum.example\/a/);
  assert.doesNotMatch(result.body, /museum.example/);
});

test('sade kaynak başlığı da korunur; kaynak bölümü yoksa gövde değişmez', () => {
  const plain = '<p>Gövde.</p><h2>Kaynaklar ve ileri okuma</h2><ul><li>Kaynak</li></ul>';
  assert.equal(splitSources(plain).body, '<p>Gövde.</p>');
  assert.equal(splitSources(plain).body + splitSources(plain).sources, plain);
  assert.deepEqual(splitSources('<p>Gövde.</p>'), { body: '<p>Gövde.</p>', sources: '' });
});
