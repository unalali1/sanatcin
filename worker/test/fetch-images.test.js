import test from 'node:test';
import assert from 'node:assert/strict';
import { imagesFromSrcset } from '../src/fetch.js';

test('srcset adaylarını en yüksek çözünürlükten başlayarak sıralar', () => {
  const urls = imagesFromSrcset(
    'https://img.example.com/small.jpg 320w, https://img.example.com/large.jpg 1600w, https://img.example.com/medium.jpg 800w'
  );
  assert.deepEqual(urls, [
    'https://img.example.com/large.jpg',
    'https://img.example.com/medium.jpg',
    'https://img.example.com/small.jpg'
  ]);
});

test('yoğunluk tanımlı srcset adaylarında yüksek yoğunluğu önce değerlendirir', () => {
  const urls = imagesFromSrcset(
    'https://img.example.com/one.jpg 1x, https://img.example.com/two.jpg 2x'
  );
  assert.deepEqual(urls, [
    'https://img.example.com/two.jpg',
    'https://img.example.com/one.jpg'
  ]);
});
