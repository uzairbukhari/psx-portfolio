// The product tour: what each step says and which element it points at. Pure (no React, no DOM): the component finds the
// element for a step's `target` (data-tour="...") and skips a step whose element is not on screen. Copy lives here only.

export const TOUR_STEP_IDS = ['value', 'add', 'portfolios', 'pages', 'bell', 'profile'] as const;
export type TourStepId = (typeof TOUR_STEP_IDS)[number];

export type TourItem = {
  name: string;
  text: string;
  /** Left out when the page link is not in the menu (for example Monthly Picks before the first stock). */
  href?: string;
};

export type TourStep = {
  id: TourStepId;
  title: string;
  body: string;
  items?: TourItem[];
  /** Small print at the bottom of the popover on a wide screen (keyboard hints). */
  note?: string;
  /** Small print on a phone instead. */
  phoneNote?: string;
};

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'value',
    title: 'Your money, today',
    body: 'What everything is worth at today’s prices, what you put in, and your gain. Stock prices update through the trading day.',
  },
  {
    id: 'add',
    title: 'Add anything, any time',
    body: 'Record a buy, sale, dividend, bonus or split. Add a mutual fund, gold, dollars or a savings plan, or import another broker statement.',
  },
  {
    id: 'portfolios',
    title: 'One portfolio or several',
    body: 'Keep separate portfolios, for example one per broker or one for your family. “All” adds them up.',
  },
  {
    id: 'pages',
    title: 'Your pages',
    body: '',
    items: [
      { name: 'Holdings', text: 'what you own and what it is worth today' },
      { name: 'Insights', text: 'where your money is, income, returns and tax', href: '/reports' },
      { name: 'SIP Blueprint', text: 'your monthly budget and how to split it', href: '/sip-tracker' },
      { name: 'Monthly Picks', text: 'ideas for this month’s money, worked out on your device. Not advice.', href: '/sip' },
      { name: 'Activity', text: 'every entry, newest first; edit or void any of them', href: '/activity' },
    ],
    note: 'Press [ to fold the sidebar.',
    phoneNote: 'SIP Blueprint and Monthly Picks are under More.',
  },
  {
    id: 'bell',
    title: 'Dividends come to you',
    body: 'When a company you hold announces a dividend on PSX, it shows up here and on Holdings. You don’t have to type it in.',
  },
  {
    id: 'profile',
    title: 'Settings and help live here',
    body: 'Tax status, backups, imports and security are in Settings. Help has this tour, your checklist and answers to common questions.',
  },
];

/** The steps to show: those whose element is on screen. `has(id)` answers that; items without a link are kept. */
export function stepsToShow(has: (id: TourStepId) => boolean, hasLink: (href: string) => boolean): TourStep[] {
  return TOUR_STEPS.filter((s) => has(s.id)).map((s) =>
    s.items ? { ...s, items: s.items.filter((i) => !i.href || hasLink(i.href)) } : s,
  );
}
