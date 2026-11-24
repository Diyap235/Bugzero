def lookup(cursor, request):
    account = request.args.get("account")
    sql = "SELECT * FROM accounts WHERE account = '" + str(account) + "'"
    cursor.execute(sql)
    return sql
