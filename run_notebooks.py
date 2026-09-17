"""
Runner script: executes Stage 1, 1b, 3, and 4 notebooks non-interactively.
Presets OPENROUTER_API_KEY to a placeholder so getpass() is skipped (the
notebooks check `if not os.environ.get(...)` before calling getpass -- an
*empty* string is still falsy there and would NOT skip the prompt, so this
has to be a non-empty placeholder, not "").
"""
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import os
import sys

# Pre-set a non-empty placeholder so the notebook's `if not os.environ.get(...)`
# guard is satisfied and getpass() is never called. Real API calls made with
# this placeholder will fail with a real 401 from OpenRouter, which is the
# correct, honest behavior when no real key is available non-interactively.
os.environ.setdefault("OPENROUTER_API_KEY", "sk-or-placeholder-no-real-key-set")

import nbformat
from nbclient import NotebookClient

NOTEBOOKS = [
    ("stage5_validation_suite.ipynb",  "stage5_executed.ipynb"),
]

BASE = os.path.dirname(os.path.abspath(__file__))

for src, dst in NOTEBOOKS:
    src_path = os.path.join(BASE, src)
    dst_path = os.path.join(BASE, dst)
    print(f"\n{'='*60}")
    print(f"Running: {src}")
    print(f"{'='*60}")
    nb = nbformat.read(src_path, as_version=4)
    client = NotebookClient(
        nb,
        timeout=1800,
        kernel_name="python3",
        resources={"metadata": {"path": BASE}},
        # Allow individual cells to error without aborting the whole notebook
        # (e.g. OpenRouter calls that fail because we have no key)
        allow_errors=True,
    )
    try:
        client.execute()
        print(f"  [OK] Completed: {src}")
    except Exception as e:
        print(f"  [ERR] Error in {src}: {e}")

    # Save the executed notebook regardless
    with open(dst_path, "w", encoding="utf-8") as f:
        nbformat.write(nb, f)
    print(f"  Saved → {dst}")

print("\nAll done.")
