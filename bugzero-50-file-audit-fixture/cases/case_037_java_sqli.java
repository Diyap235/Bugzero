class UserRepository {
    Object findUser(Database db, String id) {
        String sql = "SELECT * FROM users WHERE id = " + id;
        return db.query(sql);
    }
}
