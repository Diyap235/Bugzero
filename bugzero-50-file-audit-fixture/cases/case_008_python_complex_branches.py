def dispatch(action, value):
    if action == "a": return value.strip()
    elif action == "b": return value.lower()
    elif action == "c": return value.upper()
    elif action == "d": return value.replace(" ", "_")
    elif action == "e": return value[::-1]
    elif action == "f": return value.title()
    elif action == "g": return value.capitalize()
    elif action == "h": return value.swapcase()
    elif action == "i": return value.lstrip()
    elif action == "j": return value.rstrip()
    return ""
