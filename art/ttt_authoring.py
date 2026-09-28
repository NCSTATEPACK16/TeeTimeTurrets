"""TeeTimeTurrets Blender authoring helpers: make(), material(), node(), export(), export_set().

This is the repo copy. It was extracted from the Text datablock inside the frozen
art/clubhouse-and-cart.blend on 28 Sep 2026. Load it in any Blender session with:

    exec(open(REPO + '/art/ttt_authoring.py').read(), globals())

See docs/art/specs/00-pipeline.md and art/README.md.
"""
import bpy, math, bmesh

def coll(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c

def _link(obj, target):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    target.objects.link(obj)

def _apply_scale(obj):
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.select_set(False)

def _bsdf(mat):
    """The Principled BSDF by type, never by name: node names are localised on a non-English UI."""
    if mat.node_tree is None:
        return None
    return next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)

def material(name, color, roughness, metalness):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    if not m.use_nodes:   # always on in Blender 5.x, where the flag is deprecated
        m.use_nodes = True
    b = _bsdf(m)
    b.inputs['Base Color'].default_value = (color[0], color[1], color[2], 1.0)
    b.inputs['Roughness'].default_value = roughness
    b.inputs['Metallic'].default_value = metalness
    # Solid-shading viewport reads diffuse_color, not the BSDF. The exporter reads the BSDF,
    # so this only matters for the [REVIEW] screenshots -- which is exactly when it matters.
    m.diffuse_color = (color[0], color[1], color[2], 1.0)
    return m

def make(name, kind, params, slot, collection, parent=None, loc=(0,0,0), rot=(0,0,0), scale=(1,1,1)):
    """Build a Blender object whose mesh matches the THREE constructor in
    ASSET_PIPELINE.md 4.2. `params` is THREE order; Blender dims swap Y and Z."""
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)

    if kind == 'box':
        w, h, d = params[0], params[1], params[2]
        bpy.ops.mesh.primitive_cube_add(size=1)
        obj = bpy.context.active_object
        obj.dimensions = (w, d, h)
        _apply_scale(obj)
    elif kind == 'cylinder':
        rt, rb, h, seg = params[0], params[1], params[2], int(params[3])
        bpy.ops.mesh.primitive_cone_add(radius1=rb, radius2=rt, depth=h, vertices=seg)
        obj = bpy.context.active_object
    elif kind == 'cone':
        r, h, seg = params[0], params[1], int(params[2])
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=0.0, depth=h, vertices=seg)
        obj = bpy.context.active_object
    elif kind == 'sphere':
        r, wseg, hseg = params[0], int(params[1]), int(params[2])
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=wseg, ring_count=hseg)
        obj = bpy.context.active_object
    elif kind == 'torus':
        bpy.ops.mesh.primitive_torus_add(major_radius=params[0], minor_radius=params[1],
                                         major_segments=int(params[3]), minor_segments=int(params[2]))
        obj = bpy.context.active_object
    elif kind == 'capsule':
        r, length, capseg, radseg = params[0], params[1], int(params[2]), int(params[3])
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r, depth=length, vertices=radseg)
        obj = bpy.context.active_object
        me = obj.data
        bm = bmesh.new(); bm.from_mesh(me)
        for sign in (1, -1):
            cap = bmesh.new()
            bmesh.ops.create_uvsphere(cap, u_segments=radseg, v_segments=max(capseg * 2, 4), radius=r)
            bmesh.ops.translate(cap, verts=cap.verts, vec=(0, 0, sign * length / 2))
            tmp = bpy.data.meshes.new('cap'); cap.to_mesh(tmp); cap.free()
            bm.from_mesh(tmp); bpy.data.meshes.remove(tmp)
        bm.to_mesh(me); bm.free()
    elif kind == 'prism':
        # [depth, x0, y0, x1, y1, ...]: a polygon in Three local XY, extruded along Three +Z and
        # centred on z. Three (x, y, z) is Blender (x, -z, y), so the cap at Three z = +-d/2 sits
        # at Blender y = -+d/2. It matches ExtrudeGeometry in src/entities/primitiveGraph.ts.
        depth = float(params[0])
        pts = [(float(params[i]), float(params[i + 1])) for i in range(1, len(params) - 1, 2)]
        if depth <= 0 or len(pts) < 3 or (len(params) - 1) % 2:
            raise ValueError(name + ': prism needs [depth > 0, x0, y0, ...] with >= 3 points')
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        back = [bm.verts.new((x, depth / 2, y)) for x, y in pts]    # Three z = -d/2
        front = [bm.verts.new((x, -depth / 2, y)) for x, y in pts]  # Three z = +d/2
        bm.faces.new(back)
        bm.faces.new(list(reversed(front)))
        n = len(pts)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((back[i], back[j], front[j], front[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me); bm.free()
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
    else:
        raise ValueError('unknown kind ' + str(kind))

    obj.name = name
    obj.data.name = name
    _link(obj, collection)

    mat = bpy.data.materials.get(slot)
    if mat is None:
        raise ValueError('no material named ' + slot)
    obj.data.materials.clear()
    obj.data.materials.append(mat)

    obj['ttt_kind'] = kind
    obj['ttt_params'] = [float(p) for p in params]
    obj['ttt_slot'] = slot

    if parent is not None:
        obj.parent = bpy.data.objects[parent] if isinstance(parent, str) else parent
    obj.location = loc
    obj.rotation_euler = rot
    obj.scale = scale
    return obj

KINDS = {'box', 'cylinder', 'cone', 'sphere', 'capsule', 'torus', 'prism'}

def node(obj):
    kind = obj.get('ttt_kind')
    if kind not in KINDS:
        raise ValueError(obj.name + ': ttt_kind missing or invalid (got ' + repr(kind) + ')')
    params = obj.get('ttt_params')
    if params is None:
        raise ValueError(obj.name + ': ttt_params missing')
    loc, rot, scale = obj.matrix_local.decompose()
    euler = rot.to_euler('XYZ')
    return {
        'name': obj.name,
        'kind': kind,
        'params': [round(float(p), 4) for p in params],
        # Blender is Z-up, Three is Y-up: (x, y, z)_blender -> (x, z, -y)_three.
        'position': [round(loc.x, 4), round(loc.z, 4), round(-loc.y, 4)],
        'rotation': [round(euler.x, 4), round(euler.z, 4), round(-euler.y, 4)],
        'scale': [round(scale.x, 4), round(scale.z, 4), round(scale.y, 4)],
        'slot': obj.get('ttt_slot', 'default'),
        'children': [node(c) for c in sorted(obj.children, key=lambda o: o.name)] or None,
    }

def export(root_name, out_path, graph_name=None):
    """ASSET_PIPELINE.md 4.3, with one correction: `slots` carries only the slots the
    walked tree actually uses. The published version emits every material in the file,
    which for a .blend holding two assets writes the other asset's slots into this
    asset's graph -- and cartGraph.test.ts asserts an exact slot list."""
    bpy.context.view_layer.update()   # matrix_local is stale until the depsgraph updates
    root = bpy.data.objects[root_name]
    graph_root = node(root)

    used = set()
    def walk(n):
        used.add(n['slot'])
        for c in (n['children'] or []):
            walk(c)
    walk(graph_root)

    slots = {}
    for mat in bpy.data.materials:
        if mat.name not in used:
            continue
        bsdf = _bsdf(mat)
        if bsdf is None:
            continue
        c = bsdf.inputs['Base Color'].default_value
        slots[mat.name] = {
            'color': (int(round(c[0] * 255)) << 16) | (int(round(c[1] * 255)) << 8) | int(round(c[2] * 255)),
            'roughness': round(bsdf.inputs['Roughness'].default_value, 3),
            'metalness': round(bsdf.inputs['Metallic'].default_value, 3),
        }
    missing = used - set(slots)
    if missing:
        raise ValueError('slots used but not declarable as materials: ' + ', '.join(sorted(missing)))

    import json
    graph = {'name': graph_name or root_name, 'version': 1, 'units': 'm', 'slots': slots, 'root': graph_root}
    with open(out_path, 'w') as f:
        json.dump(graph, f, indent=2)
        f.write('\n')
    return graph


def export_set(roots, out_path, set_name):
    """A *set* of independent graphs in one file, for the course props.

    `export()` above writes one asset with one root, which is what a cart is. The props are seven
    unrelated objects that happen to share four material slots and one authoring session, and
    forcing them under a common root would mean either a fake container primitive in the shipped
    graph or six props inheriting a seventh's transform. So this emits the same section 4.1 shape
    with `root` replaced by `props`: name -> that prop's root node. `src/entities/propGraphs.ts`
    slices one PrimitiveGraph back out per name.

    `slots` is the union across every prop walked, by the same rule export() uses: only what the
    trees actually reference, so the cart's eight and the rider's four stay out of this file.

    `roots` is {prop name in the game: Blender root object name}.
    """
    bpy.context.view_layer.update()
    # `roots` maps the name a prop is known by in the game to the Blender object that roots it.
    props = {key: node(bpy.data.objects[obj_name]) for key, obj_name in roots.items()}

    used = set()
    def walk(n):
        used.add(n['slot'])
        for c in (n['children'] or []):
            walk(c)
    for n in props.values():
        walk(n)

    slots = {}
    for mat in bpy.data.materials:
        if mat.name not in used:
            continue
        bsdf = _bsdf(mat)
        if bsdf is None:
            continue
        c = bsdf.inputs['Base Color'].default_value
        slots[mat.name] = {
            'color': (int(round(c[0] * 255)) << 16) | (int(round(c[1] * 255)) << 8) | int(round(c[2] * 255)),
            'roughness': round(bsdf.inputs['Roughness'].default_value, 3),
            'metalness': round(bsdf.inputs['Metallic'].default_value, 3),
        }
    missing = used - set(slots)
    if missing:
        raise ValueError('slots used but not declarable as materials: ' + ', '.join(sorted(missing)))

    import json
    out = {'name': set_name, 'version': 1, 'units': 'm', 'slots': slots, 'props': props}
    with open(out_path, 'w') as f:
        json.dump(out, f, indent=2)
        f.write('\n')
    return out
