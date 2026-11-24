type Db = { query: (sql: string, params: unknown[]) => unknown };
export function getUser(db: Db, id: string) {
  return db.query("SELECT * FROM users WHERE id = ?", [id]);
}
