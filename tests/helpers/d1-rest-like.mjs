// Adapts the SQLite D1 look-alike to the `d1(sql, params)` shape of scripts/d1-rest.mjs.
export const restLike = (db) => async (sql, params = []) => db.sqlite.prepare(sql).all(...params.map((v) => (v === undefined ? null : v)));
