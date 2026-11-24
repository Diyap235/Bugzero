def fetch(cursor, request):
    # This comment does not make the query safe.
    record_id = request.args.get("id")
    sql = "SELECT * FROM records WHERE id = " + str(record_id)
    return cursor.execute(sql)
