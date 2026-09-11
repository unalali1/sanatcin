export function createRunBudget({ maxAttemptsPerCategory, maxRunMinutes, startedAt = Date.now() }) {
  const attempts = new Map();
  const deadline = startedAt + maxRunMinutes * 60 * 1000;

  return {
    startedAt,
    deadline,
    remainingMs(now = Date.now()) {
      return Math.max(0, deadline - now);
    },
    isExpired(now = Date.now()) {
      return now >= deadline;
    },
    attemptsFor(category) {
      return attempts.get(category) ?? 0;
    },
    canAttempt(category, now = Date.now()) {
      return now < deadline && (attempts.get(category) ?? 0) < maxAttemptsPerCategory;
    },
    noteAttempt(category) {
      const count = (attempts.get(category) ?? 0) + 1;
      attempts.set(category, count);
      return count;
    }
  };
}
