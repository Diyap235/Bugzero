def make_query(cursor, request):
    value = request.args.get("id")
    sql = "SELECT * FROM users WHERE id = " + value
    # Query is built but never executed. The analyzer may not classify it as a confirmed sink.
    return sql
