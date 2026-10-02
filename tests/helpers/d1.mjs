// A D1Database look-alike over node:sqlite with the real drizzle migrations applied, so service
// code that talks to D1 can be integration-tested without Cloudflare.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../drizzle/', import.meta.url));
const norm = (v) => (v === undefined ? null : v);

export function createD1() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort())
    for (const statement of readFileSync(dir + file, 'utf8').split('--> statement-breakpoint'))
      if (statement.trim()) sqlite.exec(statement);
  const statement = (sql, args = []) => ({
    sql, args,
    bind: (...next) => statement(sql, next.map(norm)),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
  });
  return {
    sqlite,
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
}
