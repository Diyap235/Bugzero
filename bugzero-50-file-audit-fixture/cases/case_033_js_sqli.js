function getUser(db, req) {
  const id = req.query.id || "";
  return db.query("SELECT * FROM users WHERE id = " + id);
}
module.exports = { getUser };
