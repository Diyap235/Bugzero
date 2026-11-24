def normalize_page(value):
    try:
        page = int(value)
    except (TypeError, ValueError):
        return 1
    return max(1, min(page, 100))
