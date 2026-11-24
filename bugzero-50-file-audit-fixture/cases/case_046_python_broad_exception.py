def parse_number(value):
    try:
        return int(value)
    except Exception:
        return 0
