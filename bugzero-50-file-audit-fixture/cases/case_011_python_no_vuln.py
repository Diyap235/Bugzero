def greet(name):
    safe_name = str(name).strip()[:80]
    return "Hello, " + safe_name
