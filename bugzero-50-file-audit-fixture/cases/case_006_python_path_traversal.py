from pathlib import Path

def read_document(request):
    filename = request.args.get("file", "")
    return (Path("/tmp/docs") / filename).read_text()
