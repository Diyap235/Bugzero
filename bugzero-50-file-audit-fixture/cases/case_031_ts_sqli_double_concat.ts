type Db = { query: (sql: string) => unknown };
export function findByName(db: Db, name: string, tenant: string) {
  const sql = "SELECT * FROM users WHERE name = '" + name + "' AND tenant = '" + tenant + "'";
  return db.query(sql);
}
