def handler(cursor, request):
    def query_for(value):
        sql = "SELECT * FROM inventory WHERE sku = " + str(value)
        return cursor.execute(sql)
    return query_for(request.args.get("sku"))
