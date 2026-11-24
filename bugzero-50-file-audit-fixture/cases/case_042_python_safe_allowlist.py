ALLOWED = {"name", "created_at", "status"}

def order_by(field):
    if field not in ALLOWED:
        field = "name"
    return "SELECT * FROM records ORDER BY " + field
