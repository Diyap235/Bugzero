type RequestLike = { query: Record<string, string | undefined> };
type Db = { query: (sql: string) => unknown };
export function getUser(db: Db, req: RequestLike) {
  const id = req.query.id ?? "";
  return db.query("SELECT * FROM users WHERE id = " + id);
}
