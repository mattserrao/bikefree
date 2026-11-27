"""Where the map tools get OpenStreetMap from (code review P1: reproducible map builds).

By default the tools call the OSM API (api.openstreetmap.org/api/0.6/map, …/relation/<id>/full): the map as it is
today, so a rebuild next month fetches different data. A map config (tools/city/<id>.json) may pin a date:

    "osmDate": "2026-11-01"            (or "2026-11-01T12:00:00Z")

and every OSM fetch of that map goes to the Overpass API instead, with `[date:"…"]` — the map as it was then, the
same on every rebuild. The Overpass query returns what the API's map call does (every node in the box, every way and
relation using one of them, every node of those ways), as OSM XML with metadata, so the parsers do not change. Dated
tiles are cached in their own folder (osm-<id>@<date>), never mixed with live ones.

    map_url(s, w, n, e, date=None, fmt='.5f')   the URL for one box (fmt: how the API URL writes the numbers)
    relation_url(rid, date=None)                one relation, its members and their nodes
    cache_dir(cache, name, date=None)           the cache folder for a map's tiles
    city_dir(city)                              that folder for a graph map, by its config (the later steps read it)
    source(date)                                the line for the output's provenance
Set BIKEFREE_OVERPASS to use another Overpass server.
"""
import os, re, urllib.parse

OSM_API = 'https://api.openstreetmap.org/api/0.6'
OVERPASS_DEFAULT = 'https://overpass-api.de/api/interpreter'
FIRST_ATTIC = '2012-09-12T06:55:00Z'   # Overpass has no history before the ODbL licence change


def overpass_url():
    return os.environ.get('BIKEFREE_OVERPASS') or OVERPASS_DEFAULT


def norm_date(d):
    """'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM:SSZ' → the full form Overpass takes; None stays None."""
    if d is None or d == '': return None
    if not isinstance(d, str): raise ValueError(f'osmDate: {d!r} is not a string')
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', d): d += 'T00:00:00Z'
    if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\dZ', d):
        raise ValueError(f'osmDate: {d!r} is not YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ')
    if d < FIRST_ATTIC: raise ValueError(f'osmDate: {d} is before {FIRST_ATTIC[:10]}, the first date Overpass has')
    return d


def config_date(cfg):
    return norm_date((cfg or {}).get('osmDate'))


def _num(v, fmt):
    return format(v, fmt) if fmt else str(v)


def map_query(s, w, n, e, date):
    bb = ','.join(f'{v:.7f}'.rstrip('0').rstrip('.') for v in (s, w, n, e))
    return (f'[out:xml][timeout:300][date:"{norm_date(date)}"];'
            f'(node({bb});<;)->.up;(way.up;>;)->.wn;(.up;.wn;);out meta;')


def relation_query(rid, date):
    return f'[out:xml][timeout:300][date:"{norm_date(date)}"];relation({int(rid)});(._;>;);out meta;'


def _overpass(q):
    return overpass_url() + '?data=' + urllib.parse.quote(q, safe='')


def map_url(s, w, n, e, date=None, fmt='.5f'):
    if not date:
        return f'{OSM_API}/map?bbox={_num(w, fmt)},{_num(s, fmt)},{_num(e, fmt)},{_num(n, fmt)}'
    return _overpass(map_query(s, w, n, e, date))


def relation_url(rid, date=None):
    if not date: return f'{OSM_API}/relation/{rid}/full'
    return _overpass(relation_query(rid, date))


def cache_dir(cache, name, date=None):
    return os.path.join(cache, name if not date else f'{name}@{norm_date(date)[:10]}')


def city_dir(city, cache=None):
    """tools/.cache/osm-<city> — or osm-<city>@<date> when tools/city/<city>.json pins an osmDate: the folder the later
    steps of a map (its city layer, heroes, landmarks) read the tiles tools/build_pgh.py fetched from."""
    import json
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    path = os.path.join(root, 'tools', 'city', f'{city}.json')
    cfg = json.load(open(path)) if os.path.exists(path) else {}
    return cache_dir(cache or os.path.join(root, 'tools', '.cache'), f'osm-{city}', config_date(cfg if isinstance(cfg, dict) else {}))


def source(date=None):
    if date: return f'OpenStreetMap via the Overpass API, as of {norm_date(date)} (ODbL)'
    return 'OpenStreetMap API 0.6, live at fetch time (ODbL)'
