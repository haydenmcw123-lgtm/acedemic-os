"""
Stage 5, step 2: bakes the lightmaps in Blender (Cycles, headless).

    blender -b -P scripts/bake.py -- bake public/lightmaps        (or: pnpm bake)

Reads bake/scene.json + scene.bin (written by scripts/bake-export.ts), then:
  1. builds every mesh (feet → meters, three's y-up → Blender's z-up), with its average albedo;
  2. gives the receivers (the interior surfaces) a second UV set: Smart UV Project per surface,
     equal texel density, packed together into one atlas;
  3. for each bake time (Morning 8:00, Noon 12:30, Golden 17:45): a sun lamp exactly where the
     runtime puts it and a physical (Nishita) sky, then bakes
       - indirect diffuse light (sun + sky bounced off every surface), and
       - direct sky light (through the windows),
     and stores their sum: everything except the sun's direct light, which stays real-time
     (with its sharp shadow map);
  4. bakes ambient occlusion once (used to keep reflections out of corners);
  5. writes public/lightmaps/{morning,noon,golden,ao}.png, uv2.bin and manifest.json.

Env: LM_RES (atlas size, default 2048), LM_SAMPLES (default 256), LM_ONLY (comma list of times).
Values are irradiance / π (Cycles' diffuse "lighting"); the app multiplies by π · maxValue.
"""
import bmesh
import bpy
import json
import math
import numpy as np
import os
import sys
import time

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['bake', 'public/lightmaps']
SRC, OUT = argv[0], argv[1]
RES = int(os.environ.get('LM_RES', 2048))
SAMPLES = int(os.environ.get('LM_SAMPLES', 256))
ONLY = [t for t in os.environ.get('LM_ONLY', '').split(',') if t]
FT = 0.3048
# clear-sky diffuse light on the ground at noon, as a fraction of the sun's (direct-normal) strength
SKY_RATIO_NOON = 0.15

t0 = time.time()
def log(*a): print(f'[bake {time.time() - t0:6.0f}s]', *a, flush=True)

meta = json.load(open(os.path.join(SRC, 'scene.json')))
data = np.fromfile(os.path.join(SRC, 'scene.bin'), dtype=np.float32).reshape(-1, 6)
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
cy = sc.cycles
cy.device = 'CPU'
cy.samples = SAMPLES
cy.use_denoising = False  # this build has no OpenImageDenoise (and the bake then silently writes nothing)
cy.max_bounces = 6
cy.diffuse_bounces = 4
cy.glossy_bounces = 0
cy.transmission_bounces = 0
cy.sample_clamp_indirect = 8.0
sc.render.bake.margin = 6
sc.render.bake.margin_type = 'EXTEND'

def to_blender(p):  # three (x, y, z) feet → Blender (x, -z, y) meters
    return (p[0] * FT, -p[2] * FT, p[1] * FT)

# ---------------------------------------------------------------- meshes
receivers = []
for o in meta['objects']:
    start, n = o['offset'] // 6, o['tris'] * 3
    pts = data[start:start + n, :3]
    verts = [to_blender(p) for p in pts]
    faces = [(3 * i, 3 * i + 1, 3 * i + 2) for i in range(o['tris'])]
    me = bpy.data.meshes.new(o['name'])
    me.from_pydata(verts, [], faces)
    attr = me.attributes.new('orig', 'INT', 'FACE')
    attr.data.foreach_set('value', np.arange(o['tris'], dtype=np.int32))
    ob = bpy.data.objects.new(o['name'], me)
    sc.collection.objects.link(ob)
    mat = bpy.data.materials.new(o['name'])
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*[min(0.95, max(0.02, c)) for c in o['albedo']], 1)
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Specular IOR Level'].default_value = 0.0
    me.materials.append(mat)
    if o['role'] == 'receiver':
        # weld coincident corners so a wall face unwraps as one island (faces keep their 'orig' index)
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
        bm.to_mesh(me); bm.free()
        me.uv_layers.new(name='lightmap')
        receivers.append((ob, o))
log(f'{len(meta["objects"])} objects, {len(receivers)} receivers')

# ---------------------------------------------------------------- lightmap UVs
bpy.ops.object.select_all(action='DESELECT')
for ob, _ in receivers: ob.select_set(True)
bpy.context.view_layer.objects.active = receivers[0][0]
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
bpy.ops.uv.select_all(action='SELECT')
bpy.ops.uv.average_islands_scale()
bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
bpy.ops.object.mode_set(mode='OBJECT')
log('unwrapped')

# uv2 per receiver, in the app's triangle-corner order
uv_out, uv_index = [], []
off = 0
for ob, o in receivers:
    me = ob.data
    uv = np.zeros((o['tris'], 3, 2), dtype=np.float32)
    orig = np.zeros(len(me.polygons), dtype=np.int32)
    me.attributes['orig'].data.foreach_get('value', orig)
    lay = me.uv_layers['lightmap'].data
    for p in me.polygons:
        if p.loop_total != 3: continue
        for k, li in enumerate(p.loop_indices): uv[orig[p.index], k] = lay[li].uv
    uv_out.append(uv.reshape(-1))
    uv_index.append({'name': o['name'], 'tris': o['tris'], 'offset': off})
    off += o['tris'] * 6
np.concatenate(uv_out).astype(np.float32).tofile(os.path.join(OUT, 'uv2.bin'))

# ---------------------------------------------------------------- bake targets
img = bpy.data.images.new('lightmap', RES, RES, float_buffer=True, alpha=False)
for ob, _ in receivers:
    nt = ob.data.materials[0].node_tree
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
    nt.nodes.active = tex
# one object for all receivers and one for all occluders: Blender bakes (and re-syncs the scene) per object
def join(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    return bpy.context.view_layer.objects.active
rec_names = {o['name'] for _, o in receivers}
occluders = [o for o in sc.objects if o.type == 'MESH' and o.name not in rec_names]
if occluders: join(occluders)
target = join([ob for ob, _ in receivers])
bpy.ops.object.select_all(action='DESELECT')
target.select_set(True)
bpy.context.view_layer.objects.active = target
receivers = [(target, None)]

# ---------------------------------------------------------------- sun + sky
world = bpy.data.worlds.new('sky'); sc.world = world; world.use_nodes = True
bg = world.node_tree.nodes['Background']
sky = world.node_tree.nodes.new('ShaderNodeTexSky')
sky.sky_type = 'NISHITA'; sky.sun_disc = False; sky.altitude = 300
world.node_tree.links.new(sky.outputs['Color'], bg.inputs['Color'])
sun_data = bpy.data.lights.new('sun', 'SUN'); sun_data.angle = math.radians(0.53)
sun = bpy.data.objects.new('sun', sun_data); sc.collection.objects.link(sun)

def aim(t):
    d = t['dir']; bx, by, bz = d[0], -d[2], d[1]
    from mathutils import Vector
    sun.rotation_euler = (-Vector((bx, by, bz))).to_track_quat('-Z', 'Y').to_euler()
    sun_data.color = t['color']; sun_data.energy = t['strength']
    sky.sun_elevation = math.radians(max(t['elevation'], 0.5))
    sky.sun_rotation = math.atan2(bx, by)  # Nishita: rotation 0 = sun toward +Y, 90° = +X

def bake(pass_filter):
    bpy.ops.object.bake(type='DIFFUSE', pass_filter=pass_filter, margin=6, use_clear=True)
    return np.array(img.pixels[:], dtype=np.float32).reshape(RES, RES, 4)[:, :, :3].copy()

def sky_scale(t):
    """World strength so clear-sky light on open ground is SKY_RATIO_NOON × the noon sun (one factor for all times)."""
    sel = [o for o in bpy.context.selected_objects]
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0, 400)); pl = bpy.context.active_object
    pl.data.uv_layers.new(name='lightmap')
    m = bpy.data.materials.new('probe'); m.use_nodes = True
    tn = m.node_tree.nodes.new('ShaderNodeTexImage'); small = bpy.data.images.new('p', 4, 4, float_buffer=True); tn.image = small; m.node_tree.nodes.active = tn
    pl.data.materials.append(m)
    bpy.ops.object.select_all(action='DESELECT'); pl.select_set(True); bpy.context.view_layer.objects.active = pl
    aim(t); sun_data.energy = 0; bg.inputs['Strength'].default_value = 1.0
    cy.samples = 64
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT'}, margin=0, use_clear=True)
    up = float(np.array(small.pixels[:]).reshape(-1, 4)[:, :3].mean())
    cy.samples = SAMPLES
    bpy.data.objects.remove(pl)
    bpy.ops.object.select_all(action='DESELECT')
    for o in sel: o.select_set(True)
    bpy.context.view_layer.objects.active = target
    # lighting = E/π; want E_sky = ratio × sun strength
    return (SKY_RATIO_NOON * t['strength'] / math.pi) / max(up, 1e-6)

# which texels belong to a surface (incl. the bake margin): a normal-map bake costs no sampling
bpy.ops.object.bake(type='NORMAL', margin=6, use_clear=True)
MASK = (np.array(img.pixels[:], dtype=np.float32).reshape(RES, RES, 4)[:, :, :3].sum(axis=2) > 0.01).astype(np.float32)

def denoise(rgb, sigma=1.4):
    """Mask-normalized Gaussian: smooths Monte Carlo noise without pulling in the black atlas gaps.
    Islands are packed ≥ 8 px apart (incl. their extended margins), so a ~3-px kernel stays inside one."""
    r = int(math.ceil(sigma * 2.5)); x = np.arange(-r, r + 1); k = np.exp(-x * x / (2 * sigma * sigma)); k /= k.sum()
    def blur(a):
        a = np.apply_along_axis(lambda v: np.convolve(v, k, mode='same'), 0, a)
        return np.apply_along_axis(lambda v: np.convolve(v, k, mode='same'), 1, a)
    w = blur(MASK)
    out = np.stack([blur(rgb[:, :, c] * MASK) for c in range(3)], axis=2) / np.maximum(w[:, :, None], 1e-6)
    return out * MASK[:, :, None]

times = [t for t in meta['times'] if not ONLY or t['name'] in ONLY]
noon = next(t for t in meta['times'] if t['name'] == 'noon')
K = sky_scale(noon)
log(f'sky strength factor {K:.4f}')

results = {}
for t in times:
    aim(t); bg.inputs['Strength'].default_value = K
    log(f'{t["name"]}: indirect (sun + sky)…')
    ind = bake({'INDIRECT'})
    sun_data.energy = 0
    log(f'{t["name"]}: direct sky…')
    sky_direct = bake({'DIRECT'})
    sun_data.energy = t['strength']
    results[t['name']] = denoise(ind + sky_direct)
    log(f'{t["name"]}: mean {results[t["name"]].mean():.4f}, p99.9 {np.percentile(results[t["name"]], 99.9):.4f}')

# ambient occlusion (geometry only, time independent): ~4 ft reach
world.light_settings.distance = 1.2
log('ambient occlusion…')
bpy.ops.object.bake(type='AO', margin=6, use_clear=True)
ao = np.array(img.pixels[:], dtype=np.float32).reshape(RES, RES, 4)[:, :, 0].copy()

# ---------------------------------------------------------------- encode
def save_png(name, rgb):
    """8-bit sRGB-encoded PNG (rgb in 0..1, linear). Rows are bottom-up in Blender, as in WebGL."""
    out = bpy.data.images.new(name, RES, RES, alpha=False)
    out.colorspace_settings.name = 'Non-Color'
    enc = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(np.clip(rgb, 0.0031308, None), 1 / 2.4) - 0.055)
    px = np.ones((RES, RES, 4), dtype=np.float32); px[:, :, :3] = np.clip(enc, 0, 1)
    out.pixels.foreach_set(px.reshape(-1))
    out.filepath_raw = os.path.join(OUT, name + '.png'); out.file_format = 'PNG'
    sc.render.image_settings.color_depth = '8'
    out.save()

maxv = float(max(np.percentile(v, 99.95) for v in results.values())) if results else 1.0
for name, v in results.items(): save_png(name, np.clip(v / maxv, 0, 1))
save_png('ao', np.repeat(np.clip(ao, 0, 1)[:, :, None], 3, axis=2))

old = {}
mf = os.path.join(OUT, 'manifest.json')
if os.path.exists(mf) and ONLY:
    old = json.load(open(mf))
manifest = {
    'res': RES, 'samples': SAMPLES, 'maxValue': maxv, 'skyFactor': K,
    'times': [{'name': t['name'], 'hour': t['hour'], 'file': t['name'] + '.png'} for t in meta['times'] if t['name'] in results or t['name'] in {x['name'] for x in old.get('times', [])}],
    'ao': 'ao.png', 'uv2': 'uv2.bin', 'objects': uv_index,
    'note': 'lighting = irradiance/π, stored as sRGB PNG scaled by 1/maxValue',
}
json.dump(manifest, open(mf, 'w'), indent=1)
log('done →', OUT)
