# Asset credits

## Poly Haven (CC0, public domain) — https://polyhaven.com

| Used in | Source |
|---|---|
| sky/day.jpg | HDRI "overcast_soil_puresky" (2K), tone-mapped with `blender/hdri_to_web.py` |
| sky/sunset.jpg | HDRI "industrial_sunset_puresky" (2K), tone-mapped with `blender/hdri_to_web.py` |
| sky/overcast_soil_puresky_1k.hdr | HDRI "overcast_soil_puresky" (1K), reflections |
| tex/concrete_clean_diff_1k.jpg | Texture "concrete_wall_003", desaturated with `blender/clean_texture.py` |
| tex/concrete_floor_02_* | Texture "concrete_floor_02" |
| studio/studio.glb | Models "sofa_03", "coffee_table_round_01", "modern_arm_chair_01", "modern_ceiling_lamp_01", "potted_plant_02", "potted_plant_04", "metal_office_desk", "classic_laptop", "steel_frame_shelves_01"; textures "oak_veneer_01", "concrete_wall_003", "concrete_floor_02" |

## OpenStreetMap (ODbL) — https://www.openstreetmap.org/copyright

`city/city.glb`, `city/trees.json` and `city/traffic.json` are built from OpenStreetMap data
(© OpenStreetMap contributors) around Ataşehir, İstanbul, with `scripts/fetch-osm.mjs`,
`scripts/build-city.mjs` and `blender/build_city.py`. Building heights without a tag are estimated.

`tower/tower.glb` and `tower/tower_ao.jpg` (the finished facade of the site's tower) are modelled
and AO-baked by `blender/build_tower.py`; no third-party assets.

The night sky is generated in `src/world/sky.js`. The studio lighting is baked with Blender Cycles
(`blender/build_studio.py`).
