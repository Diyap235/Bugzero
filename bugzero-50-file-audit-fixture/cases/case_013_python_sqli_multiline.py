def find_order(cursor, request):
    order_id = request.args.get("order_id")
    sql = (
        "SELECT * FROM orders WHERE id = "
        + str(order_id)
    )
    return cursor.execute(sql)
