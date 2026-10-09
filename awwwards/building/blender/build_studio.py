# Builds the 18th-floor studio, bakes its night lighting with Cycles and exports it for the site.
#
#   blender -b --factory-startup -P blender/build_studio.py -- <project_root> [preview|bake]
#
#   preview: renders reference frames to blender/out/ (fast, for checking layout and light)
#   bake:    bakes a 4096 lightmap and writes public/assets/studio/{studio.glb, lightmap.jpg, studio.json}
#
# Coordinates: the studio floor is at height 0 here; the site places the GLB at the floor level.
# Site frame (x east, y up, z south) maps to Blender as (x, -z, y).
# Furniture: Poly Haven (CC0). Textures: Poly Haven (CC0).

import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
ROOT = argv[0]
MODE = argv[1] if len(argv) > 1 else "preview"
SRC = os.path.join(ROOT, "blender", "src")
OUT = os.path.join(ROOT, "public", "assets", "studio")
PREVIEW = os.path.join(ROOT, "blender", "out")
os.makedirs(OUT, exist_ok=True)
os.makedirs(PREVIEW, exist_ok=True)

# Must match src/world/util.js and interior.js
FH = 3.6
S = 12.8
COLS = [-12, -4, 4, 12]
CEIL = FH - 0.42
TABLE_X = 8
TABLE_TOP = 0.9
MODEL_Z = [-8.5, -5.1, -1.7, 1.7, 5.1, 8.5]
SHEET = {"x": 3.77, "y": 1.65, "w": 2.8, "h": 1.85}


def B(x, y, z):
    """site frame -> Blender"""
    return Vector((x, -z, y))


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
studio = bpy.data.collections.new("studio")
scene.collection.children.link(studio)

# ---------- Materials ----------


def tex_node(nodes, links, name, uv_node, colour=True):
    img = bpy.data.images.load(os.path.join(SRC, "tex", name), check_existing=True)
    img.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    n = nodes.new("ShaderNodeTexImage")
    n.image = img
    links.new(uv_node.outputs["UV"], n.inputs["Vector"])
    return n


def pbr(name, colour=(0.8, 0.8, 0.8), rough=0.6, metal=0.0, maps=None, emission=None, tint=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if maps:
        uv = nodes.new("ShaderNodeUVMap")
        uv.uv_map = "UVMap"
        diff = tex_node(nodes, links, maps + "_diff_1k.jpg", uv)
        if tint:
            mix = nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            links.new(diff.outputs["Color"], mix.inputs["A"])
            mix.inputs["B"].default_value = (*tint, 1)
            links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
        else:
            links.new(diff.outputs["Color"], bsdf.inputs["Base Color"])
        rough_path = os.path.join(SRC, "tex", maps + "_rough_1k.jpg")
        if os.path.exists(rough_path):
            r = tex_node(nodes, links, maps + "_rough_1k.jpg", uv, colour=False)
            links.new(r.outputs["Color"], bsdf.inputs["Roughness"])
        nor = tex_node(nodes, links, maps + "_nor_gl_1k.jpg", uv, colour=False)
        nm = nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = 0.7
        links.new(nor.outputs["Color"], nm.inputs["Color"])
        links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission[0], 1)
        bsdf.inputs["Emission Strength"].default_value = emission[1]
    return m


WARM = (1.0, 0.78, 0.55)
MAT = {
    "floor": pbr("studio_floor", maps="concrete_floor_clean", rough=0.35, tint=(0.7, 0.7, 0.69)),
    "concrete": pbr("studio_concrete", maps="concrete_clean", rough=0.9),
    "ceiling": pbr("studio_ceiling", maps="concrete_clean", rough=0.95, tint=(0.82, 0.81, 0.79)),
    "steel": pbr("studio_steel", (0.035, 0.038, 0.042), rough=0.42, metal=0.8),
    "oak": pbr("studio_oak", maps="oak_veneer_01", rough=0.45),
    "plaster": pbr("studio_plaster", (0.86, 0.85, 0.82), rough=0.75),
    "plinth": pbr("studio_plinth", (0.03, 0.032, 0.035), rough=0.55),
    "paper": pbr("studio_paper", (0.9, 0.89, 0.86), rough=0.9),
    "fixture": pbr("studio_fixture", (0.02, 0.02, 0.02), rough=0.5, metal=0.6),
    "diffuser": pbr("studio_diffuser", (1, 1, 1), rough=0.5, emission=(WARM, 6.0)),
    "yellow": pbr("studio_yellow", (0.87, 0.6, 0.06), rough=0.45),
}

# ---------- Geometry helpers ----------


def box_uv(bm, tile):
    """metre-based box projection so textures keep their real size"""
    uv = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            c = loop.vert.co
            u, v = [(c.y, c.z), (c.x, c.z), (c.x, c.y)][ax]
            loop[uv].uv = (u / tile, v / tile)


def add_mesh(name, build, mat, tile=2.5):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    build(bm)
    bm.normal_update()
    box_uv(bm, tile)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    studio.objects.link(ob)
    return ob


def box(name, size, center, mat, tile=2.5):
    """size and center in the site frame"""
    sx, sy, sz = size
    c = B(*center)

    def build(bm):
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * sx + c.x, v.co.y * sz + c.y, v.co.z * sy + c.z))

    return add_mesh(name, build, mat, tile)


def plane(name, w, d, y, mat, flip=False, tile=2.5):
    def build(bm):
        vs = [bm.verts.new(B(x, y, z)) for x, z in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]
        f = bm.faces.new(vs)
        f.normal_update()
        if (f.normal.z < 0) != flip:
            f.normal_flip()

    return add_mesh(name, build, mat, tile)


# ---------- Shell: covers the site's own slabs, core and columns from inside ----------
plane("floor", 2 * S, 2 * S, 0.004, MAT["floor"], tile=3.0)
plane("ceiling", 2 * S, 2 * S, CEIL - 0.004, MAT["ceiling"], flip=True, tile=3.0)
box("core", (7.51, CEIL, 7.51), (0, CEIL / 2, 0), MAT["concrete"], tile=3.0)
for x in COLS:
    for z in COLS:
        box(f"column_{x}_{z}", (0.87, CEIL, 0.87), (x, CEIL / 2, z), MAT["steel"])

# ---------- Model table ----------
box("table_top", (2.2, 0.06, 23), (TABLE_X, TABLE_TOP - 0.03, 0), MAT["oak"], tile=2.0)
for z in (-10, 0, 10):
    box(f"table_leg_{z}", (1.9, TABLE_TOP - 0.06, 0.06), (TABLE_X, (TABLE_TOP - 0.06) / 2, z), MAT["steel"])
for k, z in enumerate(MODEL_Z):
    box(f"plinth_{k}", (1.15, 0.12, 1.15), (TABLE_X, TABLE_TOP + 0.06, z), MAT["plinth"])

# The six project maquettes (same shapes as the site used before)
P = TABLE_TOP + 0.12


def mbox(name, w, h, d, x, y, z, mat=None, rot=0.0):
    ob = box(name, (w, h, d), (x, y + h / 2, z), mat or MAT["plaster"])
    if rot:
        ob.rotation_euler = Euler((0, 0, rot))
        # rotate around the model's axis, not the world origin
        ob.location = Vector((0, 0, 0))
        me = ob.data
        pivot = B(x, 0, z)
        for v in me.vertices:
            v.co -= pivot
        ob.location = pivot
    return ob


def maquettes():
    z = MODEL_Z
    X = TABLE_X
    # Meridyen Kule
    mbox("m0_tower", 0.26, 1.0, 0.26, X, P, z[0])
    mbox("m0_crown", 0.2, 0.06, 0.2, X, P + 1.0, z[0])
    mbox("m0_mast", 0.012, 0.16, 0.012, X, P + 1.06, z[0])
    # Atlas Rezidans, still in its frame, with a tiny crane
    mbox("m1_base", 0.3, 0.42, 0.3, X, P, z[1])
    for lv in range(3):
        for dx in (-0.13, 0.13):
            for dz in (-0.13, 0.13):
                mbox(f"m1_col_{lv}_{dx}_{dz}", 0.018, 0.08, 0.018, X + dx, P + 0.42 + lv * 0.08, z[1] + dz, MAT["steel"])
        mbox(f"m1_slab_{lv}", 0.3, 0.01, 0.3, X, P + 0.5 + lv * 0.08, z[1])
    mbox("m1_mast", 0.02, 0.86, 0.02, X - 0.24, P, z[1] + 0.2, MAT["yellow"])
    mbox("m1_jib", 0.42, 0.02, 0.02, X - 0.08, P + 0.86, z[1] + 0.2, MAT["yellow"])
    # Haliç Konutları: stepped L
    mbox("m2_a", 0.86, 0.24, 0.2, X, P, z[2] - 0.24)
    mbox("m2_b", 0.2, 0.18, 0.66, X - 0.33, P, z[2] + 0.1)
    mbox("m2_c", 0.4, 0.3, 0.2, X + 0.22, P, z[2] + 0.2)
    # Liman Plaza: twisting stack
    for i in range(14):
        mbox(f"m3_slice_{i}", 0.3, 0.042, 0.3, X, P + i * 0.046, z[3], rot=i * 0.055)
    # Kızılay Adalet Binası: courtyard block
    mbox("m4_n", 0.8, 0.18, 0.2, X, P, z[4] - 0.3)
    mbox("m4_s", 0.8, 0.18, 0.2, X, P, z[4] + 0.3)
    mbox("m4_w", 0.2, 0.18, 0.4, X - 0.3, P, z[4])
    mbox("m4_e", 0.2, 0.18, 0.4, X + 0.3, P, z[4])
    # Ege Kültür Merkezi: vault on a base
    mbox("m5_base", 0.9, 0.02, 0.8, X, P, z[5])
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.32, depth=0.8, location=B(X, P + 0.02, z[5]), rotation=(0, 0, 0))
    vault = bpy.context.active_object
    vault.name = "m5_vault"
    vault.rotation_euler = Euler((math.pi / 2, 0, 0))  # axis along site z
    bpy.context.view_layer.objects.active = vault
    bpy.ops.object.transform_apply(rotation=True)
    me = vault.data
    bm = bmesh.new()
    bm.from_mesh(me)
    # keep the upper half only
    cut = [v for v in bm.verts if v.co.z < -1e-4]
    bmesh.ops.delete(bm, geom=cut, context="VERTS")
    bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
    bm.normal_update()
    box_uv(bm, 2.5)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MAT["plaster"])
    for c in vault.users_collection:
        c.objects.unlink(vault)
    studio.objects.link(vault)


maquettes()

# ---------- Lighting fixtures (visible geometry) ----------
for z in (-6, 6):
    box(f"pendant_body_{z}", (0.16, 0.06, 8.2), (TABLE_X, CEIL - 0.42, z), MAT["fixture"])
    box(f"pendant_diffuser_{z}", (0.13, 0.012, 8.1), (TABLE_X, CEIL - 0.456, z), MAT["diffuser"])
    for zz in (z - 3.6, z + 3.6):
        box(f"pendant_wire_{z}_{zz}", (0.006, 0.36, 0.006), (TABLE_X, CEIL - 0.21, zz), MAT["steel"])
# gallery track over the models
box("track", (0.05, 0.04, 21), (TABLE_X + 1.35, CEIL - 0.03, 0), MAT["fixture"])
for k, z in enumerate(MODEL_Z):
    box(f"track_head_{k}", (0.1, 0.16, 0.1), (TABLE_X + 1.35, CEIL - 0.13, z), MAT["fixture"])
# sheet on the core and its wall washer
box("sheet_board", (0.02, SHEET["h"] + 0.06, SHEET["w"] + 0.06), (SHEET["x"] - 0.016, SHEET["y"], 0), MAT["fixture"])
box("washer", (0.12, 0.06, 2.8), (5.3, CEIL - 0.03, 0), MAT["fixture"])

# ---------- Furniture (Poly Haven, CC0) ----------


def place(asset, at, rot_deg=0.0, scale=1.0, name=None):
    path = os.path.join(SRC, "models", asset, f"{asset}.gltf")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new(name or asset, None)
    studio.objects.link(root)
    for o in new:
        if o.parent is None:
            o.parent = root
        for c in o.users_collection:
            c.objects.unlink(o)
        studio.objects.link(o)
    root.location = B(*at)
    root.rotation_euler = Euler((0, 0, math.radians(rot_deg)))
    root.scale = (scale, scale, scale)
    bpy.context.view_layer.update()
    for o in new:
        if o.type == "MESH":
            o.data = o.data.copy()  # unique lightmap UVs per copy
    return new


# Lounge by the west windows
place("sofa_03", (-9.2, 0, -10.6), 0)
place("coffee_table_round_01", (-9.2, 0, -8.3), 0)
place("modern_arm_chair_01", (-11.0, 0, -7.6), 90, name="armchair_w")
place("modern_arm_chair_01", (-7.3, 0, -7.4), -90, name="armchair_e")
place("modern_ceiling_lamp_01", (-9.2, CEIL - 1.17, -8.3), 0)
place("potted_plant_02", (-12.0, 0, -11.9), 30, scale=1.6)
place("potted_plant_02", (-5.4, 0, -11.8), 140, scale=1.3)
# Desk on the north side of the core
place("metal_office_desk", (0, 0, -9.9), 180)
place("modern_arm_chair_01", (0, 0, -8.7), 180, name="desk_chair")
place("classic_laptop", (0.1, 0.79, -10.0), 0)
place("potted_plant_04", (0.75, 0.79, -10.15), 0, scale=1.4)
place("steel_frame_shelves_01", (-2.0, 0, -4.35), 180, scale=0.1)
place("potted_plant_02", (11.6, 0, 11.6), 200, scale=1.5)

# make the laptop screen glow
for m in bpy.data.materials:
    if m.name.startswith("classic_laptop_screen") and m.use_nodes:
        b = m.node_tree.nodes.get("Principled BSDF")
        if b:
            b.inputs["Emission Color"].default_value = (0.55, 0.7, 1.0, 1)
            b.inputs["Emission Strength"].default_value = 1.5

# ---------- Lights ----------


def light(kind, name, at, power, colour=WARM, aim=None, size=None, spot=None):
    data = bpy.data.lights.new(name, kind)
    data.energy = power
    data.color = colour
    if kind == "AREA" and size:
        data.shape = "RECTANGLE"
        data.size, data.size_y = size
    if kind == "SPOT" and spot:
        data.spot_size = math.radians(spot)
        data.spot_blend = 0.6
    if kind in ("POINT", "SPOT"):
        data.shadow_soft_size = 0.05
    ob = bpy.data.objects.new(name, data)
    studio.objects.link(ob)
    ob.location = B(*at)
    if kind == "AREA":
        ob.visible_camera = False  # emitters light the room but are never seen
        ob.visible_glossy = False
    if aim:
        d = B(*aim) - ob.location
        ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


for z in (-6, 6):
    light("AREA", f"pendant_light_{z}", (TABLE_X, CEIL - 0.47, z), 260, aim=(TABLE_X, 0, z), size=(0.13, 8.0))
for k, z in enumerate(MODEL_Z):
    light("SPOT", f"model_spot_{k}", (TABLE_X + 1.35, CEIL - 0.2, z), 30, colour=(1.0, 0.86, 0.7), aim=(TABLE_X, TABLE_TOP + 0.35, z), spot=26)
light("AREA", "washer_light", (5.3, CEIL - 0.08, 0), 70, colour=(1.0, 0.9, 0.78), aim=(SHEET["x"], SHEET["y"], 0), size=(2.8, 0.1))
light("POINT", "lounge_lamp", (-9.2, CEIL - 0.85, -8.3), 130, colour=(1.0, 0.75, 0.5))
light("AREA", "desk_glow", (0, 1.4, -10.4), 6, colour=(0.6, 0.72, 1.0), aim=(0, 1.0, -8.5), size=(0.3, 0.2))
# recessed downlights over the open floor: realistic pools of light on the concrete
DOWN = [(x, z) for x in (-10.5, -7.0) for z in (-10.5, -7.0, -3.5, 0.0, 3.5, 7.0, 10.5)]
DOWN += [(x, z) for x in (-2.0, 2.0) for z in (-10.5, -7.0, 7.0, 10.5)]
DOWN += [(5.0, z) for z in (-10.5, -7.0, 7.0, 10.5)]
for i, (x, z) in enumerate(DOWN):
    box(f"downlight_rim_{i}", (0.2, 0.01, 0.2), (x, CEIL - 0.006, z), MAT["fixture"])
    box(f"downlight_{i}", (0.13, 0.004, 0.13), (x, CEIL - 0.013, z), MAT["diffuser"])
    light("SPOT", f"downlight_light_{i}", (x, CEIL - 0.03, z), 85, colour=(1.0, 0.83, 0.64), aim=(x, 0, z), spot=75)

# night city through the glass: cool fill from each facade
for name, at, aim in (
    ("fill_w", (-15, 1.6, 0), (0, 1.2, 0)),
    ("fill_e", (15, 1.6, 0), (0, 1.2, 0)),
    ("fill_n", (0, 1.6, -15), (0, 1.2, 0)),
    ("fill_s", (0, 1.6, 15), (0, 1.2, 0)),
):
    light("AREA", name, at, 140, colour=(0.55, 0.62, 0.8), aim=aim, size=(24, 2.6))

world = bpy.data.worlds.new("night")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.012, 0.014, 0.02, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
scene.world = world

# ---------- Render setup ----------
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
for kind in ("OPTIX", "CUDA"):
    try:
        prefs.compute_device_type = kind
        prefs.get_devices()
        if any(d.type == kind for d in prefs.devices):
            for d in prefs.devices:
                d.use = d.type == kind
            scene.cycles.device = "GPU"
            break
    except TypeError:
        continue
for name in ("Khronos PBR Neutral", "AgX"):
    try:
        scene.view_settings.view_transform = name
        break
    except TypeError:
        pass
scene.cycles.max_bounces = 6
scene.cycles.diffuse_bounces = 4

if MODE == "preview":
    scene.cycles.samples = 96
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    shots = {
        "models": ((11.3, 2.2, -3.8), (8, 1.32, -1.7), 40),
        "overview": ((11.6, 1.75, -11.4), (-6, 1.0, 4), 50),
        "sheet": ((6.85, 1.65, 0), (3, 1.65, 0), 44),
        "lounge": ((-5.4, 1.7, 7.8), (-10, 0.8, -8), 50),
        "desk": ((3.5, 1.6, -5.5), (-1, 0.8, -10), 50),
    }
    for key, (p, l, fov) in shots.items():
        cam.location = B(*p)
        cam.rotation_euler = (B(*l) - cam.location).to_track_quat("-Z", "Y").to_euler()
        cam_data.angle_y = math.radians(fov)
        cam_data.sensor_fit = "VERTICAL"
        scene.render.filepath = os.path.join(PREVIEW, f"studio_{key}.png")
        bpy.ops.render.render(write_still=True)
        print("PREVIEW", key)
    sys.exit(0)

# ---------- Bake ----------
import time

T0 = time.time()


def log(msg):
    print(f"STEP {time.time() - T0:7.1f}s {msg}", flush=True)


SIZE = 4096
meshes = [o for o in studio.objects if o.type == "MESH"]
# foliage is far too dense for a lightmap; a lighter copy bakes the same light
for o in meshes:
    if len(o.data.polygons) > 12000:
        mod = o.modifiers.new("lite", "DECIMATE")
        mod.ratio = max(0.08, 6000 / len(o.data.polygons))
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=mod.name)
log(f"meshes {len(meshes)}, faces {sum(len(o.data.polygons) for o in meshes)}")
# One object, one bake pass: Cycles maps the whole image on the CPU once per baked object
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
joined = bpy.context.view_layer.objects.active
joined.name = "studio"
for o in [o for o in studio.objects if o.type == "EMPTY"]:
    bpy.data.objects.remove(o)
meshes = [joined]
log(f"joined into one mesh, uv layers {[l.name for l in joined.data.uv_layers]}, materials {len(joined.material_slots)}")
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    if "lightmap" not in o.data.uv_layers:
        o.data.uv_layers.new(name="lightmap")
    o.data.uv_layers.active = o.data.uv_layers["lightmap"]
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, scale_to_bounds=False)
log("unwrapped")
bpy.ops.uv.pack_islands(margin=0.002, rotate=False)
bpy.ops.object.mode_set(mode="OBJECT")
log("packed")

lightmap = bpy.data.images.new("lightmap_bake", SIZE, SIZE, float_buffer=True, alpha=False)
bake_nodes = []
for m in {s.material for o in meshes for s in o.material_slots if s.material}:
    m.use_nodes = True
    nodes = m.node_tree.nodes
    uvn = nodes.new("ShaderNodeUVMap")
    uvn.uv_map = "lightmap"
    img = nodes.new("ShaderNodeTexImage")
    img.image = lightmap
    m.node_tree.links.new(uvn.outputs["UV"], img.inputs["Vector"])
    nodes.active = img
    bake_nodes.append((m, uvn, img))

scene.cycles.samples = 512
scene.render.bake.margin = 16
scene.render.bake.use_pass_direct = True
scene.render.bake.use_pass_indirect = True
scene.render.bake.use_pass_color = False
log("baking")
bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, margin=16, use_clear=True)
log("BAKED")

# light 3x3 smoothing to tame residual noise, then encode into 8-bit sRGB with a scale
px = np.empty(SIZE * SIZE * 4, dtype=np.float32)
lightmap.pixels.foreach_get(px)
img = px.reshape(SIZE, SIZE, 4)[:, :, :3]
pad = np.pad(img, ((1, 1), (1, 1), (0, 0)), mode="edge")
k = np.array([1, 2, 1], dtype=np.float32)
acc = np.zeros_like(img)
for i in range(3):
    for j in range(3):
        acc += pad[i : i + SIZE, j : j + SIZE] * (k[i] * k[j])
img = acc / 16.0
lum = img @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
scale = float(np.percentile(lum[lum > 1e-5], 99.6)) if np.any(lum > 1e-5) else 1.0
enc = np.clip(img / scale, 0, 1)
enc = np.where(enc <= 0.0031308, enc * 12.92, 1.055 * np.power(enc, 1 / 2.4) - 0.055)
out = bpy.data.images.new("lightmap_out", SIZE, SIZE, alpha=False)
out.colorspace_settings.name = "sRGB"
rgba = np.concatenate([enc, np.ones((SIZE, SIZE, 1), dtype=np.float32)], axis=2)
out.pixels.foreach_set(rgba.ravel())
out.filepath_raw = os.path.join(OUT, "lightmap.jpg")
out.file_format = "JPEG"
scene.render.image_settings.quality = 88
out.save()
json.dump({"lightmapScale": scale}, open(os.path.join(OUT, "studio.json"), "w"))
print("LIGHTMAP scale", scale)

# remove bake nodes before export, shrink textures for the web
for m, uvn, imgn in bake_nodes:
    m.node_tree.nodes.remove(imgn)
    m.node_tree.nodes.remove(uvn)
for im in bpy.data.images:
    if im.name.startswith("lightmap"):
        continue
    if im.size[0] > 512:
        im.scale(512, int(512 * im.size[1] / im.size[0]))

bpy.ops.object.select_all(action="DESELECT")
for o in studio.objects:
    o.select_set(o.type in ("MESH", "EMPTY"))
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, "studio.glb"),
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_apply=True,
    export_texcoords=True,
    export_normals=True,
    export_lights=False,
    export_image_format="JPEG",
    export_jpeg_quality=82,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=7,
)
print("EXPORTED")
