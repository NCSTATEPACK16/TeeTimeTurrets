"""Rebuilds the primitive graphs from the Blender kits without the Blender MCP (Stage 4b, spec §4).

    blender --background --factory-startup --python-exit-code 1 --python tools/blender/rebuild_graphs.py -- stage5 stage7

Each named kit (`art/<name>_kit.py`) is run the way its own docstring says to run it over the MCP:
the exporter (`art/ttt_authoring.py`) first, then the kit, then `build_all()` and `export_all()`.
Each kit starts from an empty scene.

**The output must be byte-identical to the MCP export.** The script ends by running
`git diff --stat src/entities/graphs/`; it must print nothing. If it prints anything, the headless
build differs from the MCP one: do not commit the graphs, and find out why first.

Two traps from docs/HANDOFF.md are handled here:
- every collection is unhidden before export, since a hidden collection exports every node at the
  origin;
- `view_layer.update()` runs before export, so the matrices read are current.

Written in a cloud session with no Blender, so it has not been run yet.
"""
import os
import subprocess
import sys

import bpy

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
KITS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["stage5", "stage7"]


def unhide_everything():
    for collection in bpy.data.collections:
        collection.hide_viewport = False
        collection.hide_render = False
    stack = [bpy.context.view_layer.layer_collection]
    while stack:
        layer = stack.pop()
        layer.exclude = False
        layer.hide_viewport = False
        stack.extend(layer.children)
    bpy.context.view_layer.update()


def run_kit(name):
    bpy.ops.wm.read_homefile(use_empty=True)
    scope = {"__name__": "kit_" + name, "REPO": REPO}
    exec(open(os.path.join(REPO, "art", "ttt_authoring.py")).read(), scope)
    exec(open(os.path.join(REPO, "art", name + "_kit.py")).read(), scope)
    built = scope["build_all"]()
    unhide_everything()
    export_all = scope["export_all"]
    # stage5's takes what build_all built; stage7's reads the scene.
    if export_all.__code__.co_argcount >= 2:
        export_all(REPO, built)
    else:
        export_all(REPO)
    print("rebuild_graphs: exported", name)


for kit in KITS:
    run_kit(kit)

diff = subprocess.run(["git", "diff", "--stat", "src/entities/graphs/"], cwd=REPO, capture_output=True, text=True).stdout
if diff.strip():
    print("rebuild_graphs: NOT byte-identical to the committed graphs:\n" + diff)
    sys.exit(1)
print("rebuild_graphs: byte-identical: git diff --stat src/entities/graphs/ is empty")
