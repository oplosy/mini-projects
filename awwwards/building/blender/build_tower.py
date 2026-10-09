# Builds the finished facade skin of Atlas Rezidans and bakes ambient occlusion for it.
#
#   blender -b --factory-startup -P blender/build_tower.py -- <project_root> [preview|bake]
#
# The site keeps its own animated structure (columns, slabs, core, glass panels) for the build
# sequence; this skin adds what a finished residential tower has: precast slab edges, aluminium
# fins, balconies with glass balustrades, an entrance canopy and a crown. Only AO is baked,
# because the sun moves from day to sunset to night on the site.
# Site frame (x east, y up, z south) maps to Blender as (x, -z, y). Absolute site coordinates.

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
ROOT = argv[0]
MODE = argv[1] if len(argv) > 1 else "preview"
OUT = os.path.join(ROOT, "public", "assets", "tower")
PREVIEW = os.path.join(ROOT, "blender", "out")
os.makedirs(OUT, exist_ok=True)
os.makedirs(PREVIEW, exist_ok=True)

# Must match src/world/util.js
F = 28
FH = 3.6
BASE = 1.2
S = 12.8  # slab edge
GLASS = S + 0.14  # outer face of the site's glass panels
PW = 2 * S / 6  # panel / bay width
H = BASE + F * FH
rng = random.Random(28)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def B(x, y, z):
    return Vector((x, -z, y))


# one bmesh per material, merged into objects at the end
parts = {}


def bm_for(name):
    if name not in parts:
        bm = bmesh.new()
        bm.loops.layers.uv.new("UVMap")
        parts[name] = bm
    return parts[name]


def box(mat, x0, x1, y0, y1, z0, z1):
    """axis-aligned box in site coordinates (min/max per axis)"""
    bm = bm_for(mat)
    uv = bm.loops.layers.uv["UVMap"]
    a, b = B(x0, y0, z0), B(x1, y1, z1)
    lo = Vector((min(a.x, b.x), min(a.y, b.y), min(a.z, b.z)))
    hi = Vector((max(a.x, b.x), max(a.y, b.y), max(a.z, b.z)))
    v = [bm.verts.new((x, y, z)) for z in (lo.z, hi.z) for y in (lo.y, hi.y) for x in (lo.x, hi.x)]
    faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    for f in faces:
        face = bm.faces.new([v[i] for i in f])
        face.normal_update()
        n = face.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in face.loops:
            c = loop.vert.co
            u, w = [(c.y, c.z), (c.x, c.z), (c.x, c.y)][ax]
            loop[uv].uv = (u / 3.0, w / 3.0)


def faces4():
    """(name, normal x, normal z): the four facades"""
    return (("south", 0, 1), ("east", 1, 0), ("north", 0, -1), ("west", -1, 0))


def along(face, u0, u1, d0, d1, y0, y1, mat):
    """box on a facade: u along the face (west->east or north->south), d outward from the slab edge"""
    _, nx, nz = face
    if nz:
        x0, x1 = u0, u1
        z0, z1 = sorted((nz * (S + d0), nz * (S + d1)))
    else:
        z0, z1 = u0, u1
        x0, x1 = sorted((nx * (S + d0), nx * (S + d1)))
    box(mat, x0, x1, y0, y1, z0, z1)


joints = [-S + k * PW for k in range(1, 6)]
level = lambda i: BASE + i * FH

# ---------- Precast slab edges on every floor ----------
for i in range(1, F + 1):
    y = level(i)
    for face in faces4():
        if face[0] == "south" and i < F:
            continue  # the balcony slabs take this edge
        along(face, -S - 0.3, S + 0.3, -0.05, 0.3, y - 0.48, y + 0.08, "precast")

# ---------- Vertical aluminium fins (north, west, east) ----------
for face in faces4():
    if face[0] == "south":
        continue
    for j, u in enumerate(joints):
        depth = 0.55 if j % 2 == 0 else 0.38  # alternating depths give the facade rhythm
        along(face, u - 0.035, u + 0.035, 0.12, 0.12 + depth, level(1) - 0.4, H - 0.1, "fin")

# ---------- South balconies: continuous, glass balustrades, privacy screens ----------
south = faces4()[0]
for i in range(1, F):
    y = level(i)
    along(south, -S - 0.3, S + 0.3, -0.05, 1.9, y - 0.26, y + 0.06, "precast")
    along(south, -S - 0.2, S + 0.2, 1.84, 1.86, y + 0.06, y + 1.1, "balustrade")
    along(south, -S - 0.25, S + 0.25, 1.82, 1.9, y + 1.1, y + 1.14, "rail")
    for x in (-S - 0.22, S + 0.2):
        box("balustrade", x, x + 0.02, y + 0.06, y + 1.1, S, S + 1.85)
    for x in (-PW * 1.5, 0.0, PW * 1.5):
        box("screen", x - 0.03, x + 0.03, y + 0.06, y + FH - 0.5, S + 0.15, S + 1.8)
    # soffit lights under the balcony above: some apartments have them on
    for k in range(6):
        if rng.random() < 0.35:
            cx = -S + PW * (k + 0.5)
            box("soffit_light", cx - 0.09, cx + 0.09, y + FH - 0.3 - 0.012, y + FH - 0.3, S + 0.85, S + 1.03)

# ---------- East corner balconies ----------
for i in range(1, F):
    y = level(i)
    for z0, z1 in ((-S, -S + PW), (S - PW, S)):
        box("precast", S - 0.05, S + 1.6, y - 0.26, y + 0.06, z0, z1)
        box("balustrade", S + 1.54, S + 1.56, y + 0.06, y + 1.1, z0, z1)
        box("rail", S + 1.52, S + 1.6, y + 1.1, y + 1.14, z0, z1)
        inner = z1 if z0 < 0 else z0
        box("balustrade", S + 0.1, S + 1.55, y + 0.06, y + 1.1, inner - 0.01, inner + 0.01)

# ---------- Entrance canopy (south) ----------
box("precast", -7.5, 7.5, BASE + 3.0, BASE + 3.35, S, S + 5.0)
for k in range(5):
    cx = -6 + k * 3
    box("soffit_light", cx - 0.12, cx + 0.12, BASE + 2.988, BASE + 3.0, S + 3.2, S + 3.44)
for x in (-7.2, 7.2):
    box("fin", x - 0.08, x + 0.08, BASE, BASE + 3.0, S + 4.6, S + 4.76)

# ---------- Crown: parapet, plant screen, roof kit ----------
for face in faces4():
    along(face, -S - 0.3, S + 0.3, -0.05, 0.3, H, H + 1.3, "precast")
box("roof", -S, S, H - 0.02, H + 0.06, -S, S)
SCREEN = 7.2
for k in range(40):
    t = -SCREEN + (2 * SCREEN) * (k + 0.5) / 40
    for (x0, x1, z0, z1) in (
        (t - 0.04, t + 0.04, SCREEN - 0.1, SCREEN + 0.1),
        (t - 0.04, t + 0.04, -SCREEN - 0.1, -SCREEN + 0.1),
        (SCREEN - 0.1, SCREEN + 0.1, t - 0.04, t + 0.04),
        (-SCREEN - 0.1, -SCREEN + 0.1, t - 0.04, t + 0.04),
    ):
        box("fin", x0, x1, H + 0.06, H + 5.4, z0, z1)
box("fin", -SCREEN - 0.1, SCREEN + 0.1, H + 5.4, H + 5.6, -SCREEN - 0.1, SCREEN + 0.1)
for (x, z, w, d, h) in ((-9.5, -9.5, 2.4, 1.6, 1.8), (9.2, -8.8, 2.0, 2.0, 1.4), (-9.0, 9.4, 3.0, 1.4, 1.6)):
    box("hvac", x - w / 2, x + w / 2, H + 0.06, H + 0.06 + h, z - d / 2, z + d / 2)

# ---------- Objects and materials ----------


def material(name, colour, rough=0.6, metal=0.0, alpha=1.0, emission=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    if emission:
        b.inputs["Emission Color"].default_value = (*emission[0], 1)
        b.inputs["Emission Strength"].default_value = emission[1]
    return m


MATS = {
    "precast": material("precast", (0.72, 0.7, 0.66), 0.85),
    "fin": material("fin", (0.16, 0.14, 0.12), 0.35, 0.8),
    "balustrade": material("balustrade", (0.6, 0.7, 0.72), 0.05, 0.0, alpha=0.28),
    "rail": material("rail", (0.5, 0.5, 0.5), 0.3, 0.9),
    "screen": material("screen", (0.85, 0.85, 0.83), 0.6, 0.0, alpha=0.7),
    "soffit_light": material("soffit_light", (1, 1, 1), 0.5, 0.0, emission=((1.0, 0.82, 0.6), 8)),
    "roof": material("roof", (0.45, 0.44, 0.42), 0.95),
    "hvac": material("hvac", (0.62, 0.63, 0.64), 0.5, 0.6),
}

objects = []
for name, bm in parts.items():
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MATS[name])
    ob = bpy.data.objects.new(f"skin_{name}", me)
    scene.collection.objects.link(ob)
    objects.append(ob)

# ---------- Preview ----------
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "OPTIX"
prefs.refresh_devices() if hasattr(prefs, "refresh_devices") else prefs.get_devices()
for d in prefs.devices:
    d.use = d.type == "OPTIX"
scene.cycles.device = "GPU"
for name in ("Khronos PBR Neutral", "AgX"):
    try:
        scene.view_settings.view_transform = name
        break
    except TypeError:
        pass

if MODE == "preview":
    # stand-in for the site's own glass and slabs so the preview reads as a building
    core = bpy.data.meshes.new("stand_in")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co = Vector((v.co.x * 2 * GLASS, v.co.y * 2 * GLASS, v.co.z * (H - BASE) + (H + BASE) / 2))
    bm.to_mesh(core)
    bm.free()
    core.materials.append(material("standin_glass", (0.08, 0.1, 0.12), 0.1, 0.0))
    scene.collection.objects.link(bpy.data.objects.new("stand_in", core))
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.6, 0.68, 1)
    scene.world = world
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    for key, (p, l, fov) in {
        "tower_full": ((150, 40, 110), (0, 52, 0), 40),
        "tower_close": ((40, 70, 46), (0, 62, 6), 46),
    }.items():
        cam.location = B(*p)
        cam.rotation_euler = (B(*l) - cam.location).to_track_quat("-Z", "Y").to_euler()
        cam.data.angle_y = math.radians(fov)
        cam.data.sensor_fit = "VERTICAL"
        scene.render.filepath = os.path.join(PREVIEW, f"{key}.png")
        bpy.ops.render.render(write_still=True)
        print("PREVIEW", key)
    sys.exit(0)

# ---------- AO bake into one 2K map ----------
bpy.ops.object.select_all(action="DESELECT")
for o in objects:
    o.select_set(True)
bpy.context.view_layer.objects.active = objects[0]
bpy.ops.object.join()
skin = bpy.context.view_layer.objects.active
skin.name = "tower_skin"
skin.data.uv_layers.new(name="ao")
skin.data.uv_layers.active = skin.data.uv_layers["ao"]
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003, scale_to_bounds=False)
bpy.ops.uv.pack_islands(margin=0.002, rotate=False)
bpy.ops.object.mode_set(mode="OBJECT")

# occluders the skin sits against: the glass wall and the slabs, present on the site
occ = bpy.data.meshes.new("occluder")
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1)
for v in bm.verts:
    v.co = Vector((v.co.x * 2 * GLASS, v.co.y * 2 * GLASS, v.co.z * (H - BASE) + (H + BASE) / 2))
bm.to_mesh(occ)
bm.free()
occluder = bpy.data.objects.new("occluder", occ)
scene.collection.objects.link(occluder)

SIZE = 2048
ao = bpy.data.images.new("ao_bake", SIZE, SIZE, alpha=False)
ao.colorspace_settings.name = "Non-Color"
bake_nodes = []
for m in {s.material for s in skin.material_slots}:
    nodes = m.node_tree.nodes
    uvn = nodes.new("ShaderNodeUVMap")
    uvn.uv_map = "ao"
    img = nodes.new("ShaderNodeTexImage")
    img.image = ao
    m.node_tree.links.new(uvn.outputs["UV"], img.inputs["Vector"])
    nodes.active = img
    bake_nodes.append((m, uvn, img))
occ.materials.append(material("occ", (0.5, 0.5, 0.5)))
bpy.ops.object.select_all(action="DESELECT")
skin.select_set(True)
bpy.context.view_layer.objects.active = skin
scene.cycles.samples = 256
scene.world = bpy.data.worlds.new("ao_world")
scene.world.light_settings.distance = 6.0
bpy.ops.object.bake(type="AO", margin=8, use_clear=True)
ao.scale(1024, 1024)  # AO is soft; half resolution is indistinguishable on the web
ao.filepath_raw = os.path.join(OUT, "tower_ao.jpg")
ao.file_format = "JPEG"
scene.render.image_settings.quality = 90
ao.save()
print("AO BAKED")

for m, uvn, img in bake_nodes:
    m.node_tree.nodes.remove(img)
    m.node_tree.nodes.remove(uvn)
bpy.data.objects.remove(occluder)
bpy.ops.object.select_all(action="DESELECT")
skin.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, "tower.glb"),
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=7,
)
print("EXPORTED", len(skin.data.polygons), "faces")
