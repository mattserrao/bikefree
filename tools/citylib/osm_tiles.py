"""The OSM tiles a city's build reads (code review P2): tools/build_pgh.py caches the API's tiles in
tools/.cache/osm-<city>/ as t_<south>_<west>_<depth>.osm, each osmTile / 2^depth degrees (a tile the API refused as too
big was split in four, depth + 1). tools/pgh_city.py reads only the tiles that overlap the current box — a larger old
box's tiles left in the folder are not the city's — and stops when there are none, instead of writing an empty city."""
import glob, os, re

NAME = re.compile(r'^t_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)_(\d+)\.osm$')


def tiles_in_box(folder, box, tile):
    """(kept, stale, unknown): the .osm files in `folder` overlapping box (south, west, north, east), the ones outside it,
    and files whose names aren't t_<s>_<w>_<depth>.osm. `tile` is the config's osmTile [dx (lon), dy (lat)]."""
    s, w, n, e = box
    dx, dy = tile
    kept, stale, unknown = [], [], []
    for f in sorted(glob.glob(os.path.join(folder, '*.osm'))):
        m = NAME.match(os.path.basename(f))
        if not m: unknown.append(f); continue
        ts, tw, depth = float(m.group(1)), float(m.group(2)), int(m.group(3))
        tn, te = ts + dy / 2 ** depth, tw + dx / 2 ** depth
        (kept if ts < n and tn > s and tw < e and te > w else stale).append(f)
    return kept, stale, unknown


def require_tiles(folder, box, tile, city):
    """The tiles to read, or SystemExit naming the problem (no tiles: run tools/build_pgh.py first)."""
    kept, stale, unknown = tiles_in_box(folder, box, tile)
    if stale: print(f'  OSM: {len(stale)} tiles in {folder} lie outside the box (an older, larger box?) — not read')
    if unknown: print(f'  OSM: {len(unknown)} files in {folder} are not t_<s>_<w>_<depth>.osm — not read')
    if not kept:
        raise SystemExit(f'pgh_city: no OSM tiles for {city} inside its box in {folder} — run python3 tools/build_pgh.py --city {city} first '
                         f'(nothing written)')
    return kept


def check_nodes(count, floor, city):
    """Stop rather than overwrite the committed city with a near-empty one."""
    if count < floor:
        raise SystemExit(f'pgh_city: only {count} OSM nodes read for {city} (floor {floor}, config osmMinNodes) — the tiles are '
                         f'missing or truncated; nothing written')
