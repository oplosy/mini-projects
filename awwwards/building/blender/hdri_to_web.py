# Converts an equirectangular HDR into a tone-mapped web JPG.
# Uses the same Khronos PBR Neutral curve as the site's renderer so sky colours match.
#
#   blender -b --factory-startup -P blender/hdri_to_web.py -- <src.hdr> <dst.jpg> <width> <exposure>

import sys
import bpy

argv = sys.argv[sys.argv.index("--") + 1 :]
src, dst = argv[0], argv[1]
width = int(argv[2]) if len(argv) > 2 else 2048
exposure = float(argv[3]) if len(argv) > 3 else 0.0

scene = bpy.context.scene
vs = scene.view_settings
# view_transform is a dynamic enum, so try names in order of preference
for name in ("Khronos PBR Neutral", "AgX", "Standard"):
    try:
        vs.view_transform = name
        break
    except TypeError:
        continue
vs.look = "None"
vs.exposure = exposure
vs.gamma = 1.0

settings = scene.render.image_settings
settings.file_format = "JPEG"
settings.quality = 84

img = bpy.data.images.load(src)
if img.size[0] != width:
    img.scale(width, width // 2)
img.save_render(dst, scene=scene)
print(f"wrote {dst} ({vs.view_transform}, exposure {exposure})")
