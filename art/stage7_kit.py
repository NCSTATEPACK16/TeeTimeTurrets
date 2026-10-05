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

# B(), R(), Graph, hexrgb() and triangles() are shared with stage5_kit.py.
exec(open(REPO + '/art/kit_common.py').read(), globals())


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
RIDGE_Y = 7.35         # v3: 25 degree pitch (RUN * tan 25 = 2.75); was 6.4, 17 degrees
ROOF_X = 10.4          # eave half-width with 0.4 overhang over the 20 m block
ROOF_Z0, ROOF_Z1 = -7.4, 4.4
ROOF_ZC = (ROOF_Z0 + ROOF_Z1) / 2      # -1.5, the block's centre line
RUN = (ROOF_Z1 - ROOF_Z0) / 2           # 5.9, so the hips are equal-pitch and the ridge is 9.0 long
RISE = RIDGE_Y - EAVE_Y
SLOPE = math.hypot(RUN, RISE)
PITCH = math.degrees(math.atan2(RISE, RUN))
RIDGE_HALF = ROOF_X - RUN               # 4.5
CHIMNEY_Y = 7.05       # v3: was 6.1; rides up with the ridge (+0.95) so it still stands 0.8 proud of it


def build_clubhouse():
    g = Graph('clubhouse', 'cb_plinth', 'rbox', [24, 1.6, 14, 0.10], 'cb_brick', (0, -0.2, 0))
    g.add('cb_walls', 'rbox', [20, 4.0, 11, 0.08], 'cb_wall', (0, 2.6, -1.5))

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
            g.add(name + '_mull', 'box', [0.07, 1.8, 0.04], 'cb_trim', (x, 2.3, z + s * 0.09))
        else:
            s = 1 if face == 'e' else -1
            g.add(name + '_trim', 'box', [0.06, 2.0, 1.8], 'cb_trim', (x + s * 0.03, 2.3, z))
            g.add(name, 'box', [0.06, 1.8, 1.6], 'cb_glass', (x + s * 0.05, 2.3, z))
            g.add(name + '_mull', 'box', [0.04, 1.8, 0.07], 'cb_trim', (x + s * 0.09, 2.3, z))

    for i, x in enumerate((-7.2, -3.6, 3.6, 7.2)):
        window('cb_win_f%d' % i, x, 4.0, 'f')
    for i, x in enumerate((-6.0, 0.0, 6.0)):
        window('cb_win_b%d' % i, x, -7.0, 'b')
    for i, z in enumerate((-4.5, 0.5)):
        window('cb_win_e%d' % i, 10.0, z, 'e')
        window('cb_win_w%d' % i, -10.0, z, 'w')
    g.add('cb_door_trim', 'box', [2.0, 2.8, 0.06], 'cb_trim', (0, 1.9 + 0.1, 4.03))
    g.add('cb_door', 'box', [1.8, 2.6, 0.06], 'cb_door', (0, 1.9, 4.05))
    # Detail pass (4 Oct 2026): a double door with a pane in each leaf, as in the hero sheet.
    g.add('cb_door_split', 'box', [0.06, 2.6, 0.04], 'cb_trim', (0, 1.9, 4.09))
    for s, n in ((1, 'r'), (-1, 'l')):
        g.add('cb_door_pane_' + n, 'box', [0.55, 0.9, 0.03], 'cb_glass', (s * 0.45, 2.55, 4.09))

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
    # Fascia boards (v3): 0.08 x 0.24 rounded boards flush inside every exposed eave edge, hanging
    # just below the roof plane. A prism can't be rounded; these carry the soft highlight line.
    fy = EAVE_Y - 0.08
    for n, z in (('f', ROOF_Z1 - 0.04), ('b', ROOF_Z0 + 0.04)):
        g.add('cb_fascia_' + n, 'rbox', [2 * ROOF_X, 0.24, 0.08, 0.03], 'cb_trim', (0, fy, z))
    for n, s in (('e', 1), ('w', -1)):
        g.add('cb_fascia_' + n, 'rbox', [0.08, 0.24, ROOF_Z1 - ROOF_Z0 - 0.16, 0.03], 'cb_trim',
              (s * (ROOF_X - 0.04), fy, ROOF_ZC))

    # Verandah: lean-to roofs over the front (3 m) and both ends (2 m), posts on the deck.
    vp = 8.88   # 0.5 m fall over 3.2 m
    g.add('cb_ver_roof_f', 'box', [24.4, 0.1, 3.24], 'cb_roof', (0, 3.35, 5.6), rot=(vp, 0, 0))
    g.add('cb_ver_roof_e', 'box', [2.24, 0.1, 11.2], 'cb_roof', (11.1, 3.35, -1.6), rot=(0, 0, -vp))
    g.add('cb_ver_roof_w', 'box', [2.24, 0.1, 11.2], 'cb_roof', (-11.1, 3.35, -1.6), rot=(0, 0, vp))
    # Their fascia boards, flush inside each lean-to's outer edge so the footprint doesn't grow.
    fall = math.sin(D(vp))
    g.add('cb_fascia_vf', 'rbox', [24.4, 0.24, 0.08, 0.03], 'cb_trim',
          (0, 3.35 - 1.62 * fall - 0.08, 5.6 + 1.62 * math.cos(D(vp)) - 0.04))
    for n, s in (('ve', 1), ('vw', -1)):
        g.add('cb_fascia_' + n, 'rbox', [0.08, 0.24, 11.2, 0.03], 'cb_trim',
              (s * (11.1 + 1.12 * math.cos(D(vp)) - 0.04), 3.35 - 1.12 * fall - 0.08, -1.6))
    posts = [(x, 6.85) for x in (-11.85, -7.2, -2.4, 2.4, 7.2, 11.85)]
    posts += [(x, z) for x in (-11.85, 11.85) for z in (-6.85, -3.3, 0.3, 3.6)]
    for i, (x, z) in enumerate(posts):
        g.add('cb_post%02d' % i, 'rbox', [0.22, 2.5, 0.22, 0.03], 'cb_trim', (x, 1.85, z))
        # A plain base block on the deck (0.6): a bevel here costs 96 tris x 14 for nothing visible.
        g.add('cb_post%02d_base' % i, 'box', [0.32, 0.30, 0.32], 'cb_trim', (x, 0.75, z))

    # Entrance steps, three treads down from the deck, outside the 14 m plinth.
    for i in range(3):
        g.add('cb_step%d' % i, 'rbox', [3.0, 0.2 * (3 - i), 0.3, 0.04], 'cb_trim',
              (0, 0.1 * (3 - i), 7.15 + 0.3 * i))

    # Detail pass (4 Oct 2026): rounded caps along the ridge and the four hips draw the roof's lines,
    # the one detail of the 3x A/B test that read at 40 m and on Med. A hip cap runs from 0.4 up
    # its hip to the ridge end, so its lower end stays inside the eave corner and the footprint.
    # Its long axis is local z, laid on the hip with X then Y (exact through R()).
    g.add('cb_ridge_cap', 'rbox', [2 * RIDGE_HALF + 0.3, 0.18, 0.3, 0.06], 'cb_roof', (0, RIDGE_Y + 0.06, ROOF_ZC))
    hip_len = math.sqrt(2 * RUN * RUN + RISE * RISE)
    beta = math.degrees(math.asin(RUN / hip_len))
    alpha = math.degrees(math.asin(RISE / hip_len / math.cos(D(beta))))
    for n, sx, sz in (('fe', 1, 1), ('fw', -1, 1), ('be', 1, -1), ('bw', -1, -1)):
        k = 0.2 / hip_len   # shift the centre 0.2 up the hip
        cx = sx * (ROOF_X + RIDGE_HALF) / 2 - sx * RUN * k
        cy = (EAVE_Y + RIDGE_Y) / 2 + 0.08 + RISE * k
        cz = ((ROOF_Z1 if sz > 0 else ROOF_Z0) + ROOF_ZC) / 2 - sz * RUN * k
        g.add('cb_hip_cap_' + n, 'rbox', [0.3, 0.18, hip_len - 0.4, 0.06], 'cb_roof', (cx, cy, cz),
              rot=(sz * alpha, sx * sz * beta, 0))
    # Louvres on each cupola face: three slats over a dark backing.
    for n, sgn, along_z in (('f', 1, True), ('b', -1, True), ('e', 1, False), ('w', -1, False)):
        for j, dy in enumerate((0.25, 0.37, 0.49)):
            if along_z:
                g.add('cb_louvre_%s%d' % (n, j), 'box', [1.2, 0.05, 0.08], 'cb_trim', (0, RIDGE_Y + dy, ROOF_ZC + sgn * 0.82))
            else:
                g.add('cb_louvre_%s%d' % (n, j), 'box', [0.08, 0.05, 1.2], 'cb_trim', (sgn * 0.82, RIDGE_Y + dy, ROOF_ZC))
        if along_z:
            g.add('cb_louvre_back_' + n, 'box', [1.2, 0.4, 0.02], 'cb_glass', (0, RIDGE_Y + 0.37, ROOF_ZC + sgn * 0.79))
        else:
            g.add('cb_louvre_back_' + n, 'box', [0.02, 0.4, 1.2], 'cb_glass', (sgn * 0.79, RIDGE_Y + 0.37, ROOF_ZC))

    # Cupola on the ridge centre, riding with it; chimney rear-right. The cupola's base reaches
    # 0.4 below the ridge so the steeper slopes don't open a gap under its front and back faces.
    g.add('cb_cupola', 'rbox', [1.6, 1.0, 1.6, 0.06], 'cb_trim', (0, RIDGE_Y + 0.1, ROOF_ZC))
    g.add('cb_cupola_roof', 'cone', [1.2, 0.6, 4], 'cb_roof', (0, RIDGE_Y + 0.9, ROOF_ZC), rot=(0, 45, 0))
    g.add('cb_chimney', 'rbox', [1.0, 2.2, 1.0, 0.05], 'cb_brick', (6.0, CHIMNEY_Y, -3.0))
    g.add('cb_chimney_cap', 'rbox', [1.2, 0.15, 1.2, 0.05], 'cb_brick', (6.0, CHIMNEY_Y + 1.17, -3.0))
    return g


# --- team barn (team-barn.md) --------------------------------------------------------------------

def build_team_barn():
    g = Graph('team_barn', 'tb_plinth', 'box', [8, 0.3, 24], 'lot_paving', (0, 0.15, 0))
    eave = 3.5
    g.add('tb_wall_back', 'box', [0.3, 3.2, 24], 'cb_wall', (-3.85, 1.9, 0))
    for s, n in ((1, 'n'), (-1, 's')):
        g.add('tb_wall_' + n, 'box', [8, 3.2, 0.3], 'cb_wall', (0, 1.9, s * 11.85))
    # Brick knee wall (v3), 0.9 m high and 0.04 proud of the inside of the back and end walls.
    g.add('tb_brick_back', 'box', [0.04, 0.9, 23.4], 'cb_brick', (-3.68, 0.75, 0))
    for s, n in ((1, 'n'), (-1, 's')):
        g.add('tb_brick_' + n, 'box', [7.38, 0.9, 0.04], 'cb_brick', (0.03, 0.75, s * 11.68))
    posts = (-11.85, -6.0, 0.0, 6.0, 11.85)
    for i, z in enumerate(posts):
        g.add('tb_post%d' % i, 'rbox', [0.25, 3.2, 0.25, 0.03], 'cb_trim', (3.85, 1.9, z))
        g.add('tb_post%d_base' % i, 'box', [0.34, 0.30, 0.34], 'cb_trim', (3.85, 0.45, z))
    # Knee braces (v3): a thin 45 degree wedge in the posts' plane, two per inner post and one on
    # the inner side of each end post. It leaves the post 0.8 below the fascia's bottom edge (the
    # eave line as seen from the yard) and runs up behind the fascia to the eave, tapering to a
    # hidden tip; measured from the eave itself it would hide behind the fascia entirely. A
    # triangle, not a four-point strip: the strip's 4 extra tris x 8 put the barn over 900. The
    # polygon's +x runs along +z under ry -90 (along -z under +90).
    brace = [0.12, 0, 0, 1.3, 1.3, 0, 0.25]
    k = 0
    for z in posts:
        for s in (1, -1):
            if abs(z + s * 0.125) > 11.85:
                continue
            g.add('tb_brace%d' % k, 'prism', brace, 'cb_door', (3.85, eave - 1.3, z + s * 0.125), rot=(0, -90 * s, 0))
            k += 1
    # Gable roof at the clubhouse pitch, ridge along z, 0.4 m overhang.
    half = 4.4
    rise = half * math.tan(D(PITCH))
    slope = math.hypot(half, rise)
    g.add('tb_roof_w', 'box', [slope, 0.12, 24.8], 'cb_roof', (-half / 2, eave + rise / 2, 0), rot=(0, 0, PITCH))
    g.add('tb_roof_e', 'box', [slope, 0.12, 24.8], 'cb_roof', (half / 2, eave + rise / 2, 0), rot=(0, 0, -PITCH))
    gable = [0.2, -4.0, 0, 4.0, 0, 0, rise * 4.0 / half]
    for s, n in ((1, 'n'), (-1, 's')):
        g.add('tb_gable_' + n, 'prism', gable, 'cb_wall', (0, eave, s * 11.85))
    g.add('tb_fascia', 'rbox', [0.1, 0.5, 24.8, 0.04], 'team_trim', (half, eave - 0.25, 0))
    # Detail pass (4 Oct 2026): a rounded ridge cap, as on the clubhouse.
    g.add('tb_ridge_cap', 'rbox', [0.3, 0.18, 24.8, 0.06], 'cb_roof', (0, eave + rise + 0.06, 0))
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


def export_all(repo):
    graphs = repo + '/src/entities/graphs/'
    export_set(SETS['clubhouse'], graphs + 'clubhouse.json', 'clubhouse')
    export_set(SETS['pickups'], graphs + 'pickups.json', 'pickups')
    export('ts_post_l', graphs + 'tee_sign.json', graph_name='tee_sign')
