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
        # clubhouse dressing (clubhouse-dressing.md), following the clubhouse's cb_* palette
        ('dr_timber', 0x8A5A32, 0.8, 0.0), ('dr_iron', 0x2F3336, 0.5, 0.6),
        ('dr_white', 0xF3EEDC, 0.7, 0.0), ('dr_flag', 0x7F9A88, 0.8, 0.0),
        ('dr_flag_stripe', 0xF3EEDC, 0.8, 0.0), ('dr_shrub', 0x446327, 0.9, 0.0),
        ('dr_bag_a', 0xB0352A, 0.7, 0.0), ('dr_bag_b', 0x23355E, 0.7, 0.0),
        ('dr_board', 0x1F4D2E, 0.8, 0.0),
        # horizon hills (horizon-hills.md): parkland foliageDark 70% toward the parkland sky; the
        # renderer recomputes this override from biomes.ts, so this is only the file's default
        ('hill', 0x509AB3, 1.0, 0.0),
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


# --- clubhouse dressing (clubhouse-dressing.md) ---------------------------------------------------
# Origin at ground contact, front facing +z. No colliders: carts pass through these.

BENCH_SEAT_Y = 0.45


def build_bench():
    t = 0.035
    # Root: the middle seat slat, top face at the seat height.
    g = Graph('dressing', 'dr_bench_seat1', 'box', [1.6, t, 0.1], 'dr_timber', (0, BENCH_SEAT_Y - t / 2, 0))
    for i, z in ((0, 0.12), (2, -0.12)):
        g.add('dr_bench_seat%d' % i, 'box', [1.6, t, 0.1], 'dr_timber', (0, BENCH_SEAT_Y - t / 2, z))
    # Back slats, leaning back 12 degrees with the end frames' backrest.
    for i, (y, z) in enumerate(((0.6, -0.215), (0.76, -0.25))):
        g.add('dr_bench_back%d' % i, 'box', [1.6, 0.1, t], 'dr_timber', (0, y, z), rot=(-12, 0, 0))
    # Cast-iron end frames: a side-profile prism (front foot, seat, backrest, back foot) turned about
    # Y so the profile stands in the bench's YZ plane, plus an armrest box. Profile is (-z, y).
    profile = [(0.24, 0.0), (0.16, 0.42), (-0.18, 0.42), (-0.3, 0.86), (-0.26, 0.0)]
    flat = [v for z, y in profile for v in (-z, y)]
    for s, n in ((1, 'e'), (-1, 'w')):
        g.add('dr_bench_frame_' + n, 'prism', [0.05] + flat, 'dr_iron', (s * 0.74, 0, 0), rot=(0, 90, 0))
        g.add('dr_bench_arm_' + n, 'box', [0.06, 0.05, 0.46], 'dr_iron', (s * 0.74, 0.64, -0.02))
    return g


FLAGPOLE_H = 8.0


def build_flagpole():
    g = Graph('dressing', 'dr_pole', 'cylinder', [0.045, 0.06, FLAGPOLE_H - 0.15, 6], 'dr_white',
              (0, (FLAGPOLE_H - 0.15) / 2, 0))
    g.add('dr_pole_finial', 'sphere', [0.1, 5, 3], 'dr_white', (0, FLAGPOLE_H - 0.1, 0))
    # The club flag: a swallowtail 1.4 x 0.9, flown along +x from the pole, not a national flag.
    tail = [0, 0, 1.4, 0, 1.05, 0.45, 1.4, 0.9, 0, 0.9]
    g.add('dr_flag', 'prism', [0.02] + tail, 'dr_flag', (0.06, 6.8, 0))
    # Cream stripe across its middle, a touch thicker so it shows on both faces.
    stripe = [0, 0.38, 1.104, 0.38, 1.05, 0.45, 1.104, 0.52, 0, 0.52]
    g.add('dr_flag_stripe', 'prism', [0.03] + stripe, 'dr_flag_stripe', (0.06, 6.8, 0))
    return g


def build_planter():
    g = Graph('dressing', 'dr_planter_box', 'box', [1.2, 0.5, 1.2], 'dr_timber', (0, 0.25, 0))
    g.add('dr_planter_rim', 'box', [1.3, 0.06, 1.3], 'dr_timber', (0, 0.5, 0))
    g.add('dr_planter_shrub', 'sphere', [0.55, 8, 5], 'dr_shrub', (0, 0.9, 0), rot=(0, 20, 0))
    return g


BAG_LEAN = 10


def build_bag_rack():
    g = Graph('dressing', 'dr_rack_rail_top', 'box', [1.6, 0.05, 0.05], 'dr_iron', (0, 0.78, 0))
    g.add('dr_rack_rail_low', 'box', [1.6, 0.05, 0.05], 'dr_iron', (0, 0.15, 0))
    for s, n in ((1, 'e'), (-1, 'w')):
        g.add('dr_rack_post_' + n, 'box', [0.05, 0.8, 0.05], 'dr_iron', (s * 0.78, 0.4, 0))
    # Two bags standing in front of the rack (+z), leaning back 10 degrees onto the top rail.
    h, rt, rb = 0.9, 0.15, 0.12
    lean = D(BAG_LEAN)
    ay, az = math.cos(lean), -math.sin(lean)        # the bag's axis after a -10 degree tilt about X
    base_z = 0.24
    for x, slot, n in ((-0.4, 'dr_bag_a', 'a'), (0.4, 'dr_bag_b', 'b')):
        y = _tilted_base_y(h / 2, rb, BAG_LEAN)
        cz = base_z + (h / 2) * az
        g.add('dr_bag_' + n, 'cylinder', [rt, rb, h, 8], slot, (x, y, cz), rot=(-BAG_LEAN, 0, 0))
        # Three club heads poking out of the mouth, tilted with the bag.
        for k, (dx, dz) in enumerate(((-0.06, 0.03), (0.05, 0.04), (0.0, -0.05))):
            d = h / 2 + 0.06
            g.add('dr_bag_%s_club%d' % (n, k), 'box', [0.05, 0.1, 0.08], 'dr_white',
                  (x + dx, y + d * ay, cz + d * az + dz), rot=(-BAG_LEAN, 0, 0))
    return g


def build_welcome_sign():
    g = Graph('dressing', 'dr_sign_board', 'box', [1.6, 0.6, 0.06], 'dr_board', (0, 1.2, 0))
    for s, n in ((1, 'e'), (-1, 'w')):
        g.add('dr_sign_post_' + n, 'box', [0.1, 1.6, 0.1], 'dr_timber', (s * 0.85, 0.8, 0))
    g.add('dr_sign_cap', 'box', [1.8, 0.06, 0.12], 'dr_timber', (0, 1.63, 0))
    return g


# --- horizon hills (horizon-hills.md) -------------------------------------------------------------
# Each card is one prism: a ridge line in local XY over a flat base, extruded 12 m along z, origin at
# the base centre. The polygon runs base-left, base-right, then the ridge from right to left (CCW).

HILL_DEPTH = 12.0
HILLS = {
    # A long low ridge, 220 x 35, eight ridge vertices.
    'hill_a': (220, [(110, 4), (75, 18), (40, 27), (10, 35), (-25, 30), (-55, 22), (-85, 12), (-110, 3)]),
    # A rounded double hump, 180 x 55.
    'hill_b': (180, [(90, 5), (70, 30), (48, 52), (30, 55), (12, 44), (-5, 38), (-22, 46), (-40, 50),
                     (-58, 40), (-75, 22), (-90, 4)]),
    # A flat-topped mesa, 260 x 28, its top very slightly uneven so it isn't ruled.
    'hill_c': (260, [(130, 3), (110, 10), (92, 24), (80, 28), (15, 27.2), (-60, 28), (-78, 25),
                     (-95, 12), (-115, 6), (-130, 2)]),
}


def build_hill(name):
    width, ridge = HILLS[name]
    pts = [(-width / 2, 0), (width / 2, 0)] + ridge
    return Graph('horizon', name, 'prism', [HILL_DEPTH] + [v for p in pts for v in p], 'hill', (0, 0, 0))


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
        'bench': build_bench(),
        'flagpole': build_flagpole(),
        'planter': build_planter(),
        'bag_rack': build_bag_rack(),
        'welcome_sign': build_welcome_sign(),
    }
    for name in HILLS:
        built[name] = build_hill(name)
    bpy.context.view_layer.update()
    return built


TREES = ('conifer_tall', 'broadleaf_oak', 'gorse_mound', 'pine_windbent', 'willow_weeping', 'reed_clump')

# Each exported set: the graph names in it, which are also the keys build_all() returns.
DRESSING = ('bench', 'flagpole', 'planter', 'bag_rack', 'welcome_sign')

SETS = {
    'trees': TREES,
    'dressing': DRESSING,
    'horizon': tuple(HILLS),
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
