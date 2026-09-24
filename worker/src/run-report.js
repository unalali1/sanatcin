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
