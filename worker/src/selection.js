import { config } from './config.js';
import { isNearTopicRepeat, sourceCrowdingPenalty } from './rank.js';

// Son yayın kapısı: kategori boşluğunu kapatmak, asgari editoryal niteliği düşüremez.
export function passesPublicationFit(candidate, minimumFit = config.minEditorialFit) {
  const editorialFit = Number(candidate?.editorialFit);
  const categoryFit = Number(candidate?.categoryFit);
  return Number.isFinite(editorialFit)
    && editorialFit >= minimumFit
    && (candidate?.categoryFit == null || (Number.isFinite(categoryFit) && categoryFit >= 7))
    && candidate?.institutionalEvent !== true
    && candidate?.commercialDominant !== true;
}

export function candidateForRound(queue, sourceUseCounts, {
  publisherUseCounts = {},
  sourceFailures = {},
  fallbackActive,
  hardMinimum,
  preferredMinimum,
  excludedSourceIds = new Set(),
  topicPortfolio = [],
  enforceTopicDiversity = false,
  rescueBelowScore = null,
  rescueMinimumFit = 7,
  allowPublisherOverflow = false,
  allowTopicOverflow = false
}) {
  let bestIndex = -1;
  let bestTier = Infinity;
  let bestEffectiveScore = -Infinity;
  let bestPenalty = 0;
  let bestTopicPenalty = 0;
  let hasFallbackCandidate = false;

  for (let index = 0; index < queue.length; index += 1) {
    const candidate = queue[index];
    if (!passesPublicationFit(candidate)) continue;
    if (candidate.minimumTargetRescue && !fallbackActive) continue;
    if (candidate.score < hardMinimum) continue;
    if (rescueBelowScore != null && candidate.score < rescueBelowScore) {
      if ((candidate.source?.quality ?? 0) < 8 || (candidate.editorialFit ?? 0) < rescueMinimumFit) continue;
    }
    if (excludedSourceIds.has(candidate.source?.id)) continue;
    const publisherGroup = candidate.source?.publisherGroup ?? candidate.source?.id ?? 'unknown';
    const publisherCount = publisherUseCounts[publisherGroup] ?? 0;
    const overflow = publisherCount >= config.maxPublisherGroupDaily;
    if (!allowPublisherOverflow && overflow) continue;
    const failureCount = sourceFailures[candidate.source?.id] ?? 0;
    // Two failed bodies from one feed cannot consume every category attempt.
    if (failureCount >= 2) continue;
    const topicRepeat = topicPortfolio.length > 0 && isNearTopicRepeat(candidate, topicPortfolio);
    if (enforceTopicDiversity && topicRepeat && !allowTopicOverflow) continue;
    // Exhaust different topics and usable alternative publishers before relaxing
    // either constraint. Topic overflow is a minimum-target rescue, never a preference.
    const tier = (overflow ? 10 : 0) + (topicRepeat ? 6 : 0) + failureCount;
    hasFallbackCandidate = true;
    const previousCount = sourceUseCounts[candidate.source?.id] ?? 0;
    const sourcePenalty = sourceCrowdingPenalty(previousCount);
    const topicPenalty = topicRepeat ? 8 : 0;
    const effectiveScore = Math.max(0, Math.round((candidate.score - sourcePenalty - topicPenalty) * 10) / 10);
    const qualifies = fallbackActive ? true : effectiveScore >= preferredMinimum;
    if (!qualifies) continue;
    if (tier < bestTier || (tier === bestTier && effectiveScore > bestEffectiveScore)) {
      bestTier = tier;
      bestIndex = index;
      bestEffectiveScore = effectiveScore;
      bestPenalty = sourcePenalty;
      bestTopicPenalty = topicPenalty;
    }
  }

  if (bestIndex < 0) return { candidate: null, hasFallbackCandidate };
  const candidate = queue.splice(bestIndex, 1)[0];
  return {
    candidate: {
      ...candidate,
      effectiveScore: bestEffectiveScore,
      sourcePenalty: bestPenalty,
      topicPenalty: bestTopicPenalty,
      publisherGroup: candidate.source?.publisherGroup ?? candidate.source?.id ?? 'unknown'
    },
    hasFallbackCandidate
  };
}

