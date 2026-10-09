# "Kaide" — a residential tower designed in Blender.
#
#   blender -b --factory-startup -P blender/build_kaide.py -- <project_root> [build|render]
#
#   build:  builds the model and saves blender/out/kaide_tower.blend
#   render: builds, saves, and renders reference images to blender/out/kaide_*.png
#
# Architecture
#   Podium (kaide): travertine giant-order colonnade, double-height glass lobby, slot windows,
#     projecting cornice, planted roof terrace.
#   Tower: three stacked volumes, each shifted against the one below, so every change of volume
#     makes a cantilever above and a terrace below.
#   Sky gardens between the volumes: round columns, glass pavilion, planters and trees,
#     timber soffit with downlights under the cantilever.
#   Facades: deep precast frame (70 cm reveals), bronze joinery with mullions and transoms,
#     recessed loggias in staggered stacks, projecting glass bay windows, corner loggias,
#     interiors with ceilings, lights and curtains seen through the glass.
#   Crown: setback glass penthouse under a timber pergola on a precast frame.
#
# Blender coordinates: x east, y north, z up, metres. Plants: Poly Haven (CC0).

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
ROOT = argv[0]
MODE = argv[1] if len(argv) > 1 else "build"
SRC = os.path.join(ROOT, "blender", "src")
OUT = os.path.join(ROOT, "blender", "out")
os.makedirs(OUT, exist_ok=True)
rng = random.Random(1987)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
root_col = bpy.data.collections.new("Kaide")
scene.collection.children.link(root_col)

# ---------------------------------------------------------------- materials


def _tex(nodes, links, path, colour, scale, mapping_vec=None):
    coord = nodes.new("ShaderNodeTexCoord")
    mp = nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1 / scale, 1 / scale, 1 / scale)
    links.new(coord.outputs["Object"], mp.inputs["Vector"])
    img = nodes.new("ShaderNodeTexImage")
    img.image = bpy.data.images.load(path, check_existing=True)
    img.image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    img.projection = "BOX"
    img.projection_blend = 0.25
    links.new(mp.outputs["Vector"], img.inputs["Vector"])
    return img


def mat(name, colour=(0.8, 0.8, 0.8), rough=0.5, metal=0.0, tex=None, tex_scale=3.0, tint=None, bump=0.0,
        transmission=0.0, ior=1.45, emission=None, coat=0.0, alpha=1.0, sss=0.0, tex_mix=1.0, edge=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    b = nodes["Principled BSDF"]
    normal_in = b.inputs["Normal"]
    if edge:
        # rounded edges in the shader: catches light like a real arris, without bevel geometry
        bev = nodes.new("ShaderNodeBevel")
        bev.inputs["Radius"].default_value = edge
        bev.samples = 6
        links.new(bev.outputs["Normal"], b.inputs["Normal"])
        normal_in = bev.inputs["Normal"]
    b.inputs["Base Color"].default_value = (*colour, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["IOR"].default_value = ior
    if transmission:
        b.inputs["Transmission Weight"].default_value = transmission
    if coat:
        b.inputs["Coat Weight"].default_value = coat
    if sss:
        b.inputs["Subsurface Weight"].default_value = sss
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
    if emission:
        b.inputs["Emission Color"].default_value = (*emission[0], 1)
        b.inputs["Emission Strength"].default_value = emission[1]
    if tex:
        img = _tex(nodes, links, os.path.join(SRC, "tex", tex), True, tex_scale)
        out = img.outputs["Color"]
        if tint:
            mix = nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            links.new(out, mix.inputs["A"])
            mix.inputs["B"].default_value = (*tint, 1)
            out = mix.outputs["Result"]
        if tex_mix < 1.0:
            # blend the photo texture toward a flat colour: variation without blotches
            calm = nodes.new("ShaderNodeMix")
            calm.data_type = "RGBA"
            calm.inputs["Factor"].default_value = tex_mix
            calm.inputs["A"].default_value = (*colour, 1)
            links.new(out, calm.inputs["B"])
            out = calm.outputs["Result"]
        links.new(out, b.inputs["Base Color"])
        if bump:
            bp = nodes.new("ShaderNodeBump")
            bp.inputs["Strength"].default_value = bump
            bp.inputs["Distance"].default_value = 0.02
            links.new(img.outputs["Color"], bp.inputs["Height"])
            links.new(bp.outputs["Normal"], normal_in)
    return m


def wall_coords(nodes, links):
    """2D coordinates on any axis-aligned face: (x or y, z) by the face normal"""
    coord = nodes.new("ShaderNodeTexCoord")
    geo = nodes.new("ShaderNodeNewGeometry")
    sep_p = nodes.new("ShaderNodeSeparateXYZ")
    sep_n = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coord.outputs["Object"], sep_p.inputs["Vector"])
    links.new(geo.outputs["Normal"], sep_n.inputs["Vector"])
    absx = nodes.new("ShaderNodeMath")
    absx.operation = "ABSOLUTE"
    links.new(sep_n.outputs["X"], absx.inputs[0])
    on_x = nodes.new("ShaderNodeMath")
    on_x.operation = "GREATER_THAN"
    on_x.inputs[1].default_value = 0.5
    links.new(absx.outputs["Value"], on_x.inputs[0])
    u = nodes.new("ShaderNodeMix")
    u.data_type = "FLOAT"
    links.new(on_x.outputs["Value"], u.inputs["Factor"])
    links.new(sep_p.outputs["X"], u.inputs["A"])
    links.new(sep_p.outputs["Y"], u.inputs["B"])
    comb = nodes.new("ShaderNodeCombineXYZ")
    links.new(u.outputs["Result"], comb.inputs["X"])
    links.new(sep_p.outputs["Z"], comb.inputs["Y"])
    return comb.outputs["Vector"]


def travertine():
    """honed travertine cladding: 1.2 x 0.6 m panels with fine joints, pores and a soft
    per-panel colour shift, the way real stone varies from slab to slab"""
    m = bpy.data.materials.new("travertine")
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    b = nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.48
    uv = wall_coords(nodes, links)
    brick = nodes.new("ShaderNodeTexBrick")
    brick.offset = 0.5
    brick.inputs["Scale"].default_value = 1.0
    brick.inputs["Brick Width"].default_value = 1.2
    brick.inputs["Row Height"].default_value = 0.6
    brick.inputs["Mortar Size"].default_value = 0.004
    brick.inputs["Mortar Smooth"].default_value = 0.2
    brick.inputs["Bias"].default_value = 0.0
    brick.inputs["Color1"].default_value = (0.80, 0.73, 0.62, 1)
    brick.inputs["Color2"].default_value = (0.74, 0.67, 0.56, 1)
    brick.inputs["Mortar"].default_value = (0.45, 0.4, 0.34, 1)
    links.new(uv, brick.inputs["Vector"])
    pores = nodes.new("ShaderNodeTexNoise")
    pores.inputs["Scale"].default_value = 140.0
    pores.inputs["Detail"].default_value = 4.0
    links.new(uv, pores.inputs["Vector"])
    veins = nodes.new("ShaderNodeTexNoise")
    veins.inputs["Scale"].default_value = 3.0
    veins.inputs["Detail"].default_value = 10.0
    veins.inputs["Distortion"].default_value = 0.4
    links.new(uv, veins.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.45
    ramp.color_ramp.elements[0].color = (0.88, 0.86, 0.82, 1)
    ramp.color_ramp.elements[1].position = 0.62
    ramp.color_ramp.elements[1].color = (1.0, 1.0, 1.0, 1)
    links.new(veins.outputs["Fac"], ramp.inputs["Fac"])
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    links.new(brick.outputs["Color"], mix.inputs["A"])
    links.new(ramp.outputs["Color"], mix.inputs["B"])
    links.new(mix.outputs["Result"], b.inputs["Base Color"])
    # joints sit back, pores pit the surface
    joint = nodes.new("ShaderNodeMath")
    joint.operation = "SUBTRACT"
    joint.inputs[0].default_value = 1.0
    links.new(brick.outputs["Fac"], joint.inputs[1])
    height = nodes.new("ShaderNodeMath")
    height.operation = "MULTIPLY_ADD"
    links.new(pores.outputs["Fac"], height.inputs[0])
    height.inputs[1].default_value = 0.15
    links.new(joint.outputs["Value"], height.inputs[2])
    bev = nodes.new("ShaderNodeBevel")
    bev.inputs["Radius"].default_value = 0.008
    bp = nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = 0.35
    bp.inputs["Distance"].default_value = 0.004
    links.new(height.outputs["Value"], bp.inputs["Height"])
    links.new(bev.outputs["Normal"], bp.inputs["Normal"])
    links.new(bp.outputs["Normal"], b.inputs["Normal"])
    return m


M = {
    "precast": mat("precast", (0.78, 0.75, 0.7), tex="concrete_clean_diff_1k.jpg", tex_scale=2.5, tint=(1.0, 0.97, 0.92), rough=0.7, bump=0.12, tex_mix=0.45, edge=0.012),
    "travertine": travertine(),
    "bronze": mat("bronze", (0.30, 0.20, 0.12), rough=0.3, metal=1.0, edge=0.004),
    "steel": mat("steel", (0.08, 0.085, 0.09), rough=0.4, metal=0.8),
    "glass": mat("glass", (0.86, 0.92, 0.93), rough=0.01, transmission=1.0, ior=1.5),
    "balustrade": mat("balustrade", (0.9, 0.95, 0.95), rough=0.0, transmission=1.0, ior=1.5),
    "timber": mat("timber", tex="oak_veneer_01_diff_1k.jpg", tex_scale=1.4, rough=0.5, tint=(0.82, 0.62, 0.45), edge=0.006),
    "deck": mat("deck", tex="oak_veneer_01_diff_1k.jpg", tex_scale=1.0, rough=0.6, tint=(0.62, 0.48, 0.36)),
    "paving": mat("paving", tex="concrete_floor_clean_diff_1k.jpg", tex_scale=3.0, rough=0.8, tint=(0.95, 0.92, 0.87), bump=0.2),
    "asphalt": mat("asphalt", tex="concrete_floor_clean_diff_1k.jpg", tex_scale=2.0, rough=0.9, tint=(0.22, 0.22, 0.23)),
    "paint": mat("paint", (0.85, 0.85, 0.82), rough=0.6),
    "planter": mat("planter", tex="concrete_clean_diff_1k.jpg", tex_scale=2.0, rough=0.8, tint=(0.45, 0.44, 0.42), edge=0.015),
    "soil": mat("soil", (0.12, 0.08, 0.05), rough=1.0),
    "wall_int": mat("wall_int", (0.62, 0.58, 0.53), rough=0.9),
    "ceiling": mat("ceiling", (0.88, 0.87, 0.85), rough=0.9),
    "floor_int": mat("floor_int", (0.42, 0.32, 0.24), rough=0.5),
    "curtain": mat("curtain", (0.88, 0.85, 0.79), rough=0.9, sss=0.0, transmission=0.35),
    "ceiling_light": mat("ceiling_light", (1, 1, 1), rough=0.5, emission=((1.0, 0.8, 0.58), 0.0)),
    "downlight": mat("downlight", (1, 1, 1), rough=0.5, emission=((1.0, 0.82, 0.62), 0.0)),
}
LIGHT_MATS = ("ceiling_light", "downlight")

# ---------------------------------------------------------------- geometry


class Builder:
    """collects axis-aligned boxes per material; one object per material at the end"""

    def __init__(self):
        self.bms = {}

    def bm(self, m):
        if m not in self.bms:
            self.bms[m] = bmesh.new()
        return self.bms[m]

    def box(self, m, lo, hi):
        x0, y0, z0 = lo
        x1, y1, z1 = hi
        if x1 - x0 < 1e-4 or y1 - y0 < 1e-4 or z1 - z0 < 1e-4:
            return
        bm = self.bm(m)
        v = [bm.verts.new((x, y, z)) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
        for f in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
            bm.faces.new([v[i] for i in f])

    def cylinder(self, m, x, y, z0, z1, r, seg=24):
        bm = self.bm(m)
        geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=z1 - z0)
        for vv in geom["verts"]:
            vv.co.x += x
            vv.co.y += y
            vv.co.z += (z0 + z1) / 2

    def finish(self, collection, bevel=None):
        bevel = bevel or {}
        objs = []
        for m, bm in self.bms.items():
            me = bpy.data.meshes.new(m)
            bm.normal_update()
            bm.to_mesh(me)
            bm.free()
            me.materials.append(M[m])
            ob = bpy.data.objects.new(m, me)
            collection.objects.link(ob)
            if m in bevel:
                mod = ob.modifiers.new("bevel", "BEVEL")
                mod.width = bevel[m]
                mod.segments = 2
                mod.limit_method = "ANGLE"
            objs.append(ob)
        return objs


B = Builder()


def faces_of(x0, x1, y0, y1):
    return [
        {"name": "S", "o": Vector((x0, y0, 0)), "t": Vector((1, 0, 0)), "n": Vector((0, -1, 0)), "L": x1 - x0},
        {"name": "E", "o": Vector((x1, y0, 0)), "t": Vector((0, 1, 0)), "n": Vector((1, 0, 0)), "L": y1 - y0},
        {"name": "N", "o": Vector((x1, y1, 0)), "t": Vector((-1, 0, 0)), "n": Vector((0, 1, 0)), "L": x1 - x0},
        {"name": "W", "o": Vector((x0, y1, 0)), "t": Vector((0, -1, 0)), "n": Vector((-1, 0, 0)), "L": y1 - y0},
    ]


def fbox(face, m, u0, u1, d0, d1, z0, z1):
    """box in a facade's frame: u along the face, d outward from the outline"""
    p0 = face["o"] + face["t"] * u0 + face["n"] * d0
    p1 = face["o"] + face["t"] * u1 + face["n"] * d1
    B.box(m, (min(p0.x, p1.x), min(p0.y, p1.y), z0), (max(p0.x, p1.x), max(p0.y, p1.y), z1))


def fpoint(face, u, d):
    p = face["o"] + face["t"] * u + face["n"] * d
    return p.x, p.y


plant_spots = []  # (x, y, z, kind, scale, rotation)

D = 0.45  # frame projection beyond the outline
GLASS_D = -0.25  # glazing line behind the outline
PIL = 0.36  # pilaster width


def window(face, u0, u1, z0, z1, d, curtain=True):
    """bronze-framed glazing with mullions, transom and sill"""
    w = u1 - u0
    fr = 0.065
    # glass
    fbox(face, "glass", u0, u1, d - 0.012, d + 0.012, z0, z1)
    # perimeter frame
    for (a0, a1, b0, b1) in ((u0, u0 + fr, z0, z1), (u1 - fr, u1, z0, z1), (u0, u1, z0, z0 + fr), (u0, u1, z1 - fr, z1)):
        fbox(face, "bronze", a0, a1, d - 0.05, d + 0.05, b0, b1)
    # mullions
    n = max(1, round(w / 1.45))
    for k in range(1, n):
        u = u0 + w * k / n
        fbox(face, "bronze", u - 0.03, u + 0.03, d - 0.06, d + 0.07, z0, z1)
    # transom with an opening light below
    if z1 - z0 > 2.4:
        zt = z0 + 0.95
        fbox(face, "bronze", u0, u1, d - 0.05, d + 0.06, zt - 0.03, zt + 0.03)
    # sill with drip
    fbox(face, "bronze", u0 - 0.02, u1 + 0.02, d, D + 0.05, z0 - 0.03, z0)
    # curtains just inside, drawn to different widths
    if curtain and rng.random() < 0.38:
        frac = rng.uniform(0.25, 0.9)
        left = rng.random() < 0.5
        a0, a1 = (u0 + 0.08, u0 + 0.08 + (w - 0.16) * frac) if left else (u1 - 0.08 - (w - 0.16) * frac, u1 - 0.08)
        fbox(face, "curtain", a0, a1, d - 0.2, d - 0.17, z0 + 0.05, z1 - 0.1)


def bay(face, kind, u0, u1, z, fh):
    ua, ub = u0 + PIL / 2, u1 - PIL / 2
    if kind == "loggia":
        LD = 1.75
        hb = 0.32
        fbox(face, "precast", u0, u1, -0.3, D, z, z + hb)  # slab edge
        fbox(face, "deck", ua, ub, -LD, -0.3, z, z + 0.3)
        for (a0, a1) in ((ua - 0.02, ua + 0.16), (ub - 0.16, ub + 0.02)):  # side walls
            fbox(face, "precast", a0, a1, -LD, -0.3, z + 0.3, z + fh)
        fbox(face, "timber", ua, ub, -LD, -0.3, z + fh - 0.24, z + fh)  # soffit
        # downlight in the soffit
        uc = (ua + ub) / 2
        fbox(face, "downlight", uc - 0.08, uc + 0.08, -1.05, -0.89, z + fh - 0.245, z + fh - 0.238)
        window(face, ua + 0.16, ub - 0.16, z + 0.3, z + fh - 0.24, -LD)
        # glass balustrade on a bronze shoe, bronze top rail
        fbox(face, "bronze", ua, ub, D - 0.18, D - 0.06, z + hb, z + hb + 0.06)
        fbox(face, "balustrade", ua, ub, D - 0.13, D - 0.11, z + hb + 0.06, z + hb + 1.05)
        fbox(face, "bronze", ua, ub, D - 0.16, D - 0.08, z + hb + 1.05, z + hb + 1.1)
        if rng.random() < 0.3:
            x, y = fpoint(face, rng.uniform(ua + 0.5, ub - 0.5), -0.9)
            plant_spots.append((x, y, z + 0.3, "pot", rng.uniform(1.1, 1.5), rng.uniform(0, 6.28)))
        return
    hb = 0.68
    fbox(face, "precast", u0, u1, -0.3, D, z, z + hb)  # spandrel
    window(face, ua, ub, z + hb, z + fh, GLASS_D)
    if kind == "bay":
        P = 0.95  # projection beyond the frame face
        a0, a1 = ua + 0.12, ub - 0.12
        z0, z1 = z + hb + 0.05, z + fh - 0.2
        fbox(face, "precast", a0 - 0.06, a1 + 0.06, D, D + P + 0.06, z0 - 0.16, z0)  # floor plate
        fbox(face, "bronze", a0 - 0.06, a1 + 0.06, D, D + P + 0.06, z1, z1 + 0.14)  # roof plate
        fbox(face, "glass", a0, a1, D + P - 0.012, D + P + 0.012, z0, z1)
        for a in (a0, a1):
            fbox(face, "glass", a - 0.012, a + 0.012, D, D + P, z0, z1)
            fbox(face, "bronze", a - 0.04, a + 0.04, D + P - 0.04, D + P + 0.04, z0, z1)
        mid = (a0 + a1) / 2
        fbox(face, "bronze", mid - 0.025, mid + 0.025, D + P - 0.03, D + P + 0.03, z0, z1)


def block(rect, z0, floors, fh, scheme, top="parapet"):
    """one tower volume: facades on four sides, interiors behind the glass"""
    x0, x1, y0, y1 = rect
    for face in faces_of(*rect):
        L = face["L"]
        nb = max(3, round(L / 3.3))
        bw = L / nb
        for f in range(floors):
            z = z0 + f * fh
            for b in range(nb):
                bay(face, scheme(face["name"], b, nb, f, floors), b * bw, (b + 1) * bw, z, fh)
        # pilasters, full height, and a corner piece that closes the frame around the edge
        for b in range(nb + 1):
            u = b * bw
            a0, a1 = (u, u + PIL) if b == 0 else ((u - PIL, u) if b == nb else (u - PIL / 2, u + PIL / 2))
            fbox(face, "precast", a0, a1, -0.3, D, z0, z0 + floors * fh)
        fbox(face, "precast", L, L + D, 0, D, z0, z0 + floors * fh)
    # interiors: floor, ceiling with light panels, and the inner wall that stops the eye
    for f in range(floors):
        z = z0 + f * fh
        B.box("floor_int", (x0 + 0.2, y0 + 0.2, z + 0.28), (x1 - 0.2, y1 - 0.2, z + 0.3))
        B.box("ceiling", (x0 + 0.2, y0 + 0.2, z + fh - 0.3), (x1 - 0.2, y1 - 0.2, z + fh - 0.26))
        for face in faces_of(*rect):
            for k in range(1, int(face["L"] / 3.3)):
                if rng.random() < 0.55:
                    x, y = fpoint(face, k * 3.3, -2.2)
                    B.box("ceiling_light", (x - 0.3, y - 0.3, z + fh - 0.305), (x + 0.3, y + 0.3, z + fh - 0.3))
    B.box("wall_int", (x0 + 4.5, y0 + 4.5, z0), (x1 - 4.5, y1 - 4.5, z0 + floors * fh))
    zt = z0 + floors * fh
    if top == "parapet":
        for face in faces_of(*rect):
            fbox(face, "precast", -0.3, face["L"], -0.3, D, zt, zt + 1.1)
            fbox(face, "precast", face["L"], face["L"] + D, 0, D, zt, zt + 1.1)
        B.box("precast", (x0, y0, zt), (x1, y1, zt + 0.3))
    return zt


def soffit(rect, z):
    """timber underside of a cantilevered volume, with downlights"""
    x0, x1, y0, y1 = rect
    B.box("timber", (x0 - D, y0 - D, z - 0.45), (x1 + D, y1 + D, z))
    x = x0 + 1.2
    while x < x1 - 1:
        y = y0 + 1.2
        while y < y1 - 1:
            B.box("downlight", (x - 0.07, y - 0.07, z - 0.455), (x + 0.07, y + 0.07, z - 0.448))
            y += 2.4
        x += 2.4


def terrace_edge(rect, z, glass=True):
    """upstand, glass balustrade and rail around a terrace"""
    for face in faces_of(*rect):
        L = face["L"]
        fbox(face, "precast", -0.4, L + 0.4, -0.2, D, z, z + 0.35)
        if glass:
            fbox(face, "balustrade", -0.3, L + 0.3, D - 0.14, D - 0.12, z + 0.35, z + 1.3)
            fbox(face, "bronze", -0.35, L + 0.35, D - 0.17, D - 0.09, z + 1.3, z + 1.35)


def planters(rect, z, inset=1.2, every=5.5, trees=True):
    """planters along a terrace edge with shrubs, trees at the corners"""
    for face in faces_of(*rect):
        L = face["L"]
        u = 1.5
        while u < L - 2.5:
            fbox(face, "planter", u, u + 2.4, -inset - 1.0, -inset, z, z + 0.85)
            fbox(face, "soil", u + 0.08, u + 2.32, -inset - 0.92, -inset - 0.08, z + 0.85, z + 0.8 + 0.06)
            x, y = fpoint(face, u + 1.2, -inset - 0.5)
            plant_spots.append((x, y, z + 0.85, "shrub", rng.uniform(0.32, 0.42), rng.uniform(0, 6.28)))
            u += every
        if trees:
            x, y = fpoint(face, 2.5, -2.6)
            plant_spots.append((x, y, z + 0.05, "tree", rng.uniform(1.0, 1.25), rng.uniform(0, 6.28)))
            fbox(face, "planter", 1.5, 3.5, -3.6, -1.6, z, z + 0.5)


def sky_garden(lower, upper, z, height):
    """recessed garden storey between two volumes"""
    ix0, ix1 = max(lower[0], upper[0]), min(lower[1], upper[1])
    iy0, iy1 = max(lower[2], upper[2]), min(lower[3], upper[3])
    B.box("paving", (lower[0], lower[2], z), (lower[1], lower[3], z + 0.15))
    terrace_edge(lower, z + 0.15)
    # round columns carry the upper volume
    xs = [ix0 + 0.9, (ix0 + ix1) / 2, ix1 - 0.9]
    ys = [iy0 + 0.9, (iy0 + iy1) / 2, iy1 - 0.9]
    for x in xs:
        for y in ys:
            if x in (xs[0], xs[2]) or y in (ys[0], ys[2]):
                B.cylinder("precast", x, y, z + 0.15, z + height, 0.42)
    # glass pavilion around the core
    px0, px1, py0, py1 = ix0 + 4.2, ix1 - 4.2, iy0 + 4.2, iy1 - 4.2
    for face in faces_of(px0, px1, py0, py1):
        window(face, 0, face["L"], z + 0.15, z + height - 0.45, 0, curtain=False)
    B.box("ceiling", (px0, py0, z + height - 0.6), (px1, py1, z + height - 0.45))
    B.box("floor_int", (px0, py0, z + 0.15), (px1, py1, z + 0.17))
    soffit(upper, z + height)
    planters(lower, z + 0.15)


# ---------------------------------------------------------------- the building

# Podium: 34 x 30 m, two storeys, giant order on the street side
PX0, PX1, PY0, PY1 = -17.0, 17.0, -15.0, 15.0
PH = 9.0


def podium():
    # giant-order colonnade on the south
    n = 8
    for k in range(n + 1):
        x = PX0 + 0.6 + (PX1 - PX0 - 1.2) * k / n
        B.box("travertine", (x - 0.45, PY0, 0), (x + 0.45, PY0 + 0.9, PH))
    B.box("travertine", (PX0, PY0, PH - 0.9), (PX1, PY0 + 3.2, PH))  # colonnade soffit beam
    # double-height lobby glazing set back 3.2 m
    south = faces_of(PX0 + 0.9, PX1 - 0.9, PY0 + 3.2, PY1)[0]
    L = south["L"]
    for k in range(10):
        window(south, L * k / 10 + 0.04, L * (k + 1) / 10 - 0.04, 0.0, PH - 0.95, 0, curtain=False)
        fbox(south, "bronze", L * k / 10 - 0.05, L * k / 10 + 0.05, -0.1, 0.25, 0, PH - 0.9)
    fbox(south, "bronze", 0, L, 0, 0.2, 4.45, 4.55)  # mezzanine line
    # lobby interior: floor, mezzanine edge, warm back wall
    B.box("floor_int", (PX0 + 1, PY0 + 3.2, 0.0), (PX1 - 1, PY1 - 1, 0.03))
    B.box("wall_int", (PX0 + 3, PY1 - 8, 0), (PX1 - 3, PY1 - 1, PH - 0.9))
    B.box("ceiling", (PX0 + 1, PY0 + 3.3, PH - 1.0), (PX1 - 1, PY1 - 1, PH - 0.9))
    for x in range(-14, 15, 4):
        B.box("ceiling_light", (x - 0.5, PY0 + 6, PH - 1.005), (x + 0.5, PY0 + 6.2, PH - 1.0))
    # travertine walls with tall slot windows on the other three sides
    for face in faces_of(PX0, PX1, PY0, PY1)[1:]:
        L = face["L"]
        slots = [u for u in [1.6 + 3.0 * k for k in range(int((L - 2) / 3.0))] if u + 1.0 < L - 1.0]
        last = 0.0
        for u in slots:
            fbox(face, "travertine", last, u, -0.45, 0.0, 0, PH)
            fbox(face, "travertine", u, u + 0.9, -0.45, 0.0, 0, 0.9)
            fbox(face, "travertine", u, u + 0.9, -0.45, 0.0, 8.1, PH)
            window(face, u, u + 0.9, 0.9, 8.1, -0.32, curtain=False)
            last = u + 0.9
        fbox(face, "travertine", last, L, -0.45, 0.0, 0, PH)
    # cornice, coping, roof
    for face in faces_of(PX0, PX1, PY0, PY1):
        fbox(face, "travertine", -0.55, face["L"] + 0.55, -0.6, 0.55, PH, PH + 0.75)
        fbox(face, "bronze", -0.56, face["L"] + 0.56, 0.45, 0.58, PH + 0.6, PH + 0.68)
    B.box("paving", (PX0, PY0, PH + 0.75), (PX1, PY1, PH + 0.85))
    terrace_edge((PX0 + 0.3, PX1 - 0.3, PY0 + 0.3, PY1 - 0.3), PH + 0.85)
    # entrance canopy: a thin bronze blade on two steel posts
    B.box("bronze", (-5.5, PY0 - 6.0, 4.2), (5.5, PY0 + 0.2, 4.45))
    for x in (-4.6, 4.6):
        B.cylinder("steel", x, PY0 - 5.4, 0, 4.2, 0.09, seg=16)
    for x in range(-4, 5, 2):
        B.box("downlight", (x - 0.1, PY0 - 3.2, 4.19), (x + 0.1, PY0 - 3.0, 4.2))
    # steps up to the lobby
    for k in range(3):
        B.box("travertine", (-7, PY0 - 1.2 - k * 0.4, 0), (7, PY0 + 3.2, 0.15 * (3 - k)))


podium()
Z = PH + 0.85

A = (-13.0, 13.0, -10.0, 12.0)
Bv = (-10.0, 16.0, -13.0, 9.0)
C = (-15.0, 8.0, -8.0, 13.0)
FH = 3.4
SG = 4.4


def scheme_a(face, b, nb, f, floors):
    if 0 < b < nb - 1 and (b + f) % 4 == 1:
        return "loggia"
    if face in ("S", "N") and b in (0, nb - 1) and f % 2 == 0:
        return "loggia"
    return "win"


def scheme_b(face, b, nb, f, floors):
    if face in ("E", "W") and b % 2 == 1:
        return "bay"
    if face == "S" and (b % 2 == 0) == (f % 2 == 0) and 0 < b < nb - 1:
        return "loggia"
    if face == "S" and b in (0, nb - 1):
        return "loggia"
    return "win"


def scheme_c(face, b, nb, f, floors):
    if b in (0, nb - 1):
        return "loggia"  # loggias wrap every corner
    if b == nb // 2:
        return "loggia"
    return "win"


planters((PX0 + 0.3, PX1 - 0.3, PY0 + 0.3, PY1 - 0.3), Z, inset=0.8, every=6.0, trees=True)
zA = block(A, Z, 8, FH, scheme_a, top="none")
sky_garden(A, Bv, zA, SG)
zB = block(Bv, zA + SG, 8, FH, scheme_b, top="none")
sky_garden(Bv, C, zB, SG)
zC = block(C, zB + SG, 7, FH, scheme_c, top="none")

# Crown: roof terrace, glass penthouse, timber pergola on a precast frame
B.box("paving", (C[0], C[2], zC), (C[1], C[3], zC + 0.15))
terrace_edge(C, zC + 0.15)
PHR = (C[0] + 3.5, C[1] - 3.5, C[2] + 3.5, C[3] - 3.5)
for face in faces_of(*PHR):
    window(face, 0, face["L"], zC + 0.15, zC + 3.6, 0, curtain=False)
B.box("precast", (PHR[0] - 0.3, PHR[2] - 0.3, zC + 3.6), (PHR[1] + 0.3, PHR[3] + 0.3, zC + 3.95))
B.box("floor_int", (PHR[0], PHR[2], zC + 0.15), (PHR[1], PHR[3], zC + 0.17))
B.box("wall_int", (PHR[0] + 3, PHR[2] + 3, zC + 0.15), (PHR[1] - 3, PHR[3] - 3, zC + 3.6))
PZ = zC + 4.4
for face in faces_of(C[0] + 0.4, C[1] - 0.4, C[2] + 0.4, C[3] - 0.4):
    fbox(face, "precast", -0.3, face["L"] + 0.3, -0.5, 0.0, PZ, PZ + 0.55)
    for u in [0.0] + [face["L"] * k / 4 for k in range(1, 4)]:
        fbox(face, "precast", u - 0.18, u + 0.18, -0.5, -0.14, zC + 0.15, PZ)
y = C[2] + 1.0
while y < C[3] - 1.0:
    B.box("timber", (C[0] + 0.5, y - 0.06, PZ + 0.05), (C[1] - 0.5, y + 0.06, PZ + 0.5))
    y += 0.75
planters(C, zC + 0.15, inset=0.6, every=6.5, trees=False)

# ---------------------------------------------------------------- street

B.box("paving", (-80, -32, -0.2), (80, 70, 0.0))
B.box("paving", (-80, -48, -0.2), (80, -32, 0.02))  # pavement
B.box("asphalt", (-120, -66, -0.2), (120, -48, -0.03))
B.box("paving", (-120, -90, -0.2), (120, -66, 0.02))  # far pavement, where the camera stands
B.box("paving", (-120, -66.3, -0.2), (120, -66.0, 0.1))
B.box("paving", (-80, -48.3, -0.2), (80, -48.0, 0.1))  # kerb
for x in range(-118, 120, 9):
    B.box("paint", (x, -57.1, -0.03), (x + 4.5, -56.9, -0.025))
for x in range(-60, 61, 12):
    plant_spots.append((x, -40.0, 0.02, "tree", rng.uniform(1.6, 2.0), rng.uniform(0, 6.28)))
    B.box("planter", (x - 1.0, -41.0, 0.0), (x + 1.0, -39.0, 0.12))
for y in range(-20, 61, 12):
    plant_spots.append((30.0, y, 0.0, "tree", rng.uniform(1.6, 2.0), rng.uniform(0, 6.28)))
    plant_spots.append((-30.0, y, 0.0, "tree", rng.uniform(1.6, 2.0), rng.uniform(0, 6.28)))
for x in (-14, -8, 8, 14):  # benches
    B.box("timber", (x - 1.0, -26.0, 0.42), (x + 1.0, -25.4, 0.48))
    B.box("steel", (x - 0.9, -25.9, 0.0), (x - 0.8, -25.5, 0.42))
    B.box("steel", (x + 0.8, -25.9, 0.0), (x + 0.9, -25.5, 0.42))

# ground to the horizon under the real city
M["ground"] = mat("ground", (0.34, 0.33, 0.31), tex="concrete_floor_clean_diff_1k.jpg", tex_scale=9.0, rough=0.95, tex_mix=0.5)
B.box("ground", (-2500, -2500, -0.6), (2500, 2500, -0.25))

# edges are rounded in the shaders (Bevel node), never with bevel geometry: overlapping
# boxes made the modifier produce inverted faces that rendered black
objs = B.finish(root_col)

# ---------------------------------------------------------------- plants (Poly Haven, CC0)


def asset_collection(asset):
    col = bpy.data.collections.new(f"asset_{asset}")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, "models", asset, f"{asset}.gltf"))
    for o in [o for o in bpy.data.objects if o not in before]:
        for c in o.users_collection:
            c.objects.unlink(o)
        col.objects.link(o)
    return col


assets = {
    "tree": asset_collection("island_tree_02"),
    "shrub": asset_collection("shrub_02"),
    "pot": asset_collection("potted_plant_02"),
}
plants = bpy.data.collections.new("Plants")
root_col.children.link(plants)
for i, (x, y, z, kind, s, r) in enumerate(plant_spots):
    inst = bpy.data.objects.new(f"{kind}_{i}", None)
    inst.instance_type = "COLLECTION"
    inst.instance_collection = assets[kind]
    inst.location = (x, y, z)
    inst.rotation_euler = (0, 0, r)
    inst.scale = (s, s, s)
    plants.objects.link(inst)
# viewport only: draw the million-face tree as a box so the file stays responsive when opened
for o in assets["tree"].objects:
    o.display_type = "BOUNDS"

# ---------------------------------------------------------------- real surroundings: Ataşehir
# Buildings, roads and parks from OpenStreetMap (© OpenStreetMap contributors, ODbL), built by
# blender/build_city.py. UVs are in metres: walls u = along the footprint, v = height.

import json

CITY_DIR = os.path.join(ROOT, "public", "assets", "city")
KEEP_OUT = (-125.0, 125.0, -98.0, 80.0)  # our plaza and boulevard
NIGHT = []  # Value nodes driven by the shot: 0 day, 1 night
CITY_MATS = []


def in_keep_out(x0, x1, y0, y1, pad=0.0):
    kx0, kx1, ky0, ky1 = KEEP_OUT
    return x1 > kx0 - pad and x0 < kx1 + pad and y1 > ky0 - pad and y0 < ky1 + pad


class N:
    """tiny node-graph helper"""

    def __init__(self, m):
        self.nodes, self.links = m.node_tree.nodes, m.node_tree.links

    def new(self, kind, **inputs):
        n = self.nodes.new(kind)
        for k, v in inputs.items():
            self.set(n.inputs[k], v)
        return n

    def set(self, socket, v):
        if hasattr(v, "is_output") or hasattr(v, "links"):
            self.links.new(v, socket)
        else:
            socket.default_value = v

    def math(self, op, a, b=0.0, c=None):
        n = self.nodes.new("ShaderNodeMath")
        n.operation = op
        self.set(n.inputs[0], a)
        self.set(n.inputs[1], b)
        if c is not None:
            self.set(n.inputs[2], c)
        return n.outputs["Value"]

    def mix(self, fac, a, b, kind="RGBA"):
        n = self.nodes.new("ShaderNodeMix")
        n.data_type = kind
        self.set(n.inputs["Factor"], fac)
        # Mix node sockets by index: 2/3 float A/B, 6/7 colour A/B; outputs 0 float, 2 colour
        if kind == "RGBA":
            self.set(n.inputs[6], a)
            self.set(n.inputs[7], b)
            return n.outputs[2]
        self.set(n.inputs[2], a)
        self.set(n.inputs[3], b)
        return n.outputs[0]

    def between(self, x, lo, hi):
        return self.math("MULTIPLY", self.math("GREATER_THAN", x, lo), self.math("LESS_THAN", x, hi))


def city_material(name, kind):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    g = N(m)
    b = g.nodes["Principled BSDF"]
    uv = g.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    sep = g.new("ShaderNodeSeparateXYZ")
    g.set(sep.inputs["Vector"], uv.outputs["UV"])
    u, v = sep.outputs["X"], sep.outputs["Y"]
    attr = g.new("ShaderNodeVertexColor")
    night = g.new("ShaderNodeValue")
    night.outputs[0].default_value = 0.0
    NIGHT.append(night)
    tex = _tex(g.nodes, g.links, os.path.join(SRC, "tex", "concrete_clean_diff_1k.jpg"), True, 4.0)
    tint = g.mix(1.0, attr.outputs["Color"], tex.outputs["Color"])
    tint.node.blend_type = "MULTIPLY"
    tint = g.mix(0.5, attr.outputs["Color"], tint)
    seed = attr.outputs["Alpha"]
    if kind == "apartment":
        gx, gy = g.math("DIVIDE", u, 3.2), g.math("DIVIDE", v, 3.05)
        fx, fy = g.math("FRACT", gx), g.math("FRACT", gy)
        shop = g.math("LESS_THAN", gy, 1.0)
        res = g.math("MULTIPLY", g.between(fx, 0.27, 0.73), g.between(fy, 0.30, 0.84))
        shp = g.math("MULTIPLY", g.between(fx, 0.08, 0.92), g.between(fy, 0.08, 0.78))
        win = g.mix(shop, res, shp, "FLOAT")
        # a darker slab line and plinth give every block weight
        slab = g.math("LESS_THAN", fy, 0.05)
        wall = g.mix(g.math("MULTIPLY", slab, 0.25), tint, (0.0, 0.0, 0.0, 1))
        # white PVC frames around every opening, a stone sill under the upper-floor windows
        o_res = g.math("MULTIPLY", g.between(fx, 0.235, 0.765), g.between(fy, 0.265, 0.875))
        o_shp = g.math("MULTIPLY", g.between(fx, 0.06, 0.94), g.between(fy, 0.06, 0.80))
        frame = g.math("SUBTRACT", g.mix(shop, o_res, o_shp, "FLOAT"), win)
        sill = g.math("MULTIPLY", g.math("MULTIPLY", g.between(fx, 0.225, 0.775), g.between(fy, 0.245, 0.278)), g.math("SUBTRACT", 1.0, shop))
        wall = g.mix(sill, wall, (0.72, 0.7, 0.66, 1))
        wall = g.mix(frame, wall, (0.9, 0.9, 0.88, 1))
        # some windows have their curtains drawn
        ccell = g.new("ShaderNodeCombineXYZ")
        g.set(ccell.inputs["X"], g.math("FLOOR", gx))
        g.set(ccell.inputs["Y"], g.math("FLOOR", gy))
        g.set(ccell.inputs["Z"], g.math("MULTIPLY_ADD", seed, 61.0, 13.0))
        cn = g.new("ShaderNodeTexWhiteNoise")
        cn.noise_dimensions = "3D"
        g.set(cn.inputs["Vector"], ccell.outputs["Vector"])
        drawn = g.math("GREATER_THAN", cn.outputs["Value"], 0.62)
        # seen through glass, even a pale curtain sits well below the sunlit wall
        glass = g.mix(drawn, (0.03, 0.04, 0.05, 1), (0.16, 0.14, 0.12, 1))
        # the opening reads as a recess: glass sits back, the frame stands proud
        height = g.math("SUBTRACT", g.math("MULTIPLY", frame, 0.3), win)
        bp = g.new("ShaderNodeBump", Strength=0.7, Distance=0.1)
        g.set(bp.inputs["Height"], height)
        g.set(b.inputs["Normal"], bp.outputs["Normal"])
        lit_p = g.mix(shop, 0.64, 0.25, "FLOAT")
    else:  # curtain wall tower
        fy = g.math("FRACT", g.math("DIVIDE", v, 3.8))
        fx = g.math("FRACT", g.math("DIVIDE", u, 1.5))
        spandrel = g.math("LESS_THAN", fy, 0.2)
        mull = g.math("GREATER_THAN", fx, 0.94)
        win = g.math("MULTIPLY", g.math("SUBTRACT", 1.0, spandrel), g.math("SUBTRACT", 1.0, mull))
        gx, gy = g.math("DIVIDE", u, 7.5), g.math("DIVIDE", v, 3.8)
        wall = g.mix(0.4, tint, (0.0, 0.0, 0.0, 1))
        glass = (0.06, 0.08, 0.1, 1)
        lit_p = 0.72  # offices after hours: a scatter of lit bays, not a checkerboard
    base = g.mix(win, wall, glass)
    g.set(b.inputs["Base Color"], base)
    g.set(b.inputs["Roughness"], g.mix(win, 0.85, 0.05, "FLOAT"))
    # lights: one random draw per window cell and building
    cell = g.new("ShaderNodeCombineXYZ")
    g.set(cell.inputs["X"], g.math("FLOOR", gx))
    g.set(cell.inputs["Y"], g.math("FLOOR", gy))
    g.set(cell.inputs["Z"], g.math("MULTIPLY", seed, 97.0))
    noise = g.new("ShaderNodeTexWhiteNoise")
    noise.noise_dimensions = "3D"
    g.set(noise.inputs["Vector"], cell.outputs["Vector"])
    on = g.math("GREATER_THAN", noise.outputs["Value"], lit_p)
    glow = g.math("MULTIPLY", g.math("MULTIPLY", on, win), night.outputs[0])
    warm = g.mix(noise.outputs["Value"], (1.0, 0.62, 0.32, 1), (1.0, 0.85, 0.65, 1))
    g.set(b.inputs["Emission Color"], warm)
    g.set(b.inputs["Emission Strength"], g.math("MULTIPLY", glow, 3.5 if kind == "apartment" else 1.8))
    CITY_MATS.append(m)
    return m


def road_material(uv2):
    m = bpy.data.materials.new("city_road")
    m.use_nodes = True
    g = N(m)
    b = g.nodes["Principled BSDF"]
    uv = g.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    sep = g.new("ShaderNodeSeparateXYZ")
    g.set(sep.inputs["Vector"], uv.outputs["UV"])
    uvb = g.new("ShaderNodeUVMap")
    uvb.uv_map = uv2
    sep2 = g.new("ShaderNodeSeparateXYZ")
    g.set(sep2.inputs["Vector"], uvb.outputs["UV"])
    u, v = sep.outputs["X"], sep.outputs["Y"]
    w, marked = sep2.outputs["X"], sep2.outputs["Y"]
    tex = _tex(g.nodes, g.links, os.path.join(SRC, "tex", "concrete_floor_clean_diff_1k.jpg"), True, 2.0)
    asphalt = g.mix(1.0, tex.outputs["Color"], (0.2, 0.2, 0.21, 1))
    asphalt.node.blend_type = "MULTIPLY"
    av = g.math("ABSOLUTE", v)
    centre = g.math("MULTIPLY", g.math("LESS_THAN", av, 0.09), g.math("LESS_THAN", g.math("FRACT", g.math("DIVIDE", u, 9.0)), 0.55))
    edge = g.math("LESS_THAN", g.math("ABSOLUTE", g.math("SUBTRACT", av, g.math("SUBTRACT", g.math("MULTIPLY", w, 0.5), 0.45))), 0.08)
    inside = g.math("LESS_THAN", av, g.math("MULTIPLY", w, 0.5))
    paint = g.math("MULTIPLY", g.math("MULTIPLY", g.math("MAXIMUM", centre, edge), inside), marked)
    g.set(b.inputs["Base Color"], g.mix(paint, asphalt, (0.7, 0.69, 0.64, 1)))
    g.set(b.inputs["Roughness"], 0.85)
    CITY_MATS.append(m)
    return m


def flat_material(name, colour, rough=0.9, tex="concrete_floor_clean_diff_1k.jpg", scale=6.0, metal=0.0):
    m = mat(name, colour, rough=rough, tex=tex, tex_scale=scale, tex_mix=0.45, metal=metal) if tex else mat(name, colour, rough=rough, metal=metal)
    CITY_MATS.append(m)
    return m


def prune(ob, test):
    """delete loose parts of a mesh whose world bounding box fails the test"""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    mw = ob.matrix_world
    seen = set()
    doomed = []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, island = [f], []
        seen.add(f.index)
        while stack:
            cur = stack.pop()
            island.append(cur)
            for e in cur.edges:
                for nb in e.link_faces:
                    if nb.index not in seen:
                        seen.add(nb.index)
                        stack.append(nb)
        pts = [mw @ v.co for fc in island for v in fc.verts]
        xs, ys, zs = [p.x for p in pts], [p.y for p in pts], [p.z for p in pts]
        if test(min(xs), max(xs), min(ys), max(ys), max(zs)):
            doomed.extend(island)
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(me)
    bm.free()
    return len(doomed)


city_col = bpy.data.collections.new("City (OpenStreetMap)")
root_col.children.link(city_col)
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.join(CITY_DIR, "city.glb"))
city_objs = [o for o in bpy.data.objects if o not in before]
for o in city_objs:
    for c in o.users_collection:
        c.objects.unlink(o)
    city_col.objects.link(o)

roads_ob = next(o for o in city_objs if o.type == "MESH" and o.name.startswith("roads"))
uv2_name = roads_ob.data.uv_layers[1].name if len(roads_ob.data.uv_layers) > 1 else "UVMap"
CM = {
    "facade": city_material("city_facade", "apartment"),
    "facade_glass": city_material("city_curtain", "tower"),
    "roof": flat_material("city_roof", (0.42, 0.41, 0.39), tex="concrete_clean_diff_1k.jpg"),
    "road": road_material(uv2_name),
    "grass": flat_material("city_grass", (0.16, 0.22, 0.08), rough=1.0, scale=4.0),
    "dirt": flat_material("city_dirt", (0.36, 0.29, 0.21), rough=1.0),
    "water": flat_material("city_water", (0.03, 0.06, 0.08), rough=0.05, tex=None),
    "roofkit": flat_material("city_roofkit", (0.66, 0.65, 0.62), rough=0.8, tex=None),
    "tank": flat_material("city_tank", (0.8, 0.8, 0.78), rough=0.35, tex=None, metal=0.6),
    "solar": flat_material("city_solar", (0.03, 0.05, 0.09), rough=0.1, tex=None, metal=0.3),
}
removed = 0
for o in city_objs:
    if o.type != "MESH":
        continue
    for slot in o.material_slots:
        if slot.material:
            key = slot.material.name.split(".")[0]
            slot.material = CM.get(key, CM["facade"])
    # nothing of the city inside our plaza, or between the cameras and the tower
    removed += prune(o, lambda x0, x1, y0, y1, z1: in_keep_out(x0, x1, y0, y1, pad=2.0))
print("CITY pruned faces", removed, flush=True)

# trees from the parks, outside our own plaza
city_trees = json.load(open(os.path.join(CITY_DIR, "trees.json")))
trees_col = bpy.data.collections.new("City trees")
city_col.children.link(trees_col)
for i, (x, zs, s, a) in enumerate(city_trees):
    bx, by = x, -zs
    if in_keep_out(bx, bx, by, by, pad=4.0):
        continue
    inst = bpy.data.objects.new(f"ctree_{i}", None)
    inst.instance_type = "COLLECTION"
    inst.instance_collection = assets["tree"]
    inst.location = (bx, by, 0.0)
    inst.rotation_euler = (0, 0, a)
    k = 1.5 * s
    inst.scale = (k, k, k)
    trees_col.objects.link(inst)

# ---------------------------------------------------------------- cars

CAR_GLASS = mat("car_glass", (0.02, 0.025, 0.03), rough=0.05, metal=0.2, edge=0.02)
TYRE = mat("tyre", (0.02, 0.02, 0.02), rough=0.8)
RIM = mat("rim", (0.6, 0.6, 0.62), rough=0.25, metal=1.0)
HEAD = mat("headlight", (1, 1, 1), rough=0.2, emission=((1.0, 0.92, 0.8), 0.0))
TAIL = mat("taillight", (0.5, 0.02, 0.02), rough=0.3, emission=((1.0, 0.05, 0.03), 0.0))
LAMPS = [HEAD, TAIL]


def car_model(paint_rgb, kind):
    """a parametric car: body, glasshouse, wheels with rims, lamps; built along +x"""
    col = bpy.data.collections.new(f"car_{kind}_{len(bpy.data.collections)}")
    L, W = (4.6, 1.85) if kind == "sedan" else (4.4, 1.9)
    paint = mat(f"paint_{len(bpy.data.materials)}", paint_rgb, rough=0.22, coat=1.0, edge=0.06)
    cb = Builder()

    def bx(m, x0, x1, y0, y1, z0, z1):
        cb.box(m, (x0, y0, z0), (x1, y1, z1))

    roof_h = 1.45 if kind == "sedan" else 1.7
    bx("body", -L / 2, L / 2, -W / 2, W / 2, 0.32, 0.95)
    bx("body", -L / 2 + 0.9, L / 2 - 1.35, -W / 2 + 0.12, W / 2 - 0.12, 0.95, 1.0)
    bx("glass", -L / 2 + 1.05, L / 2 - 1.5, -W / 2 + 0.16, W / 2 - 0.16, 1.0, roof_h - 0.06)
    bx("body", -L / 2 + 1.15, L / 2 - 1.6, -W / 2 + 0.2, W / 2 - 0.2, roof_h - 0.06, roof_h)
    bx("head", L / 2 - 0.02, L / 2 + 0.01, -W / 2 + 0.15, -W / 2 + 0.55, 0.72, 0.84)
    bx("head", L / 2 - 0.02, L / 2 + 0.01, W / 2 - 0.55, W / 2 - 0.15, 0.72, 0.84)
    bx("tail", -L / 2 - 0.01, -L / 2 + 0.02, -W / 2 + 0.1, -W / 2 + 0.5, 0.75, 0.88)
    bx("tail", -L / 2 - 0.01, -L / 2 + 0.02, W / 2 - 0.5, W / 2 - 0.1, 0.75, 0.88)
    for wx in (L / 2 - 0.8, -L / 2 + 0.85):
        for wy in (-W / 2 + 0.12, W / 2 - 0.12):
            geom = bmesh.ops.create_cone(cb.bm("tyre"), cap_ends=True, segments=20, radius1=0.33, radius2=0.33, depth=0.24)
            for vv in geom["verts"]:
                y, z = vv.co.z, vv.co.y  # lay the cylinder on its side, axle along y
                vv.co = (wx + vv.co.x, wy + y, 0.33 + z)
            geom = bmesh.ops.create_cone(cb.bm("rim"), cap_ends=True, segments=16, radius1=0.2, radius2=0.2, depth=0.25)
            for vv in geom["verts"]:
                y, z = vv.co.z, vv.co.y
                vv.co = (wx + vv.co.x, wy + y, 0.33 + z)
    mats = {"body": paint, "glass": CAR_GLASS, "tyre": TYRE, "rim": RIM, "head": HEAD, "tail": TAIL}
    for key, bm in cb.bms.items():
        me = bpy.data.meshes.new(f"car_{key}")
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mats[key])
        col.objects.link(bpy.data.objects.new(f"car_{key}", me))
    return col


PAINTS = [(0.85, 0.85, 0.84), (0.02, 0.02, 0.025), (0.35, 0.36, 0.38), (0.05, 0.09, 0.18), (0.38, 0.03, 0.03),
          (0.62, 0.6, 0.55), (0.12, 0.13, 0.14), (0.9, 0.9, 0.9)]
car_kinds = [car_model(p, "sedan" if i % 3 else "suv") for i, p in enumerate(PAINTS)]
cars_col = bpy.data.collections.new("Cars")
root_col.children.link(cars_col)


def place_car(x, y, heading, i):
    inst = bpy.data.objects.new(f"car_{i}", None)
    inst.instance_type = "COLLECTION"
    inst.instance_collection = car_kinds[i % len(car_kinds)]
    inst.location = (x, y, 0.06)
    inst.rotation_euler = (0, 0, heading)
    cars_col.objects.link(inst)


traffic = json.load(open(os.path.join(CITY_DIR, "traffic.json")))
n_cars = 0
for lane in traffic:
    pts = [(x, -z) for x, z in lane["pts"]]
    off = min(3.2, lane["w"] * 0.22)
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        seg = math.hypot(x1 - x0, y1 - y0)
        if seg < 1:
            continue
        dx, dy = (x1 - x0) / seg, (y1 - y0) / seg
        s = rng.uniform(4, 30)
        while s < seg:
            for side in (1, -1):
                if rng.random() < 0.55:
                    px = x0 + dx * s - dy * off * side
                    py = y0 + dy * s + dx * off * side
                    if not in_keep_out(px, px, py, py, pad=3.0):
                        place_car(px, py, math.atan2(dy, dx) + (0 if side > 0 else math.pi), n_cars)
                        n_cars += 1
            s += rng.uniform(22, 55)
# the boulevard in front of the cameras stays empty: these box-built cars only hold up at a distance
print("CARS", n_cars, flush=True)

# ---------------------------------------------------------------- light, camera, render settings

scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "OPTIX"
prefs.refresh_devices() if hasattr(prefs, "refresh_devices") else prefs.get_devices()
for d in prefs.devices:
    d.use = d.type == "OPTIX"
scene.cycles.device = "GPU"
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 8
scene.cycles.transmission_bounces = 8
scene.cycles.glossy_bounces = 4
for name in ("AgX", "Khronos PBR Neutral"):
    try:
        scene.view_settings.view_transform = name
        break
    except TypeError:
        pass
try:
    scene.view_settings.look = "AgX - Medium High Contrast"
except TypeError:
    pass

world = bpy.data.worlds.new("sky")
world.use_nodes = True
scene.world = world
wn, wl = world.node_tree.nodes, world.node_tree.links
sky = wn.new("ShaderNodeTexSky")
sky_ok = False
for kind in ("NISHITA", "MULTIPLE_SCATTERING", "SINGLE_SCATTERING", "HOSEK_WILKIE"):
    try:
        sky.sky_type = kind
        sky_ok = True
        break
    except TypeError:
        continue
print("SKY", sky.sky_type if sky_ok else "none")
SUN_ELEV = math.radians(11)
SUN_ROT = math.radians(222)  # from the south-west, raking across the street facade
for attr, val in (("sun_elevation", SUN_ELEV), ("sun_rotation", SUN_ROT), ("altitude", 30.0), ("air_density", 1.4),
                  ("dust_density", 2.2), ("ozone_density", 1.0), ("sun_intensity", 0.9)):
    if hasattr(sky, attr):
        setattr(sky, attr, val)
wl.new(sky.outputs["Color"], wn["Background"].inputs["Color"])
wn["Background"].inputs["Strength"].default_value = 0.35


HAZE = []  # haze emitters, dimmed for dusk shots


def add_haze(m, colour=(0.62, 0.68, 0.77), per_metre=0.0016):
    """aerial perspective in the shader: blend toward the horizon colour with camera distance"""
    nodes, links = m.node_tree.nodes, m.node_tree.links
    out = nodes["Material Output"]
    surface = out.inputs["Surface"].links[0].from_socket
    cam_node = nodes.new("ShaderNodeCameraData")
    k = nodes.new("ShaderNodeMath")
    k.operation = "MULTIPLY"
    k.inputs[1].default_value = -per_metre
    links.new(cam_node.outputs["View Distance"], k.inputs[0])
    e = nodes.new("ShaderNodeMath")
    e.operation = "EXPONENT"
    links.new(k.outputs["Value"], e.inputs[0])
    fog = nodes.new("ShaderNodeMath")
    fog.operation = "SUBTRACT"
    fog.inputs[0].default_value = 1.0
    links.new(e.outputs["Value"], fog.inputs[1])
    emit = nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (*colour, 1)
    HAZE.append(emit)
    mix = nodes.new("ShaderNodeMixShader")
    links.new(fog.outputs["Value"], mix.inputs["Fac"])
    links.new(surface, mix.inputs[1])
    links.new(emit.outputs["Emission"], mix.inputs[2])
    links.new(mix.outputs["Shader"], out.inputs["Surface"])


for name in ("ground", "asphalt", "paving"):
    add_haze(M[name], per_metre=0.0007)
for m in CITY_MATS:
    add_haze(m, per_metre=0.0011)

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("Camera", cam_data)
root_col.objects.link(cam)
scene.camera = cam


def shoot(name, pos, target, lens, shift_y, res=(1300, 1850), samples=160, night=False, sun=11):
    """architectural camera: level, with lens shift instead of tilt, so verticals stay vertical"""
    if hasattr(sky, "sun_elevation"):
        sky.sun_elevation = math.radians(sun)
    wn["Background"].inputs["Strength"].default_value = 0.35 if sun > 3 else 0.6
    for e in HAZE:
        e.inputs["Strength"].default_value = 1.0 if sun > 3 else 0.22
    cam.location = pos
    d = Vector(target) - Vector(pos)
    cam.rotation_euler = (math.radians(90), 0, math.atan2(d.y, d.x) - math.radians(90))
    cam_data.lens = lens
    cam_data.shift_y = shift_y
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.cycles.samples = samples
    for m in LIGHT_MATS:
        M[m].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 18.0 if night else 0.0
    for nd in NIGHT:
        nd.outputs[0].default_value = 1.0 if night else 0.0
    for lm in LAMPS:
        lm.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 25.0 if night else 0.0
    scene.render.filepath = os.path.join(OUT, f"kaide_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", name, flush=True)


# the first shot doubles as the camera view when the file is opened
HERO = ((44, -80, 1.7), (0, 0, 1.7), 20, 0.4)
cam.location = HERO[0]
cam.rotation_euler = (math.radians(90), 0, math.atan2(80, -44) - math.radians(90))
cam_data.lens = HERO[2]
cam_data.shift_y = HERO[3]
scene.render.resolution_x, scene.render.resolution_y = 1300, 1850
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "kaide_tower.blend"))
print("SAVED", sum(len(o.data.polygons) for o in objs), "faces,", len(plant_spots), "plants", flush=True)

if MODE == "preview":
    shoot("hero_preview", *HERO, res=(650, 925), samples=48)
    shoot("dusk_preview", *HERO, res=(650, 925), samples=48, night=True, sun=1.5)

if MODE == "render":
    shoot("hero", *HERO, samples=192)
    shoot("cantilever", (42, -46, 28), (2, 0, 42), 35, 0.12, res=(1600, 1100), samples=192)
    shoot("street", (-16, -44, 1.6), (4, 0, 6), 22, 0.2, res=(1600, 1100), samples=192)
    shoot("dusk", *HERO, samples=256, night=True, sun=1.5)
