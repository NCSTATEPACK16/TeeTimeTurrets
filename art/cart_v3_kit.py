"""Cart v3 (docs/art/specs/cart-v3.md): the soft-bevelled body on a slate frame.

Run inside Blender with art/cart-v3.blend open, after loading the authoring helpers:

    REPO = '/path/to/TeeTimeTurrets'
    exec(open(REPO + '/art/ttt_authoring.py').read(), globals())
    exec(open(REPO + '/art/cart_v3_kit.py').read(), globals())
    build_cart_v3()
    export('chassis_pan', REPO + '/src/entities/graphs/cart.json', graph_name='cart')

It edits the v2 cart in place. Nodes keep their names, parents and children, so the turret
chain, the wheels' rims and everything the sim owns ride through untouched. Coordinates below
are Blender's, local to each node's parent: Three (x, y, z) is Blender (x, -z, y), so the
cart's front is -Y here.
"""
import bpy


def _hex(rgb):
    return ((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255


def remake(name, kind, params, slot, loc=None, rot=None):
    """Swap a node's shape in place: new mesh, kind, params and slot, same object.

    make() deletes and recreates an object, which would orphan its children (chassis_pan carries
    the whole cart). This builds the new shape on a scratch object with make(), so the preview
    mesh is exactly the one make() would author, then moves it onto the existing node."""
    obj = bpy.data.objects[name]
    scratch = make(name + '__scratch', kind, params, slot, obj.users_collection[0])
    old = obj.data
    obj.data = scratch.data
    obj.modifiers.clear()
    for m in scratch.modifiers:
        copy = obj.modifiers.new(m.name, m.type)
        if m.type == 'BEVEL':
            copy.width, copy.segments, copy.limit_method = m.width, m.segments, m.limit_method
    obj['ttt_kind'] = kind
    obj['ttt_params'] = [float(p) for p in params]
    obj['ttt_slot'] = slot
    if loc is not None:
        obj.location = loc
    if rot is not None:
        obj.rotation_euler = rot
    bpy.data.objects.remove(scratch, do_unlink=True)
    if old.users == 0:
        bpy.data.meshes.remove(old)
    obj.data.name = name
    return obj


def build_cart_v3():
    # Slot changes. `roof` becomes the slate `frame`, which no paint touches; seats go tan.
    roof = bpy.data.materials.get('roof')
    if roof is not None:
        roof.name = 'frame'
    material('frame', _hex(0x5E6C7C), 0.6, 0.1)
    material('seats', _hex(0xD9B98A), 0.75, 0.02)
    for obj in bpy.data.objects:
        if obj.get('ttt_slot') == 'roof':
            obj['ttt_slot'] = 'frame'

    # The steps between the old boxes were the bulk: the nose and the four arches go.
    for name in ('nose', 'arch_fl', 'arch_fr', 'arch_rl', 'arch_rr'):
        gone = bpy.data.objects.get(name)
        if gone is not None:
            bpy.data.objects.remove(gone, do_unlink=True)

    # Slate floor and bumpers. chassis_pan keeps its size: the rider's feet stand on its top.
    remake('chassis_pan', 'rbox', [1.26, 0.26, 2.2, 0.06], 'frame')
    remake('bumper_front', 'rbox', [1.26, 0.17, 0.14, 0.06], 'frame')
    remake('bumper_rear', 'rbox', [1.26, 0.17, 0.14, 0.06], 'frame')

    # Three white volumes, 1.10 wide so the tyres (inner faces at x = +-0.56) sit outboard of them.
    # Hood absorbs the nose: Three z 0.26 to 1.16, y 0.02 to 0.44.
    remake('hood', 'rbox', [1.10, 0.42, 0.90, 0.10], 'chassis', loc=(0.0, -0.71, 0.23))
    # The seat pedestal only. Its front stays behind z = 0 (driverGraph.test.ts, the footwell).
    remake('body_tub', 'rbox', [1.10, 0.36, 0.86, 0.08], 'chassis')
    # Over the rear wheels, carrying the bag; its top level with the tub's.
    remake('rear_deck', 'rbox', [1.10, 0.41, 0.58, 0.07], 'chassis', loc=(0.0, 0.92, 0.305))
    remake('dash', 'rbox', [1.10, 0.26, 0.18, 0.05], 'chassis')

    # Seats, same sizes, rounded.
    remake('seat_base', 'rbox', [1.14, 0.16, 0.54, 0.06], 'seats')
    remake('seat_back_l', 'rbox', [0.52, 0.48, 0.14, 0.05], 'seats')
    remake('seat_back_r', 'rbox', [0.52, 0.48, 0.14, 0.05], 'seats')

    # Canopy over the seats only. The front edge stays at Three z = 1.20 (the swing clearance);
    # the rear edge comes in from -1.08 to -0.72, which uncovers the rear deck and the bag.
    remake('canopy', 'rbox', [1.48, 0.09, 1.92, 0.04], 'canopy', loc=(0.0, -0.24, 1.605))
    for name in ('post_rl', 'post_rr'):
        post = bpy.data.objects[name]
        post.location.y = 0.66

    # Wheels: 0.60 m tyres, centre down 0.04 so the bottom stays on the ground.
    for tag in ('fl', 'fr', 'rl', 'rr'):
        wheel = bpy.data.objects['wheel_' + tag]
        remake('wheel_' + tag, 'cylinder', [0.30, 0.30, 0.24, 16], 'tires')
        wheel.location.z = -0.10
        remake('rim_' + tag, 'cylinder', [0.18, 0.18, 0.255, 12], 'rims')

    # Turret housing: shorter and rounded; a collar where the shaft enters replaces the nose wedge.
    remake('housing_pitch', 'rbox', [0.36, 0.30, 0.66, 0.06], 'turret_housing')
    remake('turret_mantlet', 'cylinder', [0.075, 0.075, 0.14, 12], 'turret_housing',
           loc=(0.0, -0.40, 0.0), rot=(1.5708, 0.0, 0.0))

    bpy.context.view_layer.update()


def refine_cart_v3():
    """Second pass, from the first viewport review beside cart-v3-hero-01.jpg (panel A)."""
    import math

    # The turret base is slate on every sheet; red was only ever the housing.
    for name in ('turret_pivot', 'turret_pedestal'):
        obj = bpy.data.objects[name]
        obj['ttt_slot'] = 'frame'
        obj.data.materials.clear()
        obj.data.materials.append(bpy.data.materials['frame'])

    # Yoke cheeks: half-discs 0.40 across hid the housing from a three-quarter view. A 0.13 m
    # radius centred on the pin keeps the yoke and lets the red housing read above it.
    r, bottom = 0.13, -0.17
    pts = [-r, bottom, r, bottom]
    for i in range(7):
        a = math.pi * i / 6
        pts += [r * math.cos(a), r * math.sin(a)]
    for name in ('turret_cheek_l', 'turret_cheek_r'):
        remake(name, 'prism', [0.05] + [round(p, 4) for p in pts], 'frame')

    # The wheel and column read as part of the dark controls, not the tan seats.
    for name in ('steer_wheel', 'steer_column'):
        obj = bpy.data.objects[name]
        obj['ttt_slot'] = 'tires'
        obj.data.materials.clear()
        obj.data.materials.append(bpy.data.materials['tires'])

    # Headlights: the two mid-sized features every sheet draws on the nose.
    for side, x in (('l', 0.38), ('r', -0.38)):
        name = 'headlight_' + side
        old = bpy.data.objects.get(name)
        if old is not None:
            bpy.data.objects.remove(old, do_unlink=True)
        make(name, 'rbox', [0.16, 0.09, 0.04, 0.015], 'rims', bpy.data.objects['hood'].users_collection[0],
             parent='chassis_pan', loc=(x, -1.165, 0.30))

    bpy.context.view_layer.update()
