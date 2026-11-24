def count_records(cursor):
    return cursor.execute("SELECT COUNT(*) FROM records")
