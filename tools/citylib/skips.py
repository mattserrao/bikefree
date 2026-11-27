"""What a build step left out, counted instead of swallowed (code review P11): `except Exception: pass` hid every broken
multipolygon. Each kind of item counts its tries and its skips; report() prints them and stops the build when a kind
skipped more than `share` of its tries (and more than `floor`): that is a bug or bad data, not OSM's odd relation."""
from collections import Counter


class Skips:
    def __init__(self, step, share=0.02, floor=20):
        self.step, self.share, self.floor = step, share, floor
        self.tried, self.skipped, self.first = Counter(), Counter(), {}

    def attempt(self, kind, item, fn):
        """fn()'s result, or None (counted, the first error per kind kept) when it raises."""
        self.tried[kind] += 1
        try: return fn()
        except Exception as err:   # noqa: BLE001 — counted and reported below
            self.skipped[kind] += 1
            self.first.setdefault(kind, f'{item}: {type(err).__name__}: {err}')
            return None

    def report(self):
        bad = []
        for kind in sorted(self.tried):
            n, k = self.tried[kind], self.skipped[kind]
            if not k: continue
            print(f'  {self.step}: skipped {k} of {n} {kind} (first: {self.first[kind]})')
            if k > self.floor and k > self.share * n: bad.append(f'{kind} {k}/{n}')
        if bad: raise SystemExit(f'{self.step}: too many skipped — ' + ', '.join(bad))
        return dict(self.skipped)
