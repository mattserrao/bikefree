"""One downloader for the map tools (code review P8): build_pgh.py, build_city.py, fetch_osm_corridor.py,
fetch_commerce.py, cny_forest.py, build_park_routes.py and the DEM code each had their own urlopen with its own
timeout, and some no offline guard.

    http_get(url, pause=…, timeout=…, headers=…)   the body; refuses in offline mode (citylib/offline.py) before any
                                                    network; retries busy answers (429, 5xx) and dropped connections
                                                    with backoff; any other HTTP error (400, 404, 509: the callers
                                                    split a box on those) is raised at once
    write_atomic(path, data)                        writes path.part, then renames it: a killed build leaves no half file
                                                    that a later build would take for a cached one
    download(url, path, …)                          http_get + write_atomic, unless path is already there
"""
import os, time, urllib.error, urllib.request
from . import offline as _offline

UA = {'User-Agent': 'bikefree-map-tools/1.0 (personal project)'}
RETRY_CODES = (429, 500, 502, 503, 504)


def http_get(url, pause=0.0, timeout=180, headers=None, retries=3, backoff=2.0, sleep=time.sleep, urlopen=None):
    _offline.guard(url)
    urlopen = urlopen or urllib.request.urlopen
    if pause: sleep(pause)
    for attempt in range(retries + 1):
        try:
            with urlopen(urllib.request.Request(url, headers=headers or UA), timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as err:
            if err.code not in RETRY_CODES or attempt == retries: raise
            wait = backoff * 2 ** attempt
            ra = err.headers.get('Retry-After') if err.headers else None
            if ra and ra.isdigit(): wait = max(wait, min(int(ra), 120))
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == retries: raise
            wait = backoff * 2 ** attempt
        print(f'  retrying in {wait:.0f} s: {url}')
        sleep(wait)


def write_atomic(path, data):
    d = os.path.dirname(path)
    if d: os.makedirs(d, exist_ok=True)
    part = path + '.part'
    with open(part, 'wb') as f: f.write(data)
    os.replace(part, path)
    return path


def download(url, path, **kw):
    if not os.path.exists(path): write_atomic(path, http_get(url, **kw))
    return path
