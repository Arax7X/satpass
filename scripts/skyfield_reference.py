"""Build test/fixtures/skyfield-passes.json: reference passes computed with
Skyfield (https://rhodesmill.org/skyfield/), an independent, well-tested
astronomy library, so satpass's own results can be checked against it.

    pip install skyfield skyfield-data
    python3 scripts/skyfield_reference.py
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import skyfield
from skyfield.api import EarthSatellite, Loader, wgs84
from skyfield_data import get_skyfield_data_path

ROOT = Path(__file__).resolve().parent.parent
START = datetime(2026, 11, 16, 12, 0, tzinfo=timezone.utc)
DAYS = 3
MIN_ELEVATION = 10.0
MAX_SUN_ELEVATION = -6.0
SATELLITES = ['25544', '48274', '20580', '44714']
OBSERVERS = {
    'London': (51.5072, -0.1276),
    'New York': (40.7128, -74.0060),
    'Sydney': (-33.8688, 151.2093),
    'Quito': (-0.1807, -78.4678),
    'Tromso': (69.6492, 18.9553),
}

load = Loader(get_skyfield_data_path(), expire=False)
ts = load.timescale(builtin=True)
eph = load('de421.bsp')
sun, earth = eph['sun'], eph['earth']


def iso(t):
    return t.utc_datetime().isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def visible_window(sat, topos, rise, set_):
    """Longest stretch, at 1 s resolution, with the satellite sunlit and the sky dark."""
    seconds = int((set_ - rise) * 86400)
    times = ts.tt_jd(rise.tt + np.arange(seconds + 1) / 86400)
    sunlit = sat.at(times).is_sunlit(eph)
    sun_alt = (earth + topos).at(times).observe(sun).apparent().altaz()[0].degrees
    seen = sunlit & (sun_alt <= MAX_SUN_ELEVATION)
    best, run_start = None, None
    for i, s in enumerate(list(seen) + [False]):
        if s and run_start is None:
            run_start = i
        elif not s and run_start is not None:
            if best is None or i - 1 - run_start > best[1] - best[0]:
                best = (run_start, i - 1)
            run_start = None
    if best is None:
        return None
    return {'start': iso(times[best[0]]), 'end': iso(times[best[1]])}


def passes_for(sat, topos):
    t0 = ts.from_datetime(START)
    t1 = ts.from_datetime(START + timedelta(days=DAYS))
    times, events = sat.find_events(topos, t0, t1, altitude_degrees=MIN_ELEVATION)
    out, current = [], None
    for t, event in zip(times, events):
        if event == 0:
            current = {'rise': t, 'peaks': []}
        elif event == 1 and current is not None:
            current['peaks'].append(t)
        elif event == 2 and current is not None:
            # Only passes that rise and set inside the window, to keep the comparison simple.
            alts = [(sat - topos).at(p).altaz()[0].degrees for p in current['peaks']]
            k = max(range(len(alts)), key=alts.__getitem__)
            peak = current['peaks'][k]
            alt, az, _ = (sat - topos).at(peak).altaz()
            out.append({
                'rise': iso(current['rise']),
                'peak': iso(peak),
                'set': iso(t),
                'peakElevation': round(alt.degrees, 4),
                'peakAzimuth': round(az.degrees, 4),
                'visibility': visible_window(sat, topos, current['rise'], t),
            })
            current = None
    return out


def main():
    tles = json.loads((ROOT / 'test/fixtures/tles.json').read_text())['satellites']
    cases = []
    for sid in SATELLITES:
        tle = tles[sid]
        sat = EarthSatellite(tle['line1'], tle['line2'], tle['name'], ts)
        for name, (lat, lon) in OBSERVERS.items():
            topos = wgs84.latlon(lat, lon)
            cases.append({
                'satellite': sid,
                'observer': {'name': name, 'lat': lat, 'lon': lon},
                'passes': passes_for(sat, topos),
            })
    fixture = {
        'generatedWith': f'skyfield {skyfield.__version__}',
        'start': START.isoformat().replace('+00:00', 'Z'),
        'days': DAYS,
        'minElevation': MIN_ELEVATION,
        'maxSunElevation': MAX_SUN_ELEVATION,
        'cases': cases,
    }
    path = ROOT / 'test/fixtures/skyfield-passes.json'
    path.write_text(json.dumps(fixture, indent=1) + '\n')
    total = sum(len(c['passes']) for c in cases)
    print(f'wrote {total} passes in {len(cases)} cases to {path.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
