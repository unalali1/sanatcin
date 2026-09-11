import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunBudget } from '../src/run-budget.js';

test('kategori başına en fazla belirlenen sayıda aday dener', () => {
  const budget = createRunBudget({ maxAttemptsPerCategory: 5, maxRunMinutes: 30, startedAt: 0 });
  for (let index = 0; index < 5; index += 1) {
    assert.equal(budget.canAttempt('kultur-sanat', 1), true);
    budget.noteAttempt('kultur-sanat');
  }
  assert.equal(budget.canAttempt('kultur-sanat', 1), false);
  assert.equal(budget.attemptsFor('kultur-sanat'), 5);
  assert.equal(budget.canAttempt('sinema', 1), true);
});

test('toplam çalışma süresi dolduğunda yeni aday başlatmaz', () => {
  const budget = createRunBudget({ maxAttemptsPerCategory: 5, maxRunMinutes: 30, startedAt: 1_000 });
  assert.equal(budget.canAttempt('sinema', 1_000 + 30 * 60 * 1000 - 1), true);
  assert.equal(budget.canAttempt('sinema', 1_000 + 30 * 60 * 1000), false);
  assert.equal(budget.isExpired(1_000 + 30 * 60 * 1000), true);
  assert.equal(budget.remainingMs(1_000 + 31 * 60 * 1000), 0);
});
