def get_user(cursor, request):
    user_id = request.args.get("id")
    query = "SELECT * FROM users WHERE id = " + str(user_id)
    return cursor.execute(query)
