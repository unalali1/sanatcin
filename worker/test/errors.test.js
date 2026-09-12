import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyError } from '../src/errors.js';

test('hataları sabit kod ve rapor grubuna ayırır', () => {
  assert.deepEqual(classifyError(new Error('Makale gövdesi güvenilir biçimde çıkarılamadı.')), {
    code: 'SOURCE_EXTRACTION',
    group: 'source',
    message: 'Makale gövdesi güvenilir biçimde çıkarılamadı.'
  });
  assert.equal(classifyError(new Error('beklenmedik')).code, 'UNCLASSIFIED');
});
