"""
Collect "ordinary" safe functions for BugZero.

PyVul gives us vulnerable functions. For every PyVul fix commit we look at the
.py files the commit changed, download each file as it was BEFORE the fix, and
keep the functions the fix did NOT touch. They come from the same file and
project as the vulnerable function, so the model can't cheat by learning a
project's coding style.

Run once. It calls the GitHub API about 820 times, so it needs a token:
    PowerShell:  $env:GITHUB_TOKEN = (gh auth token); python fetch_ordinary_functions.py
    Git Bash:    GITHUB_TOKEN=$(gh auth token) python fetch_ordinary_functions.py

Output: ordinary_functions.csv.gz (about 26,000 functions, 4 MB) with columns
code, repo, commit, file, lines. The notebook later picks a matched sample from it.
"""

import ast
import json
import os
import re
import urllib.parse
import warnings
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PYVUL_FILE = os.path.join(HERE, "..", "training", "pyvul", "function_level_dataset.out")
PYVUL_URL = "https://raw.githubusercontent.com/billquan/PyVul/main/dataset/function_level_dataset.out"
OUTPUT = os.path.join(HERE, "ordinary_functions.csv.gz")
TOKEN = os.environ.get("GITHUB_TOKEN", "")

# old code has things like "\d" in normal strings; Python warns about it, we don't care
warnings.filterwarnings("ignore", category=SyntaxWarning)


def download(url, is_api=False):
    headers = {"User-Agent": "bugzero-student-project"}
    if is_api and TOKEN:
        headers["Authorization"] = "Bearer " + TOKEN
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read().decode("utf-8", errors="replace")
    except Exception:
        return None  # deleted repo, missing file, network error: just skip it


def is_test_file(path):
    # test code looks very different from app code, so we leave it out
    name = path.lower()
    return "test" in name or name.endswith("conftest.py")


def changed_line_ranges(patch):
    # "@@ -120,7 +120,9 @@" means lines 120..126 of the OLD file are in the change
    ranges = []
    for start, count in re.findall(r"^@@ -(\d+)(?:,(\d+))? \+", patch, re.M):
        start = int(start)
        count = 1 if count == "" else int(count)
        ranges.append((start, start + max(count, 1) - 1))
    return ranges


def top_level_functions(tree):
    # functions in the module and methods in classes (not functions inside functions)
    found = []
    to_visit = list(tree.body)
    while to_visit:
        node = to_visit.pop(0)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            found.append(node)
        elif isinstance(node, ast.ClassDef):
            to_visit.extend(node.body)
    return found


def functions_not_changed(commit_url):
    # "https://github.com/owner/name/commit/sha" -> owner, name, sha
    owner, name, _, sha = commit_url.split("github.com/")[1].split("/")[:4]
    info = download(f"https://api.github.com/repos/{owner}/{name}/commits/{sha}", is_api=True)
    if info is None:
        return []
    info = json.loads(info)
    if not info.get("parents"):
        return []
    parent_sha = info["parents"][0]["sha"]

    results = []
    for f in info.get("files", []):
        path = f["filename"]
        if not path.endswith(".py") or f["status"] != "modified" or "patch" not in f:
            continue
        if is_test_file(path):
            continue

        # the file as it was BEFORE the fix (same version as the vulnerable function)
        url = f"https://raw.githubusercontent.com/{owner}/{name}/{parent_sha}/{urllib.parse.quote(path)}"
        source = download(url)
        if source is None:
            continue
        try:
            tree = ast.parse(source)
        except SyntaxError:
            continue  # for example old Python 2 code

        lines = source.splitlines()
        changed = changed_line_ranges(f["patch"])
        for func in top_level_functions(tree):
            touched = any(func.lineno <= end and start <= func.end_lineno for start, end in changed)
            if touched:
                continue
            code = "\n".join(lines[func.lineno - 1:func.end_lineno]).strip()
            results.append({
                "code": code,
                "repo": (owner + "/" + name).lower(),
                "commit": commit_url,
                "file": path,
                "lines": func.end_lineno - func.lineno + 1,
            })
    return results


if __name__ == "__main__":
    if not TOKEN:
        print("Warning: no GITHUB_TOKEN, GitHub allows only 60 API calls per hour without one.")

    if not os.path.exists(PYVUL_FILE):
        os.makedirs(os.path.dirname(PYVUL_FILE), exist_ok=True)
        urllib.request.urlretrieve(PYVUL_URL, PYVUL_FILE)

    with open(PYVUL_FILE, encoding="utf-8") as f:
        records = [json.loads(line) for line in f if line.strip()]
    commits = sorted(set(r["commit"] for r in records if r["programming_language"] == "Python"))
    print("Fix commits:", len(commits))

    # 8 downloads at a time, so it takes minutes instead of half an hour
    rows = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        for i, found in enumerate(pool.map(functions_not_changed, commits), start=1):
            rows.extend(found)
            if i % 100 == 0:
                print(f"  {i}/{len(commits)} commits, {len(rows)} functions so far")

    df = pd.DataFrame(rows)
    df = df[df["code"] != ""]
    df = df.drop_duplicates(subset="code").reset_index(drop=True)
    df.to_csv(OUTPUT, index=False, compression="gzip")
    print("Saved", OUTPUT, "with", len(df), "functions from", df["repo"].nunique(), "projects")
