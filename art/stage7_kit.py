"""Stage 7 kit: builds every collection in art/clubhouse-exterior.blend and exports its graphs.

The .blend file is output; this script is the source, so a reviewer can read the geometry. Run it
over the Blender MCP (or headless) after loading the exporter:

    exec(open(REPO + '/art/ttt_authoring.py').read(), globals())
    exec(open(REPO + '/art/stage7_kit.py').read(), globals())
    build_all(); export_all(REPO)

Every position and rotation below is written in **Three space** (Y up, +Z forward), which is what
the specs in docs/art/specs/ use. `B()` and `R()` convert to Blender at the one place `make()` is
called, so no number here needs mentally rotating. Each asset's graph root is unrotated and every
other node is its direct child, so a child's local position is its graph position minus the root's.
"""
import math

D = math.radians


def B(p):
    """Three position -> Blender location: (x, y, z) -> (x, -z, y)."""
    x, y, z = p
    return (x, -z, y)


def R(rx=0.0, ry=0.0, rz=0.0):
    """Three Euler 'XYZ' in degrees -> the Blender Euler that is the same rotation.

    Three's XYZ is Rx * Ry * Rz and Blender's is Rz @ Ry @ Rx, so for more than one axis this goes
    through the matrix. `_three_euler` in ttt_authoring.py is the exact inverse, so what the
    viewport shows is what the game builds."""
    import mathutils
    m_t = (mathutils.Matrix.Rotation(D(rx), 3, 'X') @ mathutils.Matrix.Rotation(D(ry), 3, 'Y')
           @ mathutils.Matrix.Rotation(D(rz), 3, 'Z'))
    # Three (X_t, Y_t, Z_t) = Blender (X_b, Z_b, -Y_b); invert the basis change used on export.
    idx = (0, 2, 1)
    sgn = (1, -1, 1)
    m_b = mathutils.Matrix([[sgn[i] * sgn[j] * m_t[idx[i]][idx[j]] for j in range(3)] for i in range(3)])
    return tuple(m_b.to_euler('XYZ'))


class Graph:
    """One asset: a root node plus direct children, all positioned in the asset's graph space."""

    def __init__(self, collection, name, kind, params, slot, pos):
        self.c = coll(collection)
        self.origin = pos
        self.root = make(name, kind, params, slot, self.c, loc=B(pos))
        self.names = [name]

    def add(self, name, kind, params, slot, pos, rot=(0, 0, 0)):
        local = (pos[0] - self.origin[0], pos[1] - self.origin[1], pos[2] - self.origin[2])
        make(name, kind, params, slot, self.c, parent=self.root, loc=B(local), rot=R(*rot))
        self.names.append(name)


def hexrgb(h):
    return ((h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255)


def materials():
    for name, colour, rough, metal in [
        # clubhouse kit (docs/art/specs/clubhouse.md, team-barn.md, lot.md)
        ('cb_wall', 0xE9DDB0, 0.85, 0.0), ('cb_roof', 0x7F9A88, 0.7, 0.05),
        ('cb_brick', 0xA8583A, 0.9, 0.0), ('cb_trim', 0xF3EEDC, 0.7, 0.0),
        ('cb_glass', 0x2E3F52, 0.25, 0.1), ('cb_door', 0x6B4A2E, 0.8, 0.0),
        ('team_trim', 0x888888, 0.6, 0.0),
        ('lot_paving', 0x5C5F63, 0.95, 0.0), ('lot_paint', 0xF2F2EA, 0.8, 0.0),
        ('lamp_metal', 0x2F3336, 0.5, 0.6), ('lamp_glow', 0xFFE3A0, 0.4, 0.0),
        # food cart (food-cart.md)
        ('fc_body', 0x3FBF9A, 0.6, 0.05), ('fc_stripe_a', 0xE0336B, 0.7, 0.0),
        ('fc_stripe_b', 0xF6F0E0, 0.7, 0.0), ('fc_timber', 0x8A5A32, 0.8, 0.0),
        ('fc_metal', 0xB8BCC0, 0.4, 0.6), ('fc_tire', 0x1F1F1F, 0.9, 0.0),
        # pickups (pickups.md): per-item colours are merge-time overrides; these are the bucket's
        ('pickup_shell', 0x2E9E4A, 0.6, 0.0), ('pickup_fill', 0xF4F4EE, 0.7, 0.0),
        ('pickup_accent', 0xF2C230, 0.6, 0.0), ('pickup_metal', 0xB8BCC0, 0.4, 0.6),
        # tee sign (tee-sign.md): same names and colours as props.json, declared in its own graph
        ('prop_timber', 0x9A6B40, 0.85, 0.0), ('prop_timber_dark', 0x5E3F24, 0.85, 0.0),
    ]:
        material(name, hexrgb(colour), rough, metal)


# --- clubhouse (clubhouse.md) -------------------------------------------------------------------

EAVE_Y = 4.6
RIDGE_Y = 6.4
ROOF_X = 10.4          # eave half-width with 0.4 overhang over the 20 m block
ROOF_Z0, ROOF_Z1 = -7.4, 4.4
ROOF_ZC = (ROOF_Z0 + ROOF_Z1) / 2      # -1.5, the block's centre line
RUN = (ROOF_Z1 - ROOF_Z0) / 2           # 5.9, so the hips are equal-pitch and the ridge is 9.0 long
RISE = RIDGE_Y - EAVE_Y
SLOPE = math.hypot(RUN, RISE)
PITCH = math.degrees(math.atan2(RISE, RUN))
RIDGE_HALF = ROOF_X - RUN               # 4.5


def build_clubhouse():
    g = Graph('clubhouse', 'cb_plinth', 'box', [24, 1.6, 14], 'cb_brick', (0, -0.2, 0))
    g.add('cb_walls', 'box', [20, 4.0, 11], 'cb_wall', (0, 2.6, -1.5))

    # Clerestory bands, one dark strip per face, proud of the wall.
    g.add('cb_band_f', 'box', [16, 0.5, 0.06], 'cb_glass', (0, 4.1, 4.03))
    g.add('cb_band_b', 'box', [16, 0.5, 0.06], 'cb_glass', (0, 4.1, -7.03))
    g.add('cb_band_e', 'box', [0.06, 0.5, 8], 'cb_glass', (10.03, 4.1, -1.5))
    g.add('cb_band_w', 'box', [0.06, 0.5, 8], 'cb_glass', (-10.03, 4.1, -1.5))

    # Windows: a cream backing with a dark pane standing just proud of it.
    def window(name, x, z, face):
        if face in ('f', 'b'):
            s = 1 if face == 'f' else -1
            g.add(name + '_trim', 'box', [1.8, 2.0, 0.06], 'cb_trim', (x, 2.3, z + s * 0.03))
            g.add(name, 'box', [1.6, 1.8, 0.06], 'cb_glass', (x, 2.3, z + s * 0.05))
        else:
            s = 1 if face == 'e' else -1
            g.add(name + '_trim', 'box', [0.06, 2.0, 1.8], 'cb_trim', (x + s * 0.03, 2.3, z))
            g.add(name, 'box', [0.06, 1.8, 1.6], 'cb_glass', (x + s * 0.05, 2.3, z))

    for i, x in enumerate((-7.2, -3.6, 3.6, 7.2)):
        window('cb_win_f%d' % i, x, 4.0, 'f')
    for i, x in enumerate((-6.0, 0.0, 6.0)):
        window('cb_win_b%d' % i, x, -7.0, 'b')
    for i, z in enumerate((-4.5, 0.5)):
        window('cb_win_e%d' % i, 10.0, z, 'e')
        window('cb_win_w%d' % i, -10.0, z, 'w')
    g.add('cb_door_trim', 'box', [2.0, 2.8, 0.06], 'cb_trim', (0, 1.9 + 0.1, 4.03))
    g.add('cb_door', 'box', [1.8, 2.6, 0.06], 'cb_door', (0, 1.9, 4.05))

    # Main hip roof: two trapezoid slopes and two triangular hips, thin prisms laid on the pitch.
    t = 0.12
    trap = [t, -ROOF_X, 0, ROOF_X, 0, RIDGE_HALF, SLOPE, -RIDGE_HALF, SLOPE]
    g.add('cb_roof_f', 'prism', trap, 'cb_roof', (0, EAVE_Y, ROOF_Z1), rot=(-(90 - PITCH), 0, 0))
    g.add('cb_roof_b', 'prism', trap, 'cb_roof', (0, EAVE_Y, ROOF_Z0), rot=(90 - PITCH, 0, 0))
    # A hip's polygon has its apex along local +X; X then Y lays it on the end slope (clubhouse.md).
    hip = [t, 0, -RUN, 0, RUN, SLOPE, 0]
    g.add('cb_roof_e', 'prism', hip, 'cb_roof', (ROOF_X, EAVE_Y, ROOF_ZC), rot=(90, 180 - PITCH, 0))
    g.add('cb_roof_w', 'prism', hip, 'cb_roof', (-ROOF_X, EAVE_Y, ROOF_ZC), rot=(90, PITCH, 0))
    g.add('cb_soffit', 'box', [2 * ROOF_X, 0.05, ROOF_Z1 - ROOF_Z0], 'cb_trim', (0, EAVE_Y, ROOF_ZC))

    # Verandah: lean-to roofs over the front (3 m) and both ends (2 m), posts on the deck.
    vp = 8.88   # 0.5 m fall over 3.2 m
    g.add('cb_ver_roof_f', 'box', [24.4, 0.1, 3.24], 'cb_roof', (0, 3.35, 5.6), rot=(vp, 0, 0))
    g.add('cb_ver_roof_e', 'box', [2.24, 0.1, 11.2], 'cb_roof', (11.1, 3.35, -1.6), rot=(0, 0, -vp))
    g.add('cb_ver_roof_w', 'box', [2.24, 0.1, 11.2], 'cb_roof', (-11.1, 3.35, -1.6), rot=(0, 0, vp))
    posts = [(x, 6.85) for x in (-11.85, -7.2, -2.4, 2.4, 7.2, 11.85)]
    posts += [(x, z) for x in (-11.85, 11.85) for z in (-6.85, -3.3, 0.3, 3.6)]
    for i, (x, z) in enumerate(posts):
        g.add('cb_post%02d' % i, 'box', [0.22, 2.5, 0.22], 'cb_trim', (x, 1.85, z))

    # Entrance steps, three treads down from the deck, outside the 14 m plinth.
    for i in range(3):
        g.add('cb_step%d' % i, 'box', [3.0, 0.2 * (3 - i), 0.3], 'cb_trim',
              (0, 0.1 * (3 - i), 7.15 + 0.3 * i))

    # Cupola on the ridge centre, chimney rear-right.
    g.add('cb_cupola', 'box', [1.6, 0.8, 1.6], 'cb_trim', (0, 6.6, ROOF_ZC))
    g.add('cb_cupola_roof', 'cone', [1.2, 0.6, 4], 'cb_roof', (0, 7.3, ROOF_ZC), rot=(0, 45, 0))
    g.add('cb_chimney', 'box', [1.0, 2.2, 1.0], 'cb_brick', (6.0, 6.1, -3.0))
    g.add('cb_chimney_cap', 'box', [1.2, 0.15, 1.2], 'cb_brick', (6.0, 7.27, -3.0))
    return g


# --- team barn (team-barn.md) --------------------------------------------------------------------

def build_team_barn():
    g = Graph('team_barn', 'tb_plinth', 'box', [8, 0.3, 24], 'lot_paving', (0, 0.15, 0))
    g.add('tb_wall_back', 'box', [0.3, 3.2, 24], 'cb_wall', (-3.85, 1.9, 0))
    for s, n in ((1, 'n'), (-1, 's')):
        g.add('tb_wall_' + n, 'box', [8, 3.2, 0.3], 'cb_wall', (0, 1.9, s * 11.85))
    for i, z in enumerate((-11.85, -6.0, 0.0, 6.0, 11.85)):
        g.add('tb_post%d' % i, 'box', [0.25, 3.2, 0.25], 'cb_trim', (3.85, 1.9, z))
    # Gable roof at the clubhouse pitch, ridge along z, 0.4 m overhang.
    half = 4.4
    rise = half * math.tan(D(PITCH))
    slope = math.hypot(half, rise)
    eave = 3.5
    g.add('tb_roof_w', 'box', [slope, 0.12, 24.8], 'cb_roof', (-half / 2, eave + rise / 2, 0), rot=(0, 0, PITCH))
    g.add('tb_roof_e', 'box', [slope, 0.12, 24.8], 'cb_roof', (half / 2, eave + rise / 2, 0), rot=(0, 0, -PITCH))
    gable = [0.2, -4.0, 0, 4.0, 0, 0, rise * 4.0 / half]
    for s, n in ((1, 'n'), (-1, 's')):
        g.add('tb_gable_' + n, 'prism', gable, 'cb_wall', (0, eave, s * 11.85))
    g.add('tb_fascia', 'box', [0.1, 0.5, 24.8], 'team_trim', (half, eave - 0.25, 0))
    return g


# --- lot and lamps (lot.md) ---------------------------------------------------------------------

def build_lot():
    g = Graph('lot', 'lot_paving', 'box', [21, 0.04, 6], 'lot_paving', (0, 0, 0))
    for i in range(9):
        g.add('lot_line%d' % i, 'box', [0.12, 0.02, 4.6], 'lot_paint', (-10 + 2.5 * i, 0.03, -0.4))
    return g


def build_lamp():
    g = Graph('lamp_post', 'lamp_base', 'cylinder', [0.18, 0.18, 0.4, 8], 'lamp_metal', (0, 0.2, 0))
    g.add('lamp_pole', 'cylinder', [0.07, 0.07, 5.0, 6], 'lamp_metal', (0, 2.9, 0))
    g.add('lamp_arm', 'box', [0.08, 0.08, 0.6], 'lamp_metal', (0, 5.34, 0.3))
    # The glowing head is its own one-node graph so only it gets an emissive material.
    h = Graph('lamp_head', 'lamp_head', 'box', [0.3, 0.18, 0.5], 'lamp_glow', (0, 5.2, 0.6))
    return g, h


# --- food cart (food-cart.md) -------------------------------------------------------------------

def build_food_cart():
    g = Graph('food_cart', 'fc_chassis', 'box', [2.4, 0.7, 1.3], 'fc_body', (0, 0.65, 0))
    g.add('fc_counter', 'box', [2.6, 0.06, 1.45], 'fc_timber', (0, 1.03, 0))
    g.add('fc_cooler', 'box', [0.9, 0.45, 0.12], 'fc_metal', (0.1, 0.62, 0.68))
    for i, (x, z) in enumerate(((0.8, 0.6), (-0.8, 0.6), (0.8, -0.6), (-0.8, -0.6))):
        g.add('fc_wheel%d' % i, 'cylinder', [0.25, 0.25, 0.15, 6], 'fc_tire', (x, 0.25, z), rot=(90, 0, 0))
    for s, n in ((1, 'e'), (-1, 'w')):
        g.add('fc_bumper_' + n, 'box', [0.1, 0.12, 1.3], 'fc_metal', (s * 1.25, 0.35, 0))
    for i, (x, z) in enumerate(((1.2, 0.62), (-1.2, 0.62), (1.2, -0.62), (-1.2, -0.62))):
        g.add('fc_post%d' % i, 'box', [0.06, 0.8, 0.06], 'fc_timber', (x, 1.46, z))
    # Canopy: seven gable strips alternating pink and cream, extruded along x.
    w = 2.6 / 7
    strip = [w, -0.8, 0, 0.8, 0, 0, 0.24]
    for i in range(7):
        slot = 'fc_stripe_a' if i % 2 == 0 else 'fc_stripe_b'
        g.add('fc_canopy%d' % i, 'prism', strip, slot, (-1.3 + w * (i + 0.5), 1.86, 0), rot=(0, 90, 0))
    # Scalloped valance on each long side: one zig-zag prism, pink.
    pts = [-1.3, 0, 1.3, 0, 1.3, -0.06]
    for k in range(7):
        pts += [1.3 - w * (k + 0.5), -0.16, 1.3 - w * (k + 1), -0.06]
    for s, n in ((1, 'f'), (-1, 'b')):
        g.add('fc_valance_' + n, 'prism', [0.03] + pts, 'fc_stripe_a', (0, 1.86, s * 0.8))
    return g


# --- pickups (pickups.md) -----------------------------------------------------------------------
# Origin at the item's centre (they float and spin); the largest dimension is 0.80 m.

def build_pickups():
    b = Graph('pickups', 'pk_bucket', 'cylinder', [0.3, 0.22, 0.55, 10], 'pickup_shell', (0, -0.125, 0))
    b.add('pk_bucket_handle', 'torus', [0.3, 0.015, 3, 6], 'pickup_metal', (0, 0.1, 0))
    for i in range(4):
        a = D(90 * i + 45)
        b.add('pk_ball%d' % i, 'sphere', [0.09, 6, 3], 'pickup_fill', (0.14 * math.cos(a), 0.2, 0.14 * math.sin(a)))
    b.add('pk_ball4', 'sphere', [0.09, 6, 3], 'pickup_fill', (0, 0.3, 0))

    # Authored standing up (length along y) so no capsule needs a rotation on top of its parent's;
    # the renderer lays it at an angle. Buns either side in z, the sausage proud of them toward -x,
    # mustard zig-zagging down its -x face.
    h = Graph('pickups', 'pk_hotdog', 'capsule', [0.07, 0.62, 1, 6], 'pickup_fill', (-0.05, 0, 0))
    for s, n in ((1, 'f'), (-1, 'b')):
        h.add('pk_bun_' + n, 'capsule', [0.11, 0.5, 1, 6], 'pickup_shell', (0.02, 0, s * 0.08))
    for i, y in enumerate((-0.2, 0.0, 0.2)):
        h.add('pk_mustard%d' % i, 'box', [0.02, 0.14, 0.03], 'pickup_accent', (-0.125, y, 0), rot=(30 if i % 2 else -30, 0, 0))

    d = Graph('pickups', 'pk_drink', 'cylinder', [0.2, 0.15, 0.5, 10], 'pickup_shell', (0, -0.15, 0))
    d.add('pk_lid', 'sphere', [0.2, 8, 4], 'pickup_fill', (0, 0.1, 0))
    d.add('pk_straw', 'cylinder', [0.02, 0.02, 0.22, 5], 'pickup_accent', (0.04, 0.24, 0))
    d.add('pk_straw_tip', 'cylinder', [0.02, 0.02, 0.12, 5], 'pickup_accent', (0.08, 0.37, 0), rot=(0, 0, -40))
    return b, h, d


# --- tee sign (tee-sign.md) ---------------------------------------------------------------------

def build_tee_sign():
    g = Graph('tee_sign', 'ts_post_l', 'box', [0.08, 1.05, 0.08], 'prop_timber', (-0.2, 0.525, -0.1))
    g.add('ts_post_r', 'box', [0.08, 1.05, 0.08], 'prop_timber', (0.2, 0.525, -0.1))
    # Board: 0.55 x 0.40, tilted 15 degrees back, top edge at 1.25 m.
    g.add('ts_board', 'box', [0.55, 0.40, 0.04], 'prop_timber_dark', (0, 1.057, -0.03), rot=(-15, 0, 0))
    g.add('ts_cap', 'box', [0.62, 0.05, 0.08], 'prop_timber_dark', (0, 1.27, -0.08))
    return g


def build_all():
    import bpy
    materials()
    built = {
        'clubhouse': build_clubhouse(),
        'team_barn': build_team_barn(),
        'lot_stripes': build_lot(),
        'food_cart': build_food_cart(),
        'tee_sign': build_tee_sign(),
    }
    built['lamp_post'], built['lamp_head'] = build_lamp()
    built['bucket'], built['hot_dog'], built['drink'] = build_pickups()
    bpy.context.view_layer.update()
    return built


SETS = {
    'clubhouse': {'clubhouse': 'cb_plinth', 'team_barn': 'tb_plinth', 'lot_stripes': 'lot_paving',
                  'lamp_post': 'lamp_base', 'lamp_head': 'lamp_head', 'food_cart': 'fc_chassis'},
    'pickups': {'bucket': 'pk_bucket', 'hot_dog': 'pk_hotdog', 'drink': 'pk_drink'},
}


def triangles(root_name):
    import bpy
    root = bpy.data.objects[root_name]
    objs = [root] + list(root.children_recursive)
    return sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)


def export_all(repo):
    graphs = repo + '/src/entities/graphs/'
    export_set(SETS['clubhouse'], graphs + 'clubhouse.json', 'clubhouse')
    export_set(SETS['pickups'], graphs + 'pickups.json', 'pickups')
    export('ts_post_l', graphs + 'tee_sign.json', graph_name='tee_sign')
