/** Each portfolio's colour, by its place in the list: its avatar and its dot in the All mark match. */
export const portfolioColor = (index: number) => `var(--cat-${(index % 7) + 1})`;
