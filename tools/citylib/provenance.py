"""What a generated map was built from (code review P1): every map file the tools write carries a "provenance" block —

    {"tool": "tools/build_pgh.py", "toolSha256": "<12 hex: the tool's source>",
     "sources": ["OpenStreetMap API 0.6, live at fetch time (ODbL)", "AWS Terrain Tiles (terrarium z14)"],
     "osmDate": "2026-11-01T00:00:00Z",                       (only when the config pins one: citylib/osm_source.py)
     "bbox": [south, west, north, east],                      (the boxes fetched)
     "inputs": {"files": 812, "bytes": 412000000, "sha256": "<the cache files' digest>",
                "fetched": ["2026-11-02", "2026-11-20"]}}     (the oldest and newest input file's date)

`inputs.sha256` is the digest tools/cache_manifest.py computes over the same files, so a manifest of the cache (and the
tarball packed from it) can be matched to the map that was built from it. The block uses no clock: the same inputs and
tool give the same bytes (P3), however often it is rebuilt.

    used(path, …)            note a cache file the build read (citylib/dem.py and the OSM fetchers call it)
    bbox(s, w, n, e)         note a box the build fetched
    block(tool, sources, …)  the block for the output (also writes tools/.cache/used-<map>.json for cache_manifest.py)
"""
import datetime, hashlib, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(ROOT, 'tools', '.cache')
DEM_SOURCE = 'AWS Terrain Tiles (terrarium z14; USGS 3DEP and others)'
_used = set()
_bbox = None


def reset():
    global _bbox
    _used.clear(); _bbox = None


def used(*paths):
    for p in paths: _used.add(os.path.abspath(p))


def used_files():
    return sorted(_used)


def bbox(s, w, n, e):
    global _bbox
    b = (s, w, n, e)
    _bbox = b if _bbox is None else (min(_bbox[0], s), min(_bbox[1], w), max(_bbox[2], n), max(_bbox[3], e))


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''): h.update(chunk)
    return h.hexdigest()


def cache_name(path, cache=None):
    """A cache file's name in manifests: its path under tools/.cache (others: their path under the home folder)."""
    cache = os.path.abspath(cache or CACHE)
    p = os.path.abspath(path)
    if p.startswith(cache + os.sep): return os.path.relpath(p, cache).replace(os.sep, '/')
    home = os.path.expanduser('~')
    if p.startswith(home + os.sep): return '~/' + os.path.relpath(p, home).replace(os.sep, '/')
    return p


def digest(entries):
    """sha256 over the sorted (name, sha256, size) of a set of files: the same files give the same digest."""
    h = hashlib.sha256()
    for name, sha, size in sorted(entries): h.update(f'{name}\t{sha}\t{size}\n'.encode())
    return h.hexdigest()


def day(t):
    return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime('%Y-%m-%d')


def describe(files, cache=None):
    entries, dates, total = [], [], 0
    for p in files:
        size = os.path.getsize(p)
        entries.append((cache_name(p, cache), sha256_file(p), size)); total += size
        dates.append(day(os.path.getmtime(p)))
    out = {'files': len(entries), 'bytes': total, 'sha256': digest(entries)}
    if dates: out['fetched'] = [min(dates), max(dates)]
    return out


def tool_sha(tool):
    return sha256_file(tool)[:12]


def block(tool, sources, map_id=None, osm_date=None, box=None, files=None, extra=None):
    files = used_files() if files is None else sorted(os.path.abspath(f) for f in files)
    b = box or _bbox
    out = {'tool': os.path.relpath(os.path.abspath(tool), ROOT).replace(os.sep, '/'), 'toolSha256': tool_sha(tool),
           'sources': list(sources)}
    if osm_date: out['osmDate'] = osm_date
    if b: out['bbox'] = [round(v, 5) for v in b]
    out['inputs'] = describe(files)
    if extra: out.update(extra)
    if map_id: write_used(map_id, files)
    return out


def write_used(map_id, files, cache=None):
    """tools/.cache/used-<map>.json: the cache files this map's last build read (cache_manifest.py picks them up)."""
    cache = cache or CACHE
    path = os.path.join(cache, f'used-{map_id}.json')
    old = []
    if os.path.exists(path):
        try: old = json.load(open(path)).get('files', [])
        except ValueError: old = []
    names = sorted(set(old) | {cache_name(f, cache) for f in files})
    os.makedirs(cache, exist_ok=True)
    with open(path + '.part', 'w') as f: json.dump({'map': map_id, 'files': names}, f, indent=0)
    os.replace(path + '.part', path)
    return path
