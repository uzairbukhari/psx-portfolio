import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
export const portfolios = sqliteTable('portfolios', {
  userId: text('user_id').primaryKey(),
  payload: text('payload').notNull(),
  revision: integer('revision').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
});
export const reviews = sqliteTable(
  'ai_reviews',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    revision: integer('revision').notNull(),
    month: text('month').notNull(),
    status: text('status').notNull(),
    payload: text('payload'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('idx_ai_reviews_user_created').on(table.userId, table.createdAt),
  ],
);
