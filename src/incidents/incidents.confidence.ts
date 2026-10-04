import type {
  HypothesisConfidence,
  HypothesisConfidenceSummary,
  IncidentResponse,
} from './incidents.types.js';

export function confidenceToScore(confidence: HypothesisConfidence): number {
  if (confidence === 'high') {
    return 0.75;
  }

  if (confidence === 'medium') {
    return 0.5;
  }

  return 0.25;
}

export function scoreToConfidence(score: number): HypothesisConfidence {
  if (score >= 0.7) {
    return 'high';
  }

  if (score >= 0.4) {
    return 'medium';
  }

  return 'low';
}

export function clampConfidenceScore(score: number): number {
  return roundConfidenceScore(Math.max(0, Math.min(1, score)));
}

export function roundConfidenceScore(score: number): number {
  return Math.round(score * 10000) / 10000;
}

export function summarizeHypothesisConfidence(
  hypotheses: IncidentResponse['hypotheses'],
): HypothesisConfidenceSummary {
  const rankedHypotheses = hypotheses
    .filter((hypothesis) => hypothesis.status !== 'rejected')
    .slice()
    .sort((left, right) => {
      const scoreDifference = right.confidenceScore - left.confidenceScore;

      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      return left.createdAt.localeCompare(right.createdAt);
    });
  const mostLikely = rankedHypotheses[0];

  return {
    mostLikelyHypothesis: mostLikely
      ? {
          confidence: mostLikely.confidence,
          confidenceScore: mostLikely.confidenceScore,
          id: mostLikely.id,
          statement: mostLikely.statement,
        }
      : null,
    remainingUncertainty: mostLikely ? roundConfidenceScore(1 - mostLikely.confidenceScore) : 1,
  };
}
