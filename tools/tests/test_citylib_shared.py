"""Unit tests for the map tools' shared code (code review 27 Nov 2026, wave 2: P1 provenance and dated OSM, P8 shared
DEM / network / geometry). Run by test/pipeline-wave2.test.mjs:  python3 -m unittest discover -s tools/tests
Tests that need numpy, scipy or Pillow skip without them (CI's python3 has none)."""
import io, json, math, os, shutil, sys, tarfile, tempfile, unittest, urllib.error, urllib.parse
from unittest import mock

TOOLS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, TOOLS)
from citylib import geo, net, osm_source, provenance, offline  # noqa: E402
import cache_manifest  # noqa: E402

try:
    import numpy as np
    from PIL import Image
    HAVE_IMG = True
except ImportError:
    HAVE_IMG = False
try:
    import scipy  # noqa: F401
    HAVE_SCIPY = HAVE_IMG
except ImportError:
    HAVE_SCIPY = False


class Offline:
    def __enter__(self):
        self.old = os.environ.get('BIKEFREE_OFFLINE'); os.environ['BIKEFREE_OFFLINE'] = '1'
    def __exit__(self, *a):
        if self.old is None: os.environ.pop('BIKEFREE_OFFLINE', None)
        else: os.environ['BIKEFREE_OFFLINE'] = self.old


class Online:
    def __enter__(self):
        self.old = os.environ.pop('BIKEFREE_OFFLINE', None)
    def __exit__(self, *a):
        if self.old is not None: os.environ['BIKEFREE_OFFLINE'] = self.old


# ------------------------------------------------------------------ geometry
class Geo(unittest.TestCase):
    def test_haversine(self):
        self.assertAlmostEqual(geo.hv((0, 0), (1, 0)), 2 * math.pi * 6371008.8 / 360, places=6)   # a degree of latitude
        self.assertAlmostEqual(geo.hv((40.44, -80.0), (40.44, -80.0)), 0.0)
        a, b = (40.4413, -79.9985), (40.4420, -79.9555)
        self.assertAlmostEqual(geo.hv(a, b), geo.hv(b, a))
        self.assertAlmostEqual(geo.hv(a, b), 3639.6, delta=1.0)   # Downtown → Oakland, as the crow flies
        self.assertIs(geo.haversine, geo.hv)

    def test_one_haversine(self):
        """The copies are gone: every tool takes citylib.geo.hv."""
        bad = []
        for root, _, files in os.walk(TOOLS):
            if '.cache' in root or '__pycache__' in root or root.endswith('tests'): continue
            for n in files:
                if not n.endswith('.py') or n == 'geo.py': continue
                s = open(os.path.join(root, n), encoding='utf8').read()
                if 'math.sin((la2 - la1) / 2) ** 2' in s: bad.append(n)
        self.assertEqual(bad, [])

    def test_tiles(self):
        self.assertEqual(geo.tile_xy(0, 0, 1), (1.0, 1.0))
        x, y = geo.tile_xy(85.0511287798, -180, 0)
        self.assertAlmostEqual(x, 0); self.assertAlmostEqual(y, 0, places=6)   # the top-left corner of the world
        # global pixels are the tile coordinates × 256, exactly (the DEM sampler and the grid builder agree)
        for lat, lon in ((40.44, -79.99), (43.06, -76.32), (-33.9, 151.2)):
            tx, ty = geo.tile_xy(lat, lon, 14); px, py = geo.global_px(lat, lon, 14)
            self.assertEqual((tx * 256, ty * 256), (px, py))
            self.assertAlmostEqual(geo.lat_of_tile_y(ty, 14), lat, places=9)
            self.assertAlmostEqual(geo.lon_of_tile_x(tx, 14), lon, places=9)
        # Downtown Pittsburgh's z14 tile
        tx, ty = geo.tile_xy(40.4413, -79.9985, 14)
        self.assertEqual((int(tx), int(ty)), (4551, 6176))


# ------------------------------------------------------------------ network
class FakeResp(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): self.close()


class Net(unittest.TestCase):
    def test_offline_refuses_before_any_network(self):
        calls = []
        with Offline():
            with self.assertRaisesRegex(RuntimeError, r'offline: https://example\.org/x is not cached'):
                net.http_get('https://example.org/x', urlopen=lambda *a, **k: calls.append(a))
        self.assertEqual(calls, [])

    def test_retries_busy_answers_then_succeeds(self):
        n, slept = [0], []
        def urlopen(req, timeout):
            n[0] += 1
            self.assertEqual(timeout, 42)
            self.assertEqual(req.get_header('User-agent'), 'ua-test')
            if n[0] < 3: raise urllib.error.HTTPError(req.full_url, 503, 'busy', {}, None)
            return FakeResp(b'ok')
        with Online():
            self.assertEqual(net.http_get('https://example.org/y', timeout=42, headers={'User-Agent': 'ua-test'}, urlopen=urlopen, sleep=slept.append, backoff=1), b'ok')
        self.assertEqual(n[0], 3); self.assertEqual(slept, [1, 2])   # backoff 1 s, then 2 s

    def test_client_errors_are_not_retried(self):
        """400 / 509 go straight to the caller (the OSM fetchers split the box on them)."""
        n = [0]
        def urlopen(req, timeout):
            n[0] += 1; raise urllib.error.HTTPError(req.full_url, 400, 'too many nodes', {}, None)
        with Online(), self.assertRaises(urllib.error.HTTPError) as cm:
            net.http_get('https://example.org/z', urlopen=urlopen, sleep=lambda s: None)
        self.assertEqual(cm.exception.code, 400); self.assertEqual(n[0], 1)

    def test_gives_up_after_retries(self):
        n = [0]
        def urlopen(req, timeout):
            n[0] += 1; raise urllib.error.URLError('reset')
        with Online(), self.assertRaises(urllib.error.URLError):
            net.http_get('https://example.org/w', urlopen=urlopen, sleep=lambda s: None, retries=2)
        self.assertEqual(n[0], 3)

    def test_atomic_write(self):
        d = tempfile.mkdtemp()
        try:
            p = os.path.join(d, 'sub', 'f.bin')
            net.write_atomic(p, b'abc')
            self.assertEqual(open(p, 'rb').read(), b'abc'); self.assertEqual(os.listdir(os.path.dirname(p)), ['f.bin'])
            with Offline():   # (download: a cached file needs no network)
                self.assertEqual(net.download('https://example.org/f', p), p)
        finally: shutil.rmtree(d)

    def test_tools_use_it(self):
        """No map tool opens its own connection for OSM or the DEM any more."""
        for n in ('build_pgh.py', 'build_city.py', 'build_park_routes.py', 'build_terrain_grid.py', 'fetch_osm_corridor.py',
                  'fetch_commerce.py', 'cny_forest.py', 'citylib/warp.py', 'build_scene_terrain.py'):
            s = open(os.path.join(TOOLS, n), encoding='utf8').read()
            self.assertNotIn('urlopen(', s, n)
            self.assertNotIn('/ 256 - 32768', s, n)   # (the terrarium decode: citylib/dem.py)


# ------------------------------------------------------------------ dated OSM queries
class OsmSource(unittest.TestCase):
    def test_live_urls_unchanged(self):
        """No osmDate: the same OSM API URLs the tools fetched before."""
        s, w, n, e = 40.44, -80.01, 40.448, -80.0
        self.assertEqual(osm_source.map_url(s, w, n, e), 'https://api.openstreetmap.org/api/0.6/map?bbox=-80.01000,40.44000,-80.00000,40.44800')
        self.assertEqual(osm_source.map_url(s, w, n, e, None, fmt='.4f'), 'https://api.openstreetmap.org/api/0.6/map?bbox=-80.0100,40.4400,-80.0000,40.4480')
        self.assertEqual(osm_source.map_url(43.058, -76.292, 43.082, -76.262, fmt=None), 'https://api.openstreetmap.org/api/0.6/map?bbox=-76.292,43.058,-76.262,43.082')
        self.assertEqual(osm_source.relation_url(123), 'https://api.openstreetmap.org/api/0.6/relation/123/full')
        self.assertEqual(osm_source.cache_dir('C', 'osm-pgh'), os.path.join('C', 'osm-pgh'))

    def test_dated_overpass_query(self):
        url = osm_source.map_url(40.44, -80.01, 40.448, -80.0, '2024-03-01')
        base, q = url.split('?data=')
        self.assertEqual(base, 'https://overpass-api.de/api/interpreter')
        q = urllib.parse.unquote(q)
        self.assertEqual(q, '[out:xml][timeout:300][date:"2024-03-01T00:00:00Z"];(node(40.44,-80.01,40.448,-80);<;)->.up;(way.up;>;)->.wn;(.up;.wn;);out meta;')
        r = urllib.parse.unquote(osm_source.relation_url(42, '2024-03-01T12:30:00Z').split('?data=')[1])
        self.assertEqual(r, '[out:xml][timeout:300][date:"2024-03-01T12:30:00Z"];relation(42);(._;>;);out meta;')
        self.assertEqual(osm_source.cache_dir('C', 'osm-pgh', '2024-03-01'), os.path.join('C', 'osm-pgh@2024-03-01'))
        self.assertIn('2024-03-01T00:00:00Z', osm_source.source('2024-03-01'))
        with mock.patch.dict(os.environ, {'BIKEFREE_OVERPASS': 'https://op.example/api/interpreter'}):
            self.assertTrue(osm_source.map_url(1, 2, 3, 4, '2024-01-01').startswith('https://op.example/api/interpreter?data='))

    def test_dates_checked(self):
        self.assertIsNone(osm_source.config_date({})); self.assertIsNone(osm_source.config_date({'osmDate': ''}))
        self.assertEqual(osm_source.config_date({'osmDate': '2025-12-31'}), '2025-12-31T00:00:00Z')
        for bad in ('2025-13-01', '2025/01/01', '2025-01-01T25:00:00Z', 20250101, '2010-01-01'):
            with self.assertRaises(ValueError, msg=bad): osm_source.norm_date(bad)

    def test_configs_valid(self):
        """Any osmDate a map config sets is one Overpass takes."""
        d = os.path.join(TOOLS, 'city')
        for n in sorted(os.listdir(d)):
            if n.endswith('.json'):
                cfg = json.load(open(os.path.join(d, n)))
                if isinstance(cfg, dict): osm_source.config_date(cfg)

    def test_city_dir(self):
        cache = os.path.join(os.path.dirname(TOOLS), 'tools', '.cache')
        cfg = json.load(open(os.path.join(TOOLS, 'city', 'pgh.json')))
        want = osm_source.cache_dir(cache, 'osm-pgh', osm_source.config_date(cfg))
        self.assertEqual(osm_source.city_dir('pgh'), want)
        self.assertEqual(osm_source.city_dir('no-such-map', 'C'), os.path.join('C', 'osm-no-such-map'))
        # the later steps of a map read its tiles through it (a pinned date's tiles, not the live ones)
        for n in ('pgh_city.py', 'nyc_pools.py', 'cny_heroes.py', 'pgh_riverbank.py', 'nyc_heroes.py', 'skan_heroes.py', 'pgh_landmarks.py'):
            src = open(os.path.join(TOOLS, n), encoding='utf8').read().split('"""', 2)[-1]   # (the code, not the docstring)
            src = '\n'.join(l.split('#')[0] for l in src.split('\n'))
            self.assertNotRegex(src, r"\.cache[/'\", ]+'?osm-(pgh|nyc|cny|skan|\{CITY\})", n)

    def test_tools_route_through_it(self):
        for n in ('build_pgh.py', 'build_city.py', 'fetch_osm_corridor.py', 'fetch_commerce.py', 'cny_forest.py'):
            s = open(os.path.join(TOOLS, n), encoding='utf8').read()
            self.assertNotIn('api.openstreetmap.org', s.split('"""', 2)[-1], n)   # (outside the docstring)
            self.assertIn('osm_source.', s.replace('_osm.', 'osm_source.'), n)


# ------------------------------------------------------------------ provenance and the cache manifest
class Cache(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.cache = os.path.join(self.d, 'cache')
        for name, body in (('osm-tst/t_1.osm', b'<osm>1</osm>'), ('osm-tst/t_2.osm', b'<osm>2</osm>'), ('dem-14-1-2.png', b'png'),
                           ('dem-14-9-9.png', b'other map'), ('osm-other/t.osm', b'x')):
            p = os.path.join(self.cache, name); os.makedirs(os.path.dirname(p), exist_ok=True); open(p, 'wb').write(body)
            os.utime(p, (1764000000, 1764000000))   # 2025-11-24
        provenance.reset()

    def tearDown(self):
        shutil.rmtree(self.d); provenance.reset()

    def test_provenance_block(self):
        provenance.used(os.path.join(self.cache, 'osm-tst/t_1.osm'), os.path.join(self.cache, 'dem-14-1-2.png'))
        provenance.bbox(40.0, -80.0, 40.1, -79.9); provenance.bbox(39.9, -80.05, 40.05, -79.95)
        with mock.patch.object(provenance, 'CACHE', self.cache):
            b = provenance.block(os.path.join(TOOLS, 'cache_manifest.py'), ['OSM'], map_id='tst', osm_date='2024-01-01T00:00:00Z')
            self.assertEqual(b, provenance.block(os.path.join(TOOLS, 'cache_manifest.py'), ['OSM'], map_id='tst', osm_date='2024-01-01T00:00:00Z'))   # (no clock in it)
            used = json.load(open(os.path.join(self.cache, 'used-tst.json')))
        self.assertEqual(b['tool'], 'tools/cache_manifest.py'); self.assertEqual(len(b['toolSha256']), 12)
        self.assertEqual(b['bbox'], [39.9, -80.05, 40.1, -79.9]); self.assertEqual(b['osmDate'], '2024-01-01T00:00:00Z')
        self.assertEqual(b['inputs']['files'], 2); self.assertEqual(b['inputs']['bytes'], 15)
        self.assertEqual(b['inputs']['fetched'], ['2025-11-24', '2025-11-24'])
        self.assertEqual(used['files'], ['dem-14-1-2.png', 'osm-tst/t_1.osm'])

    def test_manifest_write_verify_pack_unpack(self):
        provenance.write_used('tst', [os.path.join(self.cache, 'dem-14-1-2.png')], cache=self.cache)
        m = cache_manifest.write(self.cache, 'tst')
        self.assertEqual([e['name'] for e in m['files']], ['dem-14-1-2.png', 'osm-tst/t_1.osm', 'osm-tst/t_2.osm', 'used-tst.json'])
        self.assertEqual(cache_manifest.verify(self.cache, 'tst'), [])
        # the manifest's digest is the provenance digest of the same files
        files = [os.path.join(self.cache, e['name']) for e in m['files']]
        self.assertEqual(provenance.describe(files, self.cache)['sha256'], m['sha256'])
        # pack: the manifest first, then the files; no time in the gzip header; owner stripped
        out = cache_manifest.pack(self.cache, 'tst', os.path.join(self.d, 'p.tar.gz'))
        self.assertEqual(open(out, 'rb').read()[4:8], b'\0\0\0\0')
        with tarfile.open(out) as t:
            self.assertEqual(t.getnames(), ['manifest-tst.json'] + [e['name'] for e in m['files']])
            self.assertTrue(all(x.uid == 0 and x.uname == '' for x in t.getmembers()))
        self.assertEqual(open(out, 'rb').read(), open(cache_manifest.pack(self.cache, 'tst', os.path.join(self.d, 'q.tar.gz')), 'rb').read())
        # unpack into an empty cache: verified
        other = os.path.join(self.d, 'restored')
        self.assertEqual(cache_manifest.unpack(out, other), 'tst')
        self.assertEqual(open(os.path.join(other, 'osm-tst/t_2.osm'), 'rb').read(), b'<osm>2</osm>')

    def test_verify_finds_changes(self):
        cache_manifest.write(self.cache, 'tst')
        open(os.path.join(self.cache, 'osm-tst/t_1.osm'), 'wb').write(b'<osm>edited</osm>')
        os.remove(os.path.join(self.cache, 'osm-tst/t_2.osm'))
        self.assertEqual(cache_manifest.verify(self.cache, 'tst'), ['changed osm-tst/t_1.osm', 'missing osm-tst/t_2.osm'])
        with self.assertRaises(SystemExit): cache_manifest.pack(self.cache, 'tst')
        self.assertEqual(cache_manifest.main(['verify', 'tst', '--cache', self.cache]), 1)
        # a hand-edited manifest is caught by its digest
        p = cache_manifest.manifest_path(self.cache, 'tst'); m = json.load(open(p)); m['files'][0]['size'] += 1; json.dump(m, open(p, 'w'))
        self.assertIn('digest (the manifest was edited)', cache_manifest.verify(self.cache, 'tst'))
        self.assertTrue(cache_manifest.verify(self.cache, 'nothing')[0].startswith('no manifest'))

    def test_unpack_refuses_unsafe_paths(self):
        bad = os.path.join(self.d, 'bad.tar.gz')
        with tarfile.open(bad, 'w:gz') as t:
            for n in ('manifest-x.json', '../escape'):
                ti = tarfile.TarInfo(n); ti.size = 2; t.addfile(ti, io.BytesIO(b'{}'))
        with self.assertRaisesRegex(SystemExit, 'unsafe path'): cache_manifest.unpack(bad, os.path.join(self.d, 'u'))


# ------------------------------------------------------------------ the DEM
@unittest.skipUnless(HAVE_IMG, 'needs numpy and Pillow')
class Dem(unittest.TestCase):
    def setUp(self):
        from citylib import dem
        self.dem = dem
        self.d = tempfile.mkdtemp()
        self.p = [mock.patch.object(dem, 'CACHE', self.d), mock.patch.object(dem, 'LEGACY', os.path.join(self.d, 'legacy'))]
        for p in self.p: p.start()
        provenance.reset()

    def tearDown(self):
        for p in self.p: p.stop()
        shutil.rmtree(self.d); provenance.reset()

    def tile(self, z, x, y, fn):
        """A terrarium tile whose pixel (i, j) has height fn(i, j)."""
        h = np.array([[fn(i, j) for i in range(256)] for j in range(256)], np.float64) + 32768
        r = np.floor(h / 256); g = np.floor(h - r * 256); b = np.round((h - r * 256 - g) * 256)
        Image.fromarray(np.stack([r, g, b], -1).astype(np.uint8), 'RGB').save(self.dem.tile_path(z, x, y))

    def test_decode(self):
        d = self.dem.decode
        self.assertEqual(d(128, 0, 0), 0); self.assertEqual(d(0, 0, 0), -32768); self.assertEqual(d(128, 100, 128), 100.5)
        self.assertEqual(d(np.array([128, 129]), np.array([0, 1]), np.array([64, 0])).tolist(), [0.25, 257.0])
        self.assertEqual(self.dem.tile_url(14, 4552, 6185), 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/4552/6185.png')

    def test_bilinear_on_pixel_centres(self):
        for x in (10, 11):
            for y in (20, 21):
                self.tile(14, x, y, lambda i, j, x=x, y=y: 100 + (x * 256 + i) * 0.5 + (y * 256 + j) * 0.25 - 2560 - 1280)
        S = self.dem.Sampler(14)
        self.enterContext(Offline())   # (only the tiles above: nothing is fetched)
        # a pixel's centre gives the pixel; between centres, the plane through them
        for gx, gy in ((2816.0, 5376.0), (2816.5, 5376.5), (2900.25, 5400.75), (3071.3, 5631.4), (2815.7, 5377.0)):
            lon = geo.lon_of_tile_x(gx / 256, 14); lat = geo.lat_of_tile_y(gy / 256, 14)
            want = 100 + (gx - .5) * 0.5 + (gy - .5) * 0.25 - 2560 - 1280
            self.assertAlmostEqual(S(lat, lon), want, places=1)
        self.assertEqual(len(provenance.used_files()), 4)   # every tile read is noted (the first point is on the tiles' corner)

    def test_nodata_falls_back_to_coarser(self):
        self.tile(14, 10, 20, lambda i, j: -32768)
        self.tile(13, 5, 10, lambda i, j: 321)
        lat, lon = geo.lat_of_tile_y(20.5, 14), geo.lon_of_tile_x(10.5, 14)
        self.enterContext(Offline())
        self.assertLess(self.dem.Sampler(14)(lat, lon), -30000)
        self.assertAlmostEqual(self.dem.Sampler(14, nodata_fallback=True)(lat, lon), 321)

    def test_offline_and_legacy_cache(self):
        with Offline(), self.assertRaisesRegex(RuntimeError, r'terrarium/14/1/2\.png is not cached'):
            self.dem.fetch_tile(14, 1, 2)
        os.makedirs(self.dem.LEGACY)
        self.tile(14, 3, 4, lambda i, j: 7); shutil.move(self.dem.tile_path(14, 3, 4), os.path.join(self.dem.LEGACY, '14-3-4.png'))
        with Offline():   # (a tile build_terrain_grid.py cached in its old place is still read)
            self.assertEqual(self.dem.tile_heights(14, 3, 4)[0, 0], 7)
            self.assertEqual(self.dem.tile_heights(14, 3, 4, dtype=np.float32).dtype, np.float32)


# ------------------------------------------------------------------ the warp (fwd / inverse)
@unittest.skipUnless(HAVE_SCIPY, 'needs numpy, scipy and Pillow')
class Warp(unittest.TestCase):
    def test_round_trip(self):
        from citylib import warp
        d = tempfile.mkdtemp()
        try:
            lat0, lon0 = 45.0, -110.0
            kx = 111320 * math.cos(math.radians(lat0))
            line = [[lat0, lon0 + k * 1000 / kx] for k in range(0, 31)]   # 30 km due east from the town
            lines = os.path.join(d, 'lines.json')
            with open(lines, 'w') as f: json.dump({'lines': [{'name': 'east', 'pts': line}]}, f)
            cfg = {'area': {'lines': lines}, 'warp': {'center': [lat0, lon0], 'captureM': 3000, 'cuts': [{'line': 'east', 'fromKm': 5, 'toKm': 10}]}}
            flat = lambda la, lo: np.zeros(np.shape(la))
            with mock.patch.object(warp.Dem, '__call__', lambda self, la, lo: flat(la, lo)):
                W = warp.Warp('test', cfg)
            far = (lat0, lon0 + 20000 / kx)                     # 20 km out: 5 km nearer the town once warped
            q = W.fwd(*far)
            self.assertAlmostEqual(W.xy(*q)[0], 15000, delta=1); self.assertAlmostEqual(W.xy(*q)[1], 0, delta=1)
            back = W.inv(*q)
            self.assertAlmostEqual(back[0], far[0], places=7); self.assertAlmostEqual(back[1], far[1], places=7)
            self.assertIsNone(W.fwd(lat0, lon0 + 7000 / kx))    # inside the cut: gone
            near = (lat0 + 0.001, lon0 + 2000 / kx)             # before the cut: not moved
            for got, want in ((W.fwd(*near), near), (W.inv(*W.fwd(*near)), near)):
                self.assertAlmostEqual(got[0], want[0], places=9); self.assertAlmostEqual(got[1], want[1], places=9)
            wild = (lat0 + 0.2, lon0)                           # owned by no line: not moved, both ways
            for got in (W.fwd(*wild), W.inv(*wild)):
                self.assertAlmostEqual(got[0], wild[0], places=9); self.assertAlmostEqual(got[1], wild[1], places=9)
        finally: shutil.rmtree(d)


if __name__ == '__main__':
    unittest.main()
