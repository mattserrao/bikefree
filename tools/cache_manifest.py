#!/usr/bin/env python3
"""The download cache behind a map, listed, checked and packed (code review P1: reproducible map builds).

    python3 tools/cache_manifest.py write  <map>            list the map's cache files → tools/.cache/manifest-<map>.json
    python3 tools/cache_manifest.py verify <map>            re-hash them against the manifest (exit 1: missing/changed)
    python3 tools/cache_manifest.py pack   <map> [--out F]  verify, then write one tarball of the manifest and the files
                                                            (default tools/.cache/packs/<map>-cache-<sha12>.tar.gz) —
                                                            for keeping or uploading somewhere; nothing is uploaded
    python3 tools/cache_manifest.py unpack <tarball>        extract a pack into the cache and verify it
    options: --cache DIR (default tools/.cache), --include GLOB (more files, relative to the cache; repeatable)

A map's files: its OSM folders (osm-<map>/, osm-<map>@<date>/, osm-commerce-<map>/…, <map>-*/ such as cny-forest/,
warp-<map>-*), and every file its last build read (tools/.cache/used-<map>.json, which the build tools write through
citylib/provenance.py: the shared DEM tiles and WorldCover rasters it used). Scenes are "scene-<id>", park routes
"park-<id>".

The manifest's "sha256" is the digest of (name, sha256, size) over its files — the same number a map built from
exactly these files carries in its output's provenance.inputs.sha256.
"""
import glob, gzip, json, os, sys, tarfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from citylib import provenance  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FORMAT = 'bikefree-cache-manifest-1'


def _opt(args, name, many=False):
    out = []
    while name in args:
        i = args.index(name); out.append(args[i + 1]); del args[i:i + 2]
    return out if many else (out[-1] if out else None)


def resolve(cache, name):
    return os.path.expanduser(name) if name.startswith('~/') else name if os.path.isabs(name) else os.path.join(cache, name)


def map_files(cache, mid, include=()):
    """The absolute paths of the map's cache files (sorted, no manifests, packs or partial downloads)."""
    pats = [f'osm-{mid}/**', f'osm-{mid}@*/**', f'osm-commerce-{mid}/**', f'osm-commerce-{mid}@*/**', f'{mid}-*/**',
            f'warp-{mid}-*', f'used-{mid}.json', *include]
    found = set()
    for p in pats:
        for f in glob.glob(os.path.join(cache, p), recursive=True):
            if os.path.isfile(f): found.add(os.path.abspath(f))
    used = os.path.join(cache, f'used-{mid}.json')
    if os.path.exists(used):
        for name in json.load(open(used)).get('files', []):
            f = resolve(cache, name)
            if os.path.isfile(f): found.add(os.path.abspath(f))
            else: print(f'  {mid}: {name} (read by its last build) is not in the cache')
    skip = lambda f: f.endswith('.part') or os.path.basename(f).startswith('manifest-') or f.startswith(os.path.join(os.path.abspath(cache), 'packs') + os.sep)
    return sorted(f for f in found if not skip(f))


def manifest(cache, mid, include=()):
    entries = []
    for f in map_files(cache, mid, include):
        entries.append({'name': provenance.cache_name(f, cache), 'size': os.path.getsize(f), 'sha256': provenance.sha256_file(f),
                        'fetched': provenance.day(os.path.getmtime(f))})
    entries.sort(key=lambda e: e['name'])
    return {'format': FORMAT, 'map': mid, 'files': entries, 'count': len(entries), 'bytes': sum(e['size'] for e in entries),
            'sha256': provenance.digest([(e['name'], e['sha256'], e['size']) for e in entries])}


def manifest_path(cache, mid):
    return os.path.join(cache, f'manifest-{mid}.json')


def write(cache, mid, include=()):
    m = manifest(cache, mid, include)
    if not m['files']: raise SystemExit(f'{mid}: no cache files under {cache}')
    path = manifest_path(cache, mid)
    with open(path + '.part', 'w') as f: json.dump(m, f, indent=1); f.write('\n')
    os.replace(path + '.part', path)
    print(f'{mid}: {m["count"]} files, {m["bytes"] / 1e6:.1f} MB, sha256 {m["sha256"][:12]} → {os.path.relpath(path, ROOT) if path.startswith(ROOT) else path}')
    return m


def verify(cache, mid, m=None):
    """[problems]: 'missing <name>', 'changed <name>', 'digest' (an edited manifest). Empty: the cache matches."""
    if m is None:
        path = manifest_path(cache, mid)
        if not os.path.exists(path): return [f'no manifest {path} (run: cache_manifest.py write {mid})']
        m = json.load(open(path))
    bad = []
    if m.get('format') != FORMAT: bad.append(f'format {m.get("format")!r}')
    if provenance.digest([(e['name'], e['sha256'], e['size']) for e in m['files']]) != m.get('sha256'): bad.append('digest (the manifest was edited)')
    for e in m['files']:
        f = resolve(cache, e['name'])
        if not os.path.isfile(f): bad.append(f'missing {e["name"]}')
        elif os.path.getsize(f) != e['size'] or provenance.sha256_file(f) != e['sha256']: bad.append(f'changed {e["name"]}')
    return bad


def arcname(name):
    return '_home/' + name[2:] if name.startswith('~/') else name.lstrip('/')


def pack(cache, mid, out=None):
    path = manifest_path(cache, mid)
    if not os.path.exists(path): raise SystemExit(f'{mid}: no manifest (run: cache_manifest.py write {mid})')
    m = json.load(open(path))
    bad = verify(cache, mid, m)
    if bad: raise SystemExit(f'{mid}: the cache does not match its manifest:\n  ' + '\n  '.join(bad[:20]))
    out = out or os.path.join(cache, 'packs', f'{mid}-cache-{m["sha256"][:12]}.tar.gz')
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)

    def info(name, size, mtime):
        ti = tarfile.TarInfo(name); ti.size, ti.mtime, ti.mode = size, int(mtime), 0o644
        ti.uid = ti.gid = 0; ti.uname = ti.gname = ''
        return ti
    with open(out + '.part', 'wb') as raw, gzip.GzipFile(filename='', fileobj=raw, mode='wb', compresslevel=6, mtime=0) as gz, tarfile.open(fileobj=gz, mode='w', format=tarfile.PAX_FORMAT) as tar:
        body = open(path, 'rb').read()
        import io
        tar.addfile(info(os.path.basename(path), len(body), os.path.getmtime(path)), io.BytesIO(body))
        for e in m['files']:
            f = resolve(cache, e['name'])
            with open(f, 'rb') as fh: tar.addfile(info(arcname(e['name']), e['size'], os.path.getmtime(f)), fh)
    os.replace(out + '.part', out)
    print(f'{mid}: packed {m["count"]} files ({m["bytes"] / 1e6:.1f} MB) → {out} ({os.path.getsize(out) / 1e6:.1f} MB)')
    return out


def unpack(tarball, cache):
    os.makedirs(cache, exist_ok=True)
    with tarfile.open(tarball, 'r:*') as tar:
        names = tar.getnames()
        mf = [n for n in names if n.startswith('manifest-') and n.endswith('.json') and '/' not in n]
        if len(mf) != 1: raise SystemExit(f'{tarball}: not a cache pack (no manifest-<map>.json at its top)')
        for n in names:
            if n.startswith('/') or '..' in n.split('/'): raise SystemExit(f'{tarball}: unsafe path {n}')
        home = [t for t in tar.getmembers() if t.name.startswith('_home/')]
        tar.extractall(cache, members=[t for t in tar.getmembers() if not t.name.startswith('_home/')], filter='data')
        for t in home:   # (files that lived under the home folder: back there)
            dest = os.path.join(os.path.expanduser('~'), t.name[len('_home/'):])
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with tar.extractfile(t) as src, open(dest + '.part', 'wb') as dst: dst.write(src.read())
            os.replace(dest + '.part', dest)
    mid = json.load(open(os.path.join(cache, mf[0])))['map']
    bad = verify(cache, mid)
    if bad: raise SystemExit(f'{mid}: unpacked, but the cache does not match:\n  ' + '\n  '.join(bad[:20]))
    print(f'{mid}: unpacked and verified into {cache}')
    return mid


def main(argv):
    args = list(argv)
    cache = os.path.abspath(_opt(args, '--cache') or provenance.CACHE)
    include = _opt(args, '--include', many=True)
    out = _opt(args, '--out')
    if len(args) < 2 or args[0] not in ('write', 'verify', 'pack', 'unpack'):
        print(__doc__); return 2
    cmd, what = args[0], args[1]
    if cmd == 'write': write(cache, what, include)
    elif cmd == 'verify':
        bad = verify(cache, what)
        if bad:
            print(f'{what}: {len(bad)} problem(s):\n  ' + '\n  '.join(bad[:50])); return 1
        print(f'{what}: the cache matches its manifest')
    elif cmd == 'pack': pack(cache, what, out)
    elif cmd == 'unpack': unpack(what, cache)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
