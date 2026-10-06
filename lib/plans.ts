// Savings plans such as Pak-Qatar's Mahana Bachat & Takaful Flexi Plan (and, later, certificates or term deposits).
// Pure and self-contained (no imports from portfolio.ts), like lib/assets.ts.
//
// What the plan reports is the truth: you enter the value your statement or the provider's app shows, dated. Between
// statements the value is either the last statement value plus what you paid in and took out since, or, if you chose
// to set an assumed yearly rate, that value grown at the rate and labelled "estimated". Gains stay inside the plan
// (reinvested); cash you redeem is a dated entry and counts as money back to you. Gain = value + redeemed - paid in.
export type PlanEntry = {
  id: string;
  date: string;
  type: 'contribution' | 'redeem';
  /** Rupees paid in, or rupees received on redemption. */
  amount: number;
  /** Front-end load taken out of a contribution, in rupees. `amount` is still what you paid; `amount - load` is what
   * was actually invested, which is what the plan's estimated value grows from. */
  load?: number;
  /** Set when the entry came from a monthly rule the user confirmed. */
  recurringId?: string;
  note: string;
  voided?: boolean;
};
export type PlanValuation = {
  id: string;
  date: string;
  value: number;
  note: string;
  voided?: boolean;
};
/** A monthly contribution the user expects; each due month becomes an expected entry to confirm or skip. */
export type PlanRule = {
  id: string;
  /** 1 to 28, so every month has the day. */
  dayOfMonth: number;
  amount: number;
  /** First month the rule applies, as YYYY-MM. */
  from: string;
  /** Last month, inclusive, when the rule ends. */
  to?: string;
  /** Months (YYYY-MM) the user skipped. */
  skipped: string[];
  stopped?: boolean;
};
export type PlanAsset = {
  id: string;
  kind: 'plan';
  name: string;
  provider: 'pak-qatar-mbp' | 'other';
  /** Pak-Qatar sub-fund the money is in (see PAK_QATAR_SUBFUNDS); its daily unit price moves the plan value between statements. */
  subFund?: string;
  note: string;
  /** Optional assumed yearly return as a fraction (0.12 = 12%), used only to estimate between statement values. */
  assumedAnnualRate?: number;
  /** True once everything is redeemed; the history stays. */
  closed?: boolean;
  entries: PlanEntry[];
  valuations: PlanValuation[];
  rules: PlanRule[];
};

/** Pak-Qatar Mahana Bachat sub-funds. The id is stable; the name is what the provider publishes. */
export const PAK_QATAR_SUBFUNDS = [
  { id: 'aggressive', name: 'Aggressive Fund' },
  { id: 'conservative', name: 'Conservative Fund' },
  { id: 'balanced', name: 'Balanced Fund' },
  { id: 'secure-wealth', name: 'Secure Wealth Fund' },
  { id: 'pure-saving', name: 'Pure Saving Fund' },
  { id: 'mustehkam-munafa', name: 'Mustehkam Munafa Fund' },
  { id: 'pure-protection', name: 'Pure Protection Fund' },
  { id: 'kafalat-pension', name: 'Kafalat Pension Fund' },
  { id: 'prosperity', name: 'Prosperity Fund' },
] as const;
/** A sub-fund's published unit price on one day (public data). */
export type PlanNavRow = { fundId: string; date: string; nav: number };

export const PAK_QATAR_PLAN_NAME = 'Mahana Bachat & Takaful Flexi Plan';
/** From the provider's brochure: minimum first contribution and smallest top-up, in rupees. */
export const PAK_QATAR_MIN_FIRST = 50_000;
export const PAK_QATAR_MIN_TOPUP = 1_000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const dayNumber = (date: string) =>
  Date.parse(`${date}T00:00:00Z`) / 86_400_000;

export type PlanValue = {
  value: number;
  /** Where the value comes from. */
  source: 'statement' | 'estimate' | 'paid-in';
  /** Date of the statement value used, if any. */
  statementDate: string | null;
  contributed: number;
  redeemed: number;
  /** Net money still in: paid in minus redeemed. */
  cost: number;
  gain: number;
  gainPercent: number | null;
};

/** What a contribution actually put to work: the amount paid less any front-end load. */
export const invested = (e: { amount: number; load?: number }) =>
  Math.max(0, e.amount - (e.load ?? 0));

const live = <T extends { voided?: boolean }>(list: T[]) =>
  list.filter((x) => !x.voided);

/** Newest unit price on or before a date; null when none is stored that early. */
const navOn = (navs: PlanNavRow[], date: string) => {
  let best: PlanNavRow | null = null;
  for (const n of navs)
    if (n.date <= date && (!best || n.date > best.date)) best = n;
  return best;
};

export function planValue(
  plan: PlanAsset,
  asOf: string,
  planNavs: PlanNavRow[] = [],
): PlanValue {
  const navs = plan.subFund
    ? planNavs.filter((n) => n.fundId === plan.subFund)
    : [];
  const latest = navOn(navs, asOf);
  /** Moves an amount from `date` to `asOf` by the sub-fund's unit price; unchanged when no price is known at `date`. */
  const byNav = (amount: number, date: string) => {
    const then = navOn(navs, date);
    return latest && then ? amount * (latest.nav / then.nav) : amount;
  };
  const entries = live(plan.entries).filter((e) => e.date <= asOf);
  const contributed = cents(
    entries
      .filter((e) => e.type === 'contribution')
      .reduce((n, e) => n + e.amount, 0),
  );
  const contributedNet = cents(
    entries
      .filter((e) => e.type === 'contribution')
      .reduce((n, e) => n + invested(e), 0),
  );
  const redeemed = cents(
    entries
      .filter((e) => e.type === 'redeem')
      .reduce((n, e) => n + e.amount, 0),
  );
  const statements = live(plan.valuations)
    .filter((v) => v.date <= asOf)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const last = statements.at(-1);
  let value: number;
  let source: PlanValue['source'];
  if (plan.closed) {
    value = 0;
    source = 'statement';
  } else if (!last) {
    value = Math.max(
      0,
      cents(
        entries.reduce(
          (n, e) =>
            e.type === 'contribution'
              ? n + byNav(invested(e), e.date)
              : n - byNav(e.amount, e.date),
          0,
        ),
      ),
    );
    source =
      latest && value !== contributedNet - redeemed ? 'estimate' : 'paid-in';
  } else {
    const rate = plan.assumedAnnualRate;
    const grow = (amount: number, from: string, to: string) =>
      rate
        ? amount *
          Math.pow(1 + rate, Math.max(0, dayNumber(to) - dayNumber(from)) / 365)
        : amount;
    // With a sub-fund price, value moves with the price; otherwise by the assumed rate (or not at all).
    const move = (amount: number, from: string) =>
      latest ? byNav(amount, from) : grow(amount, from, asOf);
    let v = move(last.value, last.date);
    for (const e of entries.filter((x) => x.date > last.date))
      v +=
        (e.type === 'contribution' ? 1 : -1) *
        move(e.type === 'contribution' ? invested(e) : e.amount, e.date);
    value = Math.max(0, cents(v));
    const moved = entries.some((e) => e.date > last.date);
    source =
      (latest && asOf > last.date) || (rate && asOf > last.date) || moved
        ? 'estimate'
        : 'statement';
  }
  const cost = cents(contributed - redeemed);
  const gain = cents(value - cost);
  return {
    value,
    source,
    statementDate: last?.date ?? null,
    contributed,
    redeemed,
    cost,
    gain,
    gainPercent: cost > 0 ? (gain / cost) * 100 : null,
  };
}

/** Investor-view money flows: paid in positive, redeemed negative. */
export function planFlows(plan: PlanAsset): { date: string; amount: number }[] {
  return live(plan.entries).map((e) => ({
    date: e.date,
    amount: e.type === 'redeem' ? -e.amount : e.amount,
  }));
}

export type DueEntry = {
  ruleId: string;
  month: string;
  date: string;
  amount: number;
};

const addMonth = (month: string) => {
  const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

/** Monthly contributions that have come due (up to `asOf`) and are neither confirmed nor skipped. */
export function dueEntries(
  plan: {
    rules: PlanRule[];
    entries: { date: string; recurringId?: string; voided?: boolean }[];
    closed?: boolean;
  },
  asOf: string,
): DueEntry[] {
  if (plan.closed) return [];
  const out: DueEntry[] = [];
  for (const rule of plan.rules) {
    if (rule.stopped) continue;
    const confirmed = new Set(
      live(plan.entries)
        .filter((e) => e.recurringId === rule.id)
        .map((e) => e.date.slice(0, 7)),
    );
    for (
      let month = rule.from;
      month <= asOf.slice(0, 7) && (!rule.to || month <= rule.to);
      month = addMonth(month)
    ) {
      const date = `${month}-${String(rule.dayOfMonth).padStart(2, '0')}`;
      if (date > asOf || confirmed.has(month) || rule.skipped.includes(month))
        continue;
      out.push({ ruleId: rule.id, month, date, amount: rule.amount });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Throws with a plain message when the plan cannot be saved. */
export function validatePlan(plan: PlanAsset, today: string) {
  if (plan.provider !== 'pak-qatar-mbp' && plan.provider !== 'other')
    throw new Error('Unknown plan provider.');
  if (
    plan.subFund !== undefined &&
    (plan.provider !== 'pak-qatar-mbp' ||
      !PAK_QATAR_SUBFUNDS.some((f) => f.id === plan.subFund))
  )
    throw new Error('Unknown sub-fund.');
  if (
    plan.assumedAnnualRate !== undefined &&
    (!Number.isFinite(plan.assumedAnnualRate) ||
      plan.assumedAnnualRate < 0 ||
      plan.assumedAnnualRate > 1)
  )
    throw new Error('The assumed yearly return must be between 0% and 100%.');
  if (
    !Array.isArray(plan.entries) ||
    plan.entries.length > 5000 ||
    !Array.isArray(plan.valuations) ||
    plan.valuations.length > 5000 ||
    !Array.isArray(plan.rules) ||
    plan.rules.length > 50
  )
    throw new Error('Invalid plan records.');
  const ids = new Set<string>();
  const unique = (id: unknown) => {
    if (typeof id !== 'string' || !id || ids.has(id))
      throw new Error('Invalid plan record identifier.');
    ids.add(id);
  };
  const date = (d: unknown) => {
    if (typeof d !== 'string' || !DATE.test(d) || d > today)
      throw new Error(
        'Plan dates must be real dates that are not in the future.',
      );
  };
  for (const e of plan.entries) {
    unique(e.id);
    date(e.date);
    if (e.type !== 'contribution' && e.type !== 'redeem')
      throw new Error('Invalid plan entry type.');
    if (!Number.isFinite(e.amount) || e.amount <= 0 || e.amount > 1e12)
      throw new Error('Enter an amount greater than zero.');
    if (
      e.load !== undefined &&
      (!Number.isFinite(e.load) ||
        e.load < 0 ||
        e.load >= e.amount ||
        e.type !== 'contribution')
    )
      throw new Error('The load must be less than the amount paid.');
    if (typeof e.note !== 'string' || e.note.length > 500)
      throw new Error('Entry note is too long.');
  }
  for (const v of plan.valuations) {
    unique(v.id);
    date(v.date);
    if (!Number.isFinite(v.value) || v.value < 0 || v.value > 1e12)
      throw new Error('Enter a valid plan value.');
    if (typeof v.note !== 'string' || v.note.length > 500)
      throw new Error('Note is too long.');
  }
  for (const r of plan.rules) {
    unique(r.id);
    if (
      !Number.isInteger(r.dayOfMonth) ||
      r.dayOfMonth < 1 ||
      r.dayOfMonth > 28
    )
      throw new Error('Choose a day from 1 to 28.');
    if (!Number.isFinite(r.amount) || r.amount <= 0 || r.amount > 1e12)
      throw new Error('Enter a monthly amount greater than zero.');
    if (
      !MONTH.test(r.from) ||
      (r.to !== undefined && !MONTH.test(r.to)) ||
      !Array.isArray(r.skipped) ||
      r.skipped.some((m) => !MONTH.test(m))
    )
      throw new Error('Invalid monthly schedule.');
  }
  // Cash cannot be taken out of a plan before it was paid in.
  let balance = 0;
  for (const e of live(plan.entries).sort((a, b) =>
    a.date < b.date
      ? -1
      : a.date > b.date
        ? 1
        : a.type === 'contribution'
          ? -1
          : 1,
  ))
    balance += e.type === 'contribution' ? e.amount : -e.amount;
  if (balance < -0.005 && !plan.valuations.length)
    throw new Error(
      `${plan.name}: more was redeemed than was paid in. Enter a statement value if the plan grew.`,
    );
}

export const newPlanId = () =>
  `plan-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
