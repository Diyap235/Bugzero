import subprocess

def make_report(request):
    report = request.args.get("name", "")
    return subprocess.run("report-tool " + report, shell=True, capture_output=True)
