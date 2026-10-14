import test from 'node:test';
import assert from 'node:assert/strict';
import { newsroomFindings, headlineRevisionIssues } from '../src/editorial-review.js';

test('vague foreign participant headline gets advisory only', () => {
  const findings = newsroomFindings({title: 'İki yabancı katılımcının yolculuğu belgesel oldu'});
  assert.equal(findings.find(item => item.code === 'vague_foreign_participant')?.severity, 'review');
});

test('institutional documentary wording gets advisory only', () => {
  const findings = newsroomFindings({text: 'Yedi bölümlük uluslararası iletişim belgeseli ekrana geldi.'});
  assert.equal(findings.find(item => item.code === 'institutional_documentary')?.severity, 'review');
});

test('natural headlines do not get the new warnings', () => {
  const findings = newsroomFindings({title: 'Şanghay’ın 700 yıllık fener geleneği Barselona sahnesinde'});
  assert.ok(!findings.some(item => ['vague_foreign_participant', 'institutional_documentary'].includes(item.code)));
});

test('advisory warnings do not block headline revisions', () => {
  assert.deepEqual(headlineRevisionIssues('Yolculuk belgesel oldu', 'İki yabancı katılımcının yolculuğu belgesel oldu'), []);
});
