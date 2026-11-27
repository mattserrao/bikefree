"""Offline map builds (code review P4): `--offline` on a tool's command line, or BIKEFREE_OFFLINE=1 in its environment
(tools/build_map.mjs and tools/pgh_pipeline.mjs set it for every step they run), means "use the cache only": every
download in the map tools calls guard(url) first, which stops the build naming what is missing from tools/.cache."""
import os, sys


def offline():
    return '--offline' in sys.argv or os.environ.get('BIKEFREE_OFFLINE', '') not in ('', '0')


def guard(url):
    if offline(): raise RuntimeError(f'offline: {url} is not cached (tools/.cache)')
