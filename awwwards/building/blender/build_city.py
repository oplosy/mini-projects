# Builds the Ataşehir city from OpenStreetMap data (scripts/build-city.mjs) and exports it for the site.
#
#   blender -b --factory-startup -P blender/build_city.py -- <city.json> <out_dir>
#
# Writes <out_dir>/city.glb (Draco), trees.json and traffic.json.
# Coordinates: the JSON is in the site's frame (x east, z south, metres); Blender is Z-up,
# so a site point (x, y, z) becomes (x, -z, y) here and the glTF exporter turns it back.
# UVs are in metres: walls u = distance along the footprint, v = height; roads u = length, v = across.

import json
import math
import os
import random
import sys

import bmesh
import bpy

argv = sys.argv[sys.argv.index("--") + 1 :]
src, out_dir = argv[0], argv[1]
os.makedirs(out_dir, exist_ok=True)
data = json.load(open(src, encoding="utf-8"))
rng = random.Random(1987)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def material(name, vcol=False):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    if vcol and not m.use_nodes:
        # the facade tint and seed live in the colour attribute; using it in the material
        # is what makes the glTF exporter write it out
        m.use_nodes = True
        nt = m.node_tree
        attr = nt.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Col"
        nt.links.new(attr.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    return m


def to_b(x, z):
    return (x, -z)


def signed_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return a / 2


# Istanbul apartment facades: off-white, cream, stone, pale salmon, sand, light grey-blue
RESIDENTIAL_TINTS = [
    (0.86, 0.82, 0.74), (0.88, 0.8, 0.66), (0.78, 0.76, 0.72), (0.86, 0.68, 0.6),
    (0.84, 0.72, 0.5), (0.66, 0.72, 0.76), (0.92, 0.9, 0.86), (0.68, 0.66, 0.62),
    (0.8, 0.6, 0.52), (0.74, 0.78, 0.7), (0.9, 0.84, 0.72), (0.6, 0.6, 0.6),
]
GLASS_TINTS =[(0.42, 0.50, 0.56), (0.36, 0.44, 0.48), (0.50, 0.55, 0.58)]


def building_mesh(name, items):
    """items: list of dicts with pts (site frame), h, glass."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    col = bm.loops.layers.color.new("Col")
    for it in items:
        pts = [to_b(x, z) for x, z in it["pts"]]
        if signed_area(pts) < 0:
            pts.reverse()
        h = it["h"]
        tint = it["tint"]
        seed = it["seed"]
        rgba = (tint[0], tint[1], tint[2], seed)
        # walls run 0.9 m past the roof: the parapet every flat Istanbul roof has
        wall_top = h + 0.9
        bottom = [bm.verts.new((x, y, 0.0)) for x, y in pts]
        top = [bm.verts.new((x, y, wall_top)) for x, y in pts]
        roof_ring = [bm.verts.new((x, y, h)) for x, y in pts]
        run = 0.0
        n = len(pts)
        for i in range(n):
            j = (i + 1) % n
            seg = math.dist(pts[i], pts[j])
            try:
                f = bm.faces.new((bottom[i], bottom[j], top[j], top[i]))
            except ValueError:
                continue
            f.material_index = 1 if it["glass"] else 0
            for loop, (u, v) in zip(f.loops, ((run, 0), (run + seg, 0), (run + seg, wall_top), (run, wall_top))):
                loop[uv].uv = (u, v)
                loop[col] = rgba
            run += seg
        try:
            roof = bm.faces.new(roof_ring)
        except ValueError:
            continue
        roof.material_index = 2
        for loop in roof.loops:
            loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
            loop[col] = rgba
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(me)
    bm.free()
    # bmesh does not mark the layer as the mesh's colour; without this glTF gets plain white
    me.color_attributes.active_color = me.color_attributes["Col"]
    me.color_attributes.render_color_index = me.color_attributes.find("Col")
    for m in ("facade", "facade_glass", "roof"):
        me.materials.append(material(m, vcol=True))
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


# ---------- Buildings ----------
regular = []
districts = {}
for b in data["buildings"]:
    glass = b["kind"] == "office" or b["h"] > 60
    r = rng.random()
    tint = rng.choice(GLASS_TINTS if glass else RESIDENTIAL_TINTS)
    item = {"pts": b["pts"], "h": b["h"], "glass": glass, "tint": tint, "seed": r}
    if "district" in b:
        districts[b["district"]] = item
    else:
        regular.append(item)

building_mesh("city_buildings", regular)
for i, item in districts.items():
    ob = building_mesh(f"district_{i}", [item])
    # the site reads the look-at target from these custom properties
    xs = [p[0] for p in item["pts"]]
    zs = [p[1] for p in item["pts"]]
    ob["center_x"] = sum(xs) / len(xs)
    ob["center_z"] = sum(zs) / len(zs)
    ob["height"] = item["h"]

# ---------- Rooftops: lift overruns, water tanks, solar water heaters ----------
def point_in(px, py, poly):
    inside_ = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi + 1e-9) + xi:
            inside_ = not inside_
        j = i
    return inside_


roof_me = bpy.data.meshes.new("rooftops")
rbm = bmesh.new()


def kit_box(cx, cy, z0, w, d, h, mat, tilt=0.0):
    geom = bmesh.ops.create_cube(rbm, size=1.0)
    for v in geom["verts"]:
        x, y, z = v.co.x * w, v.co.y * d, (v.co.z + 0.5) * h
        # solar panels lean toward the south (Blender -Y is site +z, south)
        z += tilt * v.co.y * d
        v.co = (cx + x, cy + y, z0 + z)
    for f in {f for v in geom["verts"] for f in v.link_faces}:
        f.material_index = mat


def kit_tank(cx, cy, z0):
    geom = bmesh.ops.create_cone(rbm, cap_ends=True, segments=10, radius1=0.6, radius2=0.6, depth=1.4)
    for v in geom["verts"]:
        v.co = (cx + v.co.x, cy + v.co.y, z0 + 0.7 + v.co.z)
    for f in {f for v in geom["verts"] for f in v.link_faces}:
        f.material_index = 2


for it in regular:
    pts = [to_b(x, z) for x, z in it["pts"]]
    if it["glass"] or it["h"] < 7 or abs(signed_area(pts)) < 70:
        continue
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
    z0 = it["h"]
    placed = 0
    for attempt in range(14):
        if placed >= 3:
            break
        px = cx + rng.uniform(-0.35, 0.35) * (max(xs) - min(xs))
        py = cy + rng.uniform(-0.35, 0.35) * (max(ys) - min(ys))
        # keep everything at least 1.5 m inside the parapet
        if not all(point_in(px + dx, py + dy, pts) for dx, dy in ((1.6, 1.6), (-1.6, 1.6), (1.6, -1.6), (-1.6, -1.6))):
            continue
        kind = (placed + int(it["seed"] * 10)) % 3
        if kind == 0:
            kit_box(px, py, z0, 2.6, 2.4, 2.6, 0)  # stair / lift overrun
        elif kind == 1:
            kit_tank(px - 0.7, py, z0)
            kit_tank(px + 0.7, py, z0)
        else:
            kit_box(px, py, z0 + 0.5, 2.0, 1.2, 0.06, 1, tilt=0.55)  # solar water heater
            kit_tank(px, py + 0.9, z0)
        placed += 1

rbm.to_mesh(roof_me)
rbm.free()
for m in ("roofkit", "solar", "tank"):
    roof_me.materials.append(material(m))
scene.collection.objects.link(bpy.data.objects.new("rooftops", roof_me))
# Şantiye plot: the site places its own working frame and crane here
spot = bpy.data.objects.new("construction_spot", None)
spot.location = (data["construction"][0], -data["construction"][1], 0)
scene.collection.objects.link(spot)

# ---------- Roads ----------
ROAD_LIFT = {
    "motorway": 0.12, "trunk": 0.11, "primary": 0.10, "secondary": 0.09, "tertiary": 0.08,
    "motorway_link": 0.075, "trunk_link": 0.075, "primary_link": 0.07, "secondary_link": 0.07,
    "tertiary_link": 0.065, "residential": 0.06, "unclassified": 0.06, "living_street": 0.055,
    "service": 0.05, "pedestrian": 0.045,
}
me = bpy.data.meshes.new("roads")
bm = bmesh.new()
uv = bm.loops.layers.uv.new("UVMap")
uv2 = bm.loops.layers.uv.new("UVMap.001")  # x: road width, y: 1 for marked roads
MARKED = {"motorway", "trunk", "primary", "secondary", "tertiary"}
for road in data["roads"]:
    pts = [to_b(x, z) for x, z in road["pts"]]
    w = road["w"]
    z0 = ROAD_LIFT.get(road["cls"], 0.05)
    marked = 1.0 if road["cls"] in MARKED else 0.0
    run = 0.0
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        seg = math.hypot(x1 - x0, y1 - y0)
        if seg < 0.05:
            continue
        nx, ny = -(y1 - y0) / seg * w / 2, (x1 - x0) / seg * w / 2
        quad = [
            bm.verts.new((x0 - nx, y0 - ny, z0)), bm.verts.new((x1 - nx, y1 - ny, z0)),
            bm.verts.new((x1 + nx, y1 + ny, z0)), bm.verts.new((x0 + nx, y0 + ny, z0)),
        ]
        f = bm.faces.new(quad)
        for loop, (u, v) in zip(f.loops, ((run, -w / 2), (run + seg, -w / 2), (run + seg, w / 2), (run, w / 2))):
            loop[uv].uv = (u, v)
            loop[uv2].uv = (w, marked)
        run += seg
        # round joint so bends have no gaps; v outside the road keeps paint off it
        if i < len(pts) - 2:
            ring = [bm.verts.new((x1 + math.cos(a) * w / 2, y1 + math.sin(a) * w / 2, z0 - 0.002)) for a in
                    (k * math.tau / 10 for k in range(10))]
            f = bm.faces.new(ring)
            for loop in f.loops:
                loop[uv].uv = (run, w)
                loop[uv2].uv = (w, marked)
bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
bm.to_mesh(me)
bm.free()
me.materials.append(material("road"))
scene.collection.objects.link(bpy.data.objects.new("roads", me))


# ---------- Ground cover ----------
def flat_mesh(name, polys, z, mat):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    for poly in polys:
        pts = [to_b(x, zz) for x, zz in poly]
        if len(pts) < 3 or abs(signed_area(pts)) < 4:
            continue
        if signed_area(pts) < 0:
            pts.reverse()
        try:
            f = bm.faces.new([bm.verts.new((x, y, z)) for x, y in pts])
        except ValueError:
            continue
        for loop in f.loops:
            loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material(mat))
    scene.collection.objects.link(bpy.data.objects.new(name, me))


flat_mesh("green", [g["pts"] for g in data["green"] if g["kind"] == "green"], 0.03, "grass")
flat_mesh("water", [g["pts"] for g in data["green"] if g["kind"] == "water"], 0.025, "water")
flat_mesh("plots", [g["pts"] for g in data["green"] if g["kind"] == "construction"], 0.02, "dirt")

# ---------- Trees (positions only; the site instances them) ----------
def inside(px, pz, poly):
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, zi = poly[i]
        xj, zj = poly[j]
        if (zi > pz) != (zj > pz) and px < (xj - xi) * (pz - zi) / (zj - zi + 1e-9) + xi:
            c = not c
        j = i
    return c


trees = []
for g in data["green"]:
    if g["kind"] != "green":
        continue
    poly = g["pts"]
    a = abs(signed_area(poly))
    xs = [p[0] for p in poly]
    zs = [p[1] for p in poly]
    want = min(120, int(a / 140))
    tries = 0
    while want > 0 and tries < want * 8:
        tries += 1
        x = rng.uniform(min(xs), max(xs))
        z = rng.uniform(min(zs), max(zs))
        if math.hypot(x, z) < 85 or not inside(x, z, poly):
            continue
        trees.append([round(x, 1), round(z, 1), round(rng.uniform(0.75, 1.35), 2), round(rng.random() * math.tau, 2)])
        want -= 1
json.dump(trees[:9000], open(os.path.join(out_dir, "trees.json"), "w"))

# ---------- Traffic lanes along the main roads ----------
lanes = []
for road in data["roads"]:
    if road["cls"] not in MARKED and not road["cls"].endswith("_link"):
        continue
    pts = road["pts"]
    length = sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
    if length < 60:
        continue
    lanes.append({"w": road["w"], "pts": [[round(x, 1), round(z, 1)] for x, z in pts]})
json.dump(lanes, open(os.path.join(out_dir, "traffic.json"), "w"))

# ---------- Export ----------
bpy.ops.export_scene.gltf(
    filepath=os.path.join(out_dir, "city.glb"),
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    export_texcoords=True,
    export_normals=True,
    export_vertex_color="ACTIVE",
    export_extras=True,
    export_materials="EXPORT",  # names only; the site supplies the shaders
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=7,
    export_draco_position_quantization=16,
    export_draco_texcoord_quantization=14,
)
tris = sum(len(o.data.polygons) for o in scene.objects if o.type == "MESH")
print(f"CITY buildings={len(regular)} districts={len(districts)} roads={len(data['roads'])} trees={len(trees)} lanes={len(lanes)} faces={tris}")
