export function editorialCoverage(categoryPublished = {}, results = []) {
  const categories = ['kultur-sanat', 'sinema', 'moda-tasarim', 'sehir-yasam'];
  const missingCategories = categories.filter((slug) => !(categoryPublished[slug] > 0));
  const heroEligibleCount = results.filter((item) => item.heroEligible === true).length;
  return {
    missingCategories,
    categoryCoveragePercent: Math.round((categories.length - missingCategories.length) / categories.length * 100),
    heroEligibleCount,
    heroCoverageWarning: results.length > 0 && heroEligibleCount === 0
  };
}


/**
 * Observable discovery funnel. Keep AI rescue evaluations separate from the
 * candidate counts because the same article may be evaluated more than once.
 * Counts describe stages only; they do not imply that every rejection was bad.
 */
export function discoveryFunnel({ discovered = 0, unique = 0, fresh = 0, known = 0, cachedFailed = 0, aiCandidates = 0, queued = null, published = null } = {}) {
  const positive = (value) => Math.max(0, Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0);
  const values = { discovered, unique, fresh, known, cachedFailed, aiCandidates, queued, published };
  const counts = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value == null ? null : positive(value)]));
  return {
    counts,
    knownOrFailedSkipped: counts.known + counts.cachedFailed,
    duplicateEntries: Math.max(0, counts.discovered - counts.unique),
    staleEntries: Math.max(0, counts.unique - counts.fresh),
    selectionDeferred: counts.queued == null ? null : Math.max(0, counts.aiCandidates - counts.queued),
    queuedButUnpublished: counts.queued == null || counts.published == null ? null : Math.max(0, counts.queued - counts.published),
    note: 'AI yeniden değerlendirmeleri ve kaynak/başlık bazlı elenmeler ayrı olay sayılır; bu sayaçlar editoryal kalite puanı değildir.'
  };
}
