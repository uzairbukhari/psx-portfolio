export type Faq = { q: string; a: string; /** Included in the FAQ structured data (English only). */ schema?: boolean; urdu?: boolean };

export const FAQ: Faq[] = [
  { q: 'Is Sipwise really free?', a: 'Yes. Everything is free during early access. When a paid plan arrives, tracking your own ledger and exporting it stay free.', schema: true },
  { q: 'Does Sipwise give investment advice?', a: 'No. It is a tracking and planning tool. Monthly Picks ranks companies you shortlisted using public PSX data, on your device. It does not tell you what to buy and it never places orders.', schema: true },
  { q: 'What if I forget my vault password?', a: 'Use the recovery key you saved when you set up the vault. Without either, nobody can open the data, including us. That is what end-to-end encryption means.', schema: true },
  { q: 'Which brokers’ statements can I import?', a: 'Arif Habib (AHL), Finqalab, JS Global, and brokers that use the standard PSX statement template such as Youngs Capital and Syed Faraz Equities. You can also add trades by hand.', schema: true },
  { q: 'Is there an iPhone app?', a: 'Android has a native app. On iPhone, use Sipwise in Safari and add it to your home screen.', schema: true },
  { q: 'کیا یہ اردو میں دستیاب ہے؟', a: 'جی ہاں، شروع کرنے کی ویڈیو اردو میں ہے۔ ایپ ابھی انگریزی میں ہے۔', urdu: true },
];
