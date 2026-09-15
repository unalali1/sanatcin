import { scoreNewsletterPosts, selectNewsletterPostsByScore } from './newsletter-score.js';

function categorySlugs(post) {
  const groups = post?._embedded?.['wp:term'] ?? [];
  return groups.flat().filter((term) => term.taxonomy === 'category').map((term) => term.slug);
}

export function applyDossierNewsletterBonus(posts, bonus = 10) {
  const amount = Math.max(0, Math.min(Number(bonus) || 0, 20));
  return posts.map((post) => {
    if (!categorySlugs(post).includes('cin-sanatlari-dosyasi')) return post;
    const current = Number(post.newsletterScore ?? 0) || 0;
    return {
      ...post,
      newsletterScore: Math.round(Math.min(100, current + amount) * 10) / 10,
      newsletterScoreBonus: amount,
      newsletterScoreBonusReason: 'Çin Sanatları Dosyası haftalık evergreen içerik bonusu'
    };
  });
}

export async function buildNewsletterSelectionWithDossierBonus(posts, maxItems = 6, options = {}) {
  const scored = await scoreNewsletterPosts(posts, options);
  const boosted = applyDossierNewsletterBonus(scored, options.dossierBonus ?? 10);
  return selectNewsletterPostsByScore(boosted, maxItems);
}
