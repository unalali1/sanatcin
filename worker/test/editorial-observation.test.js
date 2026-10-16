import test from 'node:test';
import assert from 'node:assert/strict';
import { WEIGHTS, summarizeAssessment, observeEditorialQuality } from '../dev/editorial-observation.mjs';
const assessment = score => Object.fromEntries(Object.keys(WEIGHTS).map(key => [key, { score, reason: 'Somut değerlendirme notu' }]));
test('advisory score uses requested 30/25/25/10/10 weights', () => {
  const values = assessment(80); values.fidelity.score = 40;
  assert.equal(summarizeAssessment(values).total, 70);
  assert.equal(summarizeAssessment(values).advisoryOnly, true);
  assert.equal(summarizeAssessment(values).sourceVerified, false);
});
test('missing fidelity and nonnumeric scores never become a perfect score', () => {
  const values = assessment(100); delete values.fidelity;
  assert.equal(summarizeAssessment(values).total, null);
  for (const score of [null, '90', NaN, Infinity, -1, 101]) assert.equal(summarizeAssessment(assessment(score)).total, null);
});
test('all score bands use documented boundaries', () => {
  assert.deepEqual([69,70,79,80,89,90,100].map(score => summarizeAssessment(assessment(score)).label), ['Editoryal revizyon gerekli','Redaksiyon önerilir','Redaksiyon önerilir','Yayımlanabilir','Yayımlanabilir','Çok iyi','Çok iyi']);
});
test('no source means no invented fidelity and zero API calls', async () => {
  let calls = 0;
  const result = await observeEditorialQuality({ draft: {} }, { completeJson: () => { calls++; } });
  assert.equal(calls, 0); assert.equal(result.total, null);
});
test('assessment error preserves original content and never rejects the caller', async () => {
  const draft = Object.freeze({title:'Başlık',excerpt:'Spot',paragraphs:Object.freeze(['Gövde']),category:'sinema'});
  const result = await observeEditorialQuality({sourceText:'Source',draft}, { completeJson:async()=>{throw new Error('secret transport error');} });
  assert.equal(result.total, null); assert.equal(draft.category, 'sinema');
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});
test('timeout returns unavailable even when injected transport ignores abort', async () => {
  const result = await observeEditorialQuality({sourceText:'Source',draft:{}}, { timeoutMs:5, completeJson:()=>new Promise(()=>{}) });
  assert.equal(result.status, 'unavailable');
});
test('only title spot and body are passed, never operational or social data', async () => {
  const draft = { title:'Başlık',excerpt:'Spot',paragraphs:['Metin'],instagramText:'social',meta:{password:'secret'},category:'sinema' };
  const before = JSON.stringify(draft);
  const result = await observeEditorialQuality({sourceText:'Kaynak',draft}, { completeJson:async request=>{
    const input=JSON.parse(request.input[1].content);
    assert.deepEqual(Object.keys(input.draft), ['title','excerpt','paragraphs']);
    assert.equal(input.sourceText,'Kaynak');
    return { assessment:assessment(85) };
  } });
  assert.equal(result.total,85); assert.equal(JSON.stringify(draft),before);
});
