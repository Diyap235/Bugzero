type Db = { query: (sql: string) => unknown };
export function removeAccount(db: Db, id: string) {
  const query = "DELETE FROM accounts WHERE id = " + id;
  return db.query(query);
}
