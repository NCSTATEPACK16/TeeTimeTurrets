"""Stage 5a kit: builds every collection in art/environment.blend and exports its graphs.

The .blend file is output; this script is the source, so a reviewer can read the geometry. Run it
over the Blender MCP (or headless) after loading the exporter:

    exec(open(REPO + '/art/ttt_authoring.py').read(), globals())
    exec(open(REPO + '/art/stage5_kit.py').read(), globals())
    built = build_all(); export_all(REPO, built); save_blend(REPO)

Specs: docs/art/specs/stage5/. Every position and rotation below is in **Three space** (Y up, +Z
forward) through `B()` and `R()` from kit_common.py. Each asset's graph root is unrotated and every
other node is its direct child.
"""
import math

# B(), R(), Graph, hexrgb() and triangles() are shared with stage7_kit.py.
exec(open(REPO + '/art/kit_common.py').read(), globals())


def materials():
    for name, colour, rough, metal in [
        # trees (trees.md): parkland defaults; every biome overrides all three at merge time
        ('tree_trunk', 0x654E3E, 0.9, 0.0), ('tree_foliage_dark', 0x446327, 0.9, 0.0),
        ('tree_foliage_light', 0x669F34, 0.9, 0.0),
    ]:
        material(name, hexrgb(colour), rough, metal)


# --- trees (trees.md) ---------------------------------------------------------------------------
# Unit height: every species tops out at exactly y = 1.0 with its origin at ground contact, because
# Trees.ts scales each instance by the biome's treeHeight. A part tilted about X is lifted so its
# lowest vertex lands on y = 0 rather than through it.

def _tilted_base_y(half_h, r, tilt_deg):
    """Centre height that puts the lowest rim vertex of a cone or cylinder tilted about X on y = 0.
    Every Three cone and cylinder has a rim vertex at local +z (theta = 0), which is the one a tilt
    about X swings lowest (or -z for a negative tilt, which the radial symmetry mirrors)."""
    t = D(abs(tilt_deg))
    return half_h * math.cos(t) + r * math.sin(t)


def build_conifer_tall():
    g = Graph('trees', 'tr_conifer_trunk', 'cylinder', [0.07, 0.1, 0.3, 5], 'tree_trunk', (0, 0.15, 0))
    # Three tiers, each nudged off the axis and turned so the stack is not a perfect lathe.
    g.add('tr_conifer_low', 'cone', [0.36, 0.5, 7], 'tree_foliage_dark', (0, 0.42, 0), rot=(0, 10, 0))
    g.add('tr_conifer_mid', 'cone', [0.28, 0.42, 7], 'tree_foliage_dark', (0.025, 0.62, -0.01), rot=(0, 35, 0))
    g.add('tr_conifer_top', 'cone', [0.19, 0.34, 7], 'tree_foliage_light', (-0.015, 0.83, 0.015), rot=(0, 55, 0))
    return g


def build_broadleaf_oak():
    g = Graph('trees', 'tr_oak_trunk', 'cylinder', [0.07, 0.1, 0.4, 5], 'tree_trunk', (0, 0.2, 0))
    g.add('tr_oak_clump0', 'sphere', [0.28, 6, 4], 'tree_foliage_dark', (0, 0.55, 0))
    g.add('tr_oak_clump1', 'sphere', [0.24, 6, 4], 'tree_foliage_dark', (0.2, 0.62, 0.1), rot=(0, 30, 0))
    g.add('tr_oak_clump2', 'sphere', [0.23, 6, 4], 'tree_foliage_light', (-0.18, 0.7, -0.08), rot=(0, 15, 0))
    g.add('tr_oak_clump3', 'sphere', [0.22, 6, 4], 'tree_foliage_light', (0.02, 0.78, 0.05), rot=(0, 45, 0))
    return g


def build_gorse_mound():
    # Scrub, not a tree: three mounds 1.8 wide and 1.0 tall, no trunk.
    g = Graph('trees', 'tr_gorse_mid', 'sphere', [0.5, 7, 4], 'tree_foliage_light', (0, 0.5, 0))
    g.add('tr_gorse_east', 'sphere', [0.38, 6, 4], 'tree_foliage_dark', (0.52, 0.38, 0.12), rot=(0, 20, 0))
    g.add('tr_gorse_west', 'sphere', [0.38, 6, 4], 'tree_foliage_dark', (-0.52, 0.38, -0.12), rot=(0, 40, 0))
    return g


PINE_LEAN = 20


def build_pine_windbent():
    # The root is a short unrotated root flare (the pipeline keeps graph roots unrotated); the lean
    # lives on the trunk, a direct child, and the umbrella canopy sits over the trunk's top.
    g = Graph('trees', 'tr_pine_flare', 'cylinder', [0.08, 0.11, 0.06, 5], 'tree_trunk', (0, 0.03, 0))
    half, rb = 0.375, 0.08
    lean = D(PINE_LEAN)
    y = _tilted_base_y(half, rb, PINE_LEAN)
    g.add('tr_pine_trunk', 'cylinder', [0.05, rb, 2 * half, 5], 'tree_trunk',
          (0, y, half * math.sin(lean)), rot=(PINE_LEAN, 0, 0))
    top_z = 2 * half * math.sin(lean)
    g.add('tr_pine_canopy', 'cone', [0.62, 0.26, 8], 'tree_foliage_dark', (0, 0.78, top_z), rot=(0, 12, 0))
    g.add('tr_pine_crown', 'cone', [0.4, 0.2, 8], 'tree_foliage_light', (-0.05, 0.9, top_z + 0.04), rot=(0, 34, 0))
    return g


def build_willow_weeping():
    g = Graph('trees', 'tr_willow_trunk', 'cylinder', [0.06, 0.1, 0.55, 5], 'tree_trunk', (0, 0.275, 0))
    g.add('tr_willow_crown', 'cone', [0.44, 0.44, 8], 'tree_foliage_dark', (0, 0.72, 0))
    g.add('tr_willow_top', 'cone', [0.3, 0.34, 8], 'tree_foliage_light', (0.02, 0.83, -0.02), rot=(0, 22, 0))
    # Six strands of uneven length hanging from just inside the crown's rim, each turned to face
    # outward (Y only), so the canopy reads as weeping rather than as a gazebo on posts.
    for i, length in enumerate((0.34, 0.26, 0.38, 0.28, 0.36, 0.24)):
        a = 60 * i + 15
        r = 0.4
        g.add('tr_willow_strand%d' % i, 'box', [0.06, length, 0.025], 'tree_foliage_light',
              (r * math.sin(D(a)), 0.54 - length / 2, r * math.cos(D(a))), rot=(0, a, 0))
    return g


# (x, z, height, radius, tilt about X in degrees, slot) for the reed stems; the first is the root.
REEDS = [
    (0.0, 0.0, 1.0, 0.045, 0, 'tree_foliage_dark'),
    (0.14, 0.05, 0.82, 0.04, 8, 'tree_foliage_light'),
    (-0.12, 0.08, 0.9, 0.04, -7, 'tree_foliage_light'),
    (0.06, -0.14, 0.7, 0.035, -11, 'tree_foliage_dark'),
    (-0.08, -0.1, 0.78, 0.04, 6, 'tree_foliage_dark'),
    (0.2, -0.06, 0.62, 0.035, -9, 'tree_foliage_light'),
    (-0.22, -0.02, 0.66, 0.035, 12, 'tree_foliage_dark'),
    (0.03, 0.18, 0.74, 0.035, 10, 'tree_foliage_light'),
]


def build_reed_clump():
    g = None
    for i, (x, z, h, r, tilt, slot) in enumerate(REEDS):
        y = _tilted_base_y(h / 2, r, tilt)
        if g is None:
            g = Graph('trees', 'tr_reed0', 'cone', [r, h, 4], slot, (x, y, z))
        else:
            g.add('tr_reed%d' % i, 'cone', [r, h, 4], slot, (x, y, z), rot=(tilt, 0, 0))
    return g


def build_all():
    import bpy
    materials()
    built = {
        'conifer_tall': build_conifer_tall(),
        'broadleaf_oak': build_broadleaf_oak(),
        'gorse_mound': build_gorse_mound(),
        'pine_windbent': build_pine_windbent(),
        'willow_weeping': build_willow_weeping(),
        'reed_clump': build_reed_clump(),
    }
    bpy.context.view_layer.update()
    return built


TREES = ('conifer_tall', 'broadleaf_oak', 'gorse_mound', 'pine_windbent', 'willow_weeping', 'reed_clump')

# Each exported set: the graph names in it, which are also the keys build_all() returns.
SETS = {
    'trees': TREES,
}


def _roots(built, names):
    return {name: built[name].root.name for name in names}


def export_all(repo, built):
    graphs = repo + '/src/entities/graphs/'
    for set_name, names in SETS.items():
        export_set(_roots(built, names), graphs + set_name + '.json', set_name)


def save_blend(repo):
    import bpy
    bpy.ops.wm.save_as_mainfile(filepath=repo + '/art/environment.blend', compress=True)
