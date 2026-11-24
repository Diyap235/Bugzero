def get_active_users(cursor):
    return cursor.execute("SELECT * FROM users WHERE active = 1")
