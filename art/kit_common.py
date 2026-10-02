"""Helpers shared by the kit scripts (stage7_kit.py, stage5_kit.py).

Load the exporter first, then this, then a kit; a kit execs this file itself, so a caller only needs
REPO defined:

    exec(open(REPO + '/art/ttt_authoring.py').read(), globals())
    exec(open(REPO + '/art/stage5_kit.py').read(), globals())

Every position and rotation a kit writes is in **Three space** (Y up, +Z forward). `B()` and `R()`
convert to Blender at the one place `make()` is called, so no number in a kit needs mentally rotating.
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


def triangles(root_name):
    import bpy
    root = bpy.data.objects[root_name]
    objs = [root] + list(root.children_recursive)
    return sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)
