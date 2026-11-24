type Db = { query: (sql: string) => unknown };
export function find(db: Db, req: { query: { term?: string } }) {
  const term = req.query.term ?? "";
  return db.query(`SELECT * FROM products WHERE name = '${term}'`);
}
