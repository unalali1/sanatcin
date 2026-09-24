import { config } from './config.js';
import { isNearTopicRepeat, sourceCrowdingPenalty } from './rank.js';

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
  allowPublisherOverflow = false
}) {
  let bestIndex = -1;
  let bestTier = Infinity;
  let bestEffectiveScore = -Infinity;
  let bestPenalty = 0;
  let hasFallbackCandidate = false;

  for (let index = 0; index < queue.length; index += 1) {
    const candidate = queue[index];
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
    // Exhaust usable alternative publishers before relaxing the daily cap.
    const tier = (overflow ? 10 : 0) + failureCount;
    if (enforceTopicDiversity && isNearTopicRepeat(candidate, topicPortfolio)) continue;
    hasFallbackCandidate = true;
    const previousCount = sourceUseCounts[candidate.source?.id] ?? 0;
    const sourcePenalty = sourceCrowdingPenalty(previousCount);
    const effectiveScore = Math.max(0, Math.round((candidate.score - sourcePenalty) * 10) / 10);
    const qualifies = fallbackActive ? true : effectiveScore >= preferredMinimum;
    if (!qualifies) continue;
    if (tier < bestTier || (tier === bestTier && effectiveScore > bestEffectiveScore)) {
      bestTier = tier;
      bestIndex = index;
      bestEffectiveScore = effectiveScore;
      bestPenalty = sourcePenalty;
    }
  }

  if (bestIndex < 0) return { candidate: null, hasFallbackCandidate };
  const candidate = queue.splice(bestIndex, 1)[0];
  return {
    candidate: {
      ...candidate,
      effectiveScore: bestEffectiveScore,
      sourcePenalty: bestPenalty,
      publisherGroup: candidate.source?.publisherGroup ?? candidate.source?.id ?? 'unknown'
    },
    hasFallbackCandidate
  };
}

