"""Stage 5a kit: builds every collection in art/environment.blend and exports its graphs.

The .blend file is output; this script is the source, so a reviewer can read the geometry. Run it
over the Blender MCP (or headless) after loading the exporter:

    exec(open(REPO + '/art/ttt_authoring.py').read(), globals())
    exec(open(REPO + '/art/stage5_kit.py').read(), globals())
    build_all(); export_all(REPO); save_blend(REPO)

Specs: docs/art/specs/stage5/. Every position and rotation below is in **Three space** (Y up, +Z
forward) through `B()` and `R()` from kit_common.py. Each asset's graph root is unrotated and every
other node is its direct child.
"""
import math

# B(), R(), Graph, hexrgb() and triangles() are shared with stage7_kit.py.
exec(open(REPO + '/art/kit_common.py').read(), globals())


def materials():
    for name, colour, rough, metal in [
    ]:
        material(name, hexrgb(colour), rough, metal)


def build_all():
    import bpy
    materials()
    built = {}
    bpy.context.view_layer.update()
    return built


SETS = {}


def export_all(repo):
    graphs = repo + '/src/entities/graphs/'
    for set_name, roots in SETS.items():
        export_set(roots, graphs + set_name + '.json', set_name)


def save_blend(repo):
    import bpy
    bpy.ops.wm.save_as_mainfile(filepath=repo + '/art/environment.blend', compress=True)
