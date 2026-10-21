// Help panel copy: short answers to the questions a new person asks. One file so the wording stays in one place.
// Pure module (no React). Keep answers short and plain; anything that would be wrong if the product changed belongs here.

export type HelpAnswer = { id: string; question: string; answer: string };

export const HELP_FAQ: HelpAnswer[] = [
  {
    id: 'vault',
    question: 'What is the vault password, and how is it different from Google sign-in?',
    answer:
      'Google sign-in proves who you are. Your vault password unlocks your data, which is encrypted on your device before it is saved. Nobody else can read it, including whoever runs this app, so the password cannot be reset for you.',
  },
  {
    id: 'lost',
    question: 'I forgot my vault password.',
    answer:
      'Use the recovery key you saved when you created your vault: on the unlock screen choose to recover with it, then set a new password. Without the password or the recovery key, the data cannot be opened by anyone.',
  },
  {
    id: 'device',
    question: 'How do I use Sipwise on another device?',
    answer:
      'Sign in with the same Google account and enter your vault password. Your encrypted data comes with you. An encrypted backup from Settings is only an extra safety copy.',
  },
  {
    id: 'prices',
    question: 'Where do prices come from, and how late are they?',
    answer:
      'Prices come from the PSX website and are refreshed through the trading day, so they can lag by several minutes. Use Refresh prices in the header to ask for the latest. Mutual fund prices are the daily MUFAP repurchase prices; gold and silver use public rates.',
  },
  {
    id: 'dividends',
    question: 'How are dividends found?',
    answer:
      'Sipwise reads PSX dividend announcements for the companies you hold and adds them for you. Announcements arrive in the bell. Past payouts whose payment date is not known are marked as estimated, and you can edit or void any of them in Activity.',
  },
  {
    id: 'costs',
    question: 'What does "costs missing" mean?',
    answer:
      'Some holdings came in without a purchase price, for example an opening balance from a statement. Their gain cannot be worked out, so they are left out of returns until you add the cost. Choose Fix on the Holdings page to add it.',
  },
  {
    id: 'imports',
    question: 'Which broker statements can I import?',
    answer:
      'AHL, Finqalab, JS Global, Youngs Capital, Syed Faraz Equities and other PSX statements that use the same layout, plus IPO allotments and Sipwise backups. You review everything before it is saved, and the file is read on your device.',
  },
  {
    id: 'picks',
    question: 'Is Monthly Picks investment advice?',
    answer:
      'No. It is maths worked out on your device from public PSX data and your own limits, and nothing is bought for you. It is a Beta feature: treat it as a starting point for your own decision.',
  },
];

export const HELP_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'Ctrl K', label: 'Search companies, funds and gold' },
  { keys: '[', label: 'Fold or unfold the sidebar' },
  { keys: 'Esc', label: 'Close a panel or dialog' },
];
