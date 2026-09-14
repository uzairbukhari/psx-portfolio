export const RESEARCH_BUDGET_MICROS = 500_000;
export const SCORE_LIMITS = [20, 20, 15, 10, 10, 15, 10];

export function researchReserveMicros(inputCharacters, maxOutputTokens) {
  const estimatedInputTokens = Math.ceil(inputCharacters / 4) + 6_000;
  return Math.ceil(estimatedInputTokens * 0.05 + maxOutputTokens * 0.4);
}

export function validScorecard(scores) {
  return (
    Array.isArray(scores) &&
    scores.length === SCORE_LIMITS.length &&
    scores.every(
      (score, index) =>
        score === null ||
        (Number.isFinite(score) && score >= 0 && score <= SCORE_LIMITS[index]),
    )
  );
}

export function hasPdfSignature(bytes) {
  return (
    bytes?.length >= 5 &&
    new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-'
  );
}

export function validPsxTicker(value) {
  return /^[A-Z0-9]{2,12}$/.test(value);
}
