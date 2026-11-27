"""Shared geometry for the map tools (code review P8): the haversine every tool measured with its own copy of, and the
Web-Mercator tile maths the DEM and OSM tile code share.

    hv(a, b)                 metres between (lat, lon) points a and b (as js/gpx.js measures)
    tile_xy(lat, lon, z)     the fractional Web-Mercator tile (x, y) at zoom z
    global_px(lat, lon, z)   the fractional pixel (x, y) in the 256-px tiles of zoom z (tile_xy × 256, exactly)
    lat_of_tile_y(y, z)      the inverse: the latitude of tile row y (fractional) at zoom z
"""
import math

R_EARTH = 6371008.8


def hv(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(h))


haversine = hv


def tile_xy(lat, lon, z):
    n = 2 ** z
    r = math.radians(lat)
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n


def global_px(lat, lon, z):
    n = 2 ** z
    fx = (lon + 180) / 360 * n * 256
    lr = math.radians(lat)
    fy = (1 - math.log(math.tan(lr) + 1 / math.cos(lr)) / math.pi) / 2 * n * 256
    return fx, fy


def lon_of_tile_x(x, z):
    return x / 2 ** z * 360 - 180


def lat_of_tile_y(y, z):
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / 2 ** z))))
