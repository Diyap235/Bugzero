export function buildSql(id: string) {
  return "SELECT * FROM users WHERE id = " + id;
}
