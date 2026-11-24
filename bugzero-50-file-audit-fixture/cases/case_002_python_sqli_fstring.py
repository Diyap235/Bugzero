def search_user(cursor, request):
    term = request.args.get("q")
    query = f"SELECT * FROM users WHERE name = '{term}'"
    return cursor.execute(query)
