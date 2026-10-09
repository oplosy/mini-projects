# Calms a photographed texture: pulls saturation and contrast toward a neutral mid tone.
#   blender -b --factory-startup -P blender/clean_texture.py -- <src.jpg> <dst.jpg> <saturation> <contrast> <gain>
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1 :]
src, dst = argv[0], argv[1]
sat, contrast, gain = (float(v) for v in argv[2:5])

img = bpy.data.images.load(src)
w, h = img.size
px = np.empty(w * h * 4, dtype=np.float32)
img.pixels.foreach_get(px)
rgba = px.reshape(h, w, 4)
rgb = rgba[:, :, :3]
grey = (rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))[:, :, None]
rgb = grey + (rgb - grey) * sat
mean = rgb.mean()
rgb = np.clip((mean + (rgb - mean) * contrast) * gain, 0, 1)
rgba[:, :, :3] = rgb
out = bpy.data.images.new("clean", w, h)
out.pixels.foreach_set(rgba.ravel())
out.filepath_raw = dst
out.file_format = "JPEG"
bpy.context.scene.render.image_settings.quality = 90
out.save()
print("cleaned", dst)
