"""The cart's rider: builds collection `rider` and exports src/entities/graphs/driver.json.

The rider used to live only in the frozen art/clubhouse-and-cart.blend, and four of its limbs were
exported with the old rotation swap, so the game's pose and that file's disagreed by up to 0.30 rad
(art/README.md, Rotations). This script is now the source, and the pose it holds is **the game's**:
every number below is the shipped driver.json's, in Three space. Re-exporting reproduces that file
byte for byte, so the rider does not move.

    exec(open(REPO + '/art/ttt_authoring.py').read(), globals())
    exec(open(REPO + '/art/stage7_kit.py').read(), globals())   # B(), hexrgb()
    exec(open(REPO + '/art/rider_kit.py').read(), globals())
    build_rider(); export_rider(REPO)

Positions are local to the pelvis, which is the root; rotations are Three Euler 'XYZ' in radians.
"""
import math

SLOTS = {
    'cap': (0xCC4B37, 0.8, 0.0),
    'shirt': (0x4A6FA5, 0.8, 0.0),
    'skin': (0xD9A06B, 0.85, 0.0),
    'trousers': (0xD8D2C4, 0.85, 0.0),
}

ROOT = ('driver_pelvis', 'box', (0.28, 0.2, 0.26), 'trousers', (0.29, 1.15, -0.34))

# name, kind, params (Three order), slot, position (local to the pelvis), rotation (Three XYZ, rad)
PARTS = [
    ('driver_cap', 'cylinder', (0.125, 0.125, 0.07, 10.0), 'cap', (0.0, 0.695, -0.01), (0.0, 0.0, 0.0)),
    ('driver_cap_brim', 'box', (0.22, 0.022, 0.14), 'cap', (0.0, 0.665, 0.12), (0.15, 0.0, 0.0)),
    ('driver_elbowL', 'sphere', (0.0645, 10.0, 8.0), 'skin', (0.1766, 0.1961, 0.277), (0.0, 0.0, 0.0)),
    ('driver_elbowR', 'sphere', (0.0645, 10.0, 8.0), 'skin', (-0.1706, 0.1963, 0.2759), (0.0, 0.0, 0.0)),
    ('driver_footL', 'box', (0.11, 0.06, 0.24), 'trousers', (0.11, -0.59, 0.6), (0.0, 0.0, 0.0)),
    ('driver_footR', 'box', (0.11, 0.06, 0.24), 'trousers', (-0.11, -0.59, 0.6), (0.0, 0.0, 0.0)),
    ('driver_handL', 'sphere', (0.0598, 10.0, 8.0), 'skin', (0.1608, 0.1035, 0.5875), (0.0, 0.0, 0.0)),
    ('driver_handR', 'sphere', (0.0598, 10.0, 8.0), 'skin', (-0.0837, 0.1034, 0.588), (0.0, 0.0, 0.0)),
    ('driver_head', 'sphere', (0.115, 12.0, 10.0), 'skin', (0.0, 0.6, -0.0), (0.0, 0.0, 0.0)),
    ('driver_hipL', 'sphere', (0.0935, 10.0, 8.0), 'trousers', (0.0938, -0.0488, 0.1028), (0.0, 0.0, 0.0)),
    ('driver_hipR', 'sphere', (0.0935, 10.0, 8.0), 'trousers', (-0.0938, -0.0488, 0.1028), (0.0, 0.0, 0.0)),
    ('driver_kneeL', 'sphere', (0.085, 10.0, 8.0), 'trousers', (0.1081, -0.1559, 0.4253), (0.0, 0.0, 0.0)),
    ('driver_kneeR', 'sphere', (0.085, 10.0, 8.0), 'trousers', (-0.1081, -0.1559, 0.4253), (0.0, 0.0, 0.0)),
    ('driver_lowerArmL', 'capsule', (0.052, 0.229, 4.0, 8.0), 'skin', (0.17, 0.145, 0.44), (1.8445, -0.0624, 0.0)),
    ('driver_lowerArmR', 'capsule', (0.052, 0.2431, 4.0, 8.0), 'skin', (-0.13, 0.145, 0.44), (1.8331, 0.3029, -0.0)),
    ('driver_lowerLegL', 'capsule', (0.072, 0.2836, 4.0, 8.0), 'trousers', (0.11, -0.34, 0.5), (2.9534, 0.0, 0.0)),
    ('driver_lowerLegR', 'capsule', (0.072, 0.2836, 4.0, 8.0), 'trousers', (-0.11, -0.34, 0.5), (2.9534, 0.0, 0.0)),
    ('driver_neck', 'cylinder', (0.058, 0.062, 0.1, 8.0), 'skin', (0.0, 0.47, -0.015), (0.0, 0.0, 0.0)),
    ('driver_shoulderL', 'sphere', (0.0732, 10.0, 8.0), 'shirt', (0.1637, 0.3038, 0.0361), (0.0, 0.0, 0.0)),
    ('driver_shoulderR', 'sphere', (0.0732, 10.0, 8.0), 'shirt', (-0.1637, 0.3038, 0.0361), (0.0, 0.0, 0.0)),
    ('driver_torso', 'box', (0.32, 0.38, 0.24), 'shirt', (0.0, 0.29, -0.04), (-0.1, 0.0, -0.0)),
    ('driver_upperArmL', 'capsule', (0.062, 0.2077, 4.0, 8.0), 'shirt', (0.17, 0.26, 0.13), (2.0066, 0.0666, 0.0)),
    ('driver_upperArmR', 'capsule', (0.062, 0.2077, 4.0, 8.0), 'shirt', (-0.17, 0.26, 0.13), (2.0066, -0.0666, -0.0)),
    ('driver_upperLegL', 'capsule', (0.085, 0.2817, 4.0, 8.0), 'trousers', (0.1, -0.08, 0.24), (1.7941, 0.0454, -0.0)),
    ('driver_upperLegR', 'capsule', (0.085, 0.2817, 4.0, 8.0), 'trousers', (-0.1, -0.08, 0.24), (1.7941, -0.0454, 0.0)),
]


def R_rad(rx, ry, rz):
    """`R()` from stage7_kit.py, in radians: Three Euler 'XYZ' -> the Blender Euler for it."""
    return R(math.degrees(rx), math.degrees(ry), math.degrees(rz))


def build_rider():
    for slot, (colour, roughness, metalness) in SLOTS.items():
        material(slot, hexrgb(colour), roughness, metalness)
    c = coll('rider')
    name, kind, params, slot, pos = ROOT
    root = make(name, kind, params, slot, c, loc=B(pos))
    for name, kind, params, slot, pos, rot in PARTS:
        make(name, kind, params, slot, c, parent=root, loc=B(pos), rot=R_rad(*rot))
    return root


def export_rider(repo):
    export(ROOT[0], repo + '/src/entities/graphs/driver.json', graph_name='driver')
