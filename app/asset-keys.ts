/** Identifies one holding on its own page (the same holding can sit in several portfolios on the All view). */
export const ownedKey = (o: { asset: { id: string }; portfolioName?: string }) =>
  `${o.asset.id}${o.portfolioName ? `@${o.portfolioName}` : ''}`;
