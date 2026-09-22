export type ScenarioName = 'Bear' | 'Base' | 'Bull';
export type Scenario = { name: string; eps: number | null; multiple: number | null };
export type ScenarioValue = { name: string; value: number | null; reason: string | null };
export type ValuationSummary = {
  low: number | null;
  base: number | null;
  high: number | null;
  provenance: 'scenario-model' | 'legacy' | 'unavailable';
  scenarios: ScenarioValue[];
};

const round = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const positive = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0;

export function scenarioValue(s: Scenario): ScenarioValue {
  const validEps = positive(s.eps);
  const validMultiple = positive(s.multiple);
  if (!validEps || !validMultiple) {
    const reason = !validEps && !validMultiple
      ? 'EPS and multiple are both missing or not positive numbers.'
      : !validEps
        ? 'EPS is missing or not a positive number.'
        : 'multiple is missing or not a positive number.';
    return { name: s.name, value: null, reason };
  }
  return { name: s.name, value: round(s.eps! * s.multiple!), reason: null };
}

export function scenarioValues(scenarios: Scenario[]): ScenarioValue[] {
  return scenarios.map(scenarioValue);
}

export function findScenario(values: ScenarioValue[], name: ScenarioName): ScenarioValue | undefined {
  const target = name.toLowerCase();
  return values.find((v) => String(v.name).trim().toLowerCase() === target);
}

export function resolveValuation(input: {
  scenarios?: Scenario[] | null;
  legacyLow?: number | null;
  legacyBase?: number | null;
  legacyHigh?: number | null;
}): ValuationSummary {
  const values = scenarioValues(input.scenarios ?? []);
  const hasAnyScenarioValue = values.some((v) => v.value !== null);
  if (hasAnyScenarioValue) {
    return {
      low: findScenario(values, 'Bear')?.value ?? null,
      base: findScenario(values, 'Base')?.value ?? null,
      high: findScenario(values, 'Bull')?.value ?? null,
      provenance: 'scenario-model',
      scenarios: values,
    };
  }
  const legacyLow = input.legacyLow ?? null;
  const legacyBase = input.legacyBase ?? null;
  const legacyHigh = input.legacyHigh ?? null;
  const hasLegacy = legacyLow !== null || legacyBase !== null || legacyHigh !== null;
  return {
    low: legacyLow,
    base: legacyBase,
    high: legacyHigh,
    provenance: hasLegacy ? 'legacy' : 'unavailable',
    scenarios: values,
  };
}

export function upsideDownsidePct(value: number | null, price: number | null): number | null {
  if (value === null || price === null || !Number.isFinite(price) || price <= 0 || !Number.isFinite(value)) return null;
  return round(((value / price) - 1) * 100);
}

export function discountToValuePct(value: number | null, price: number | null): number | null {
  if (value === null || price === null || !Number.isFinite(value) || value === 0 || !Number.isFinite(price)) return null;
  return round(((value - price) / value) * 100);
}
