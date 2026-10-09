# Opens the saved model in a friendly state: material preview, looking through the camera.
#   blender blender/out/kaide_tower.blend --python blender/open_view.py
import bpy


def setup():
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type != "VIEW_3D":
                continue
            space = area.spaces.active
            space.shading.type = "MATERIAL"
            space.overlay.show_overlays = False
            space.region_3d.view_perspective = "CAMERA"
            space.clip_end = 6000
    return None  # run once


bpy.app.timers.register(setup, first_interval=1.0)
