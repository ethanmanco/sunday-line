import math

import numpy as np

from pipeline import geometry as g
from pipeline.build import parse_maxspeed
from pipeline.chains import build_chains

BANDS = [
    {"max_radius_m": 40, "weight": 2.5},
    {"max_radius_m": 80, "weight": 2.0},
    {"max_radius_m": 150, "weight": 1.5},
    {"max_radius_m": 300, "weight": 1.0},
]


def arc(radius, degrees, step_deg=5):
    t = np.radians(np.arange(0, degrees + step_deg, step_deg))
    return np.column_stack([radius * np.sin(t), radius * (1 - np.cos(t))])


def test_radius_of_circle_points():
    xy = arc(100, 90)
    r = g.vertex_radii(xy)
    assert np.all(np.isinf(r[[0, -1]]))
    assert np.allclose(r[1:-1], 100, rtol=1e-6)


def test_straight_line_has_no_curvature():
    xy = np.column_stack([np.linspace(0, 1000, 50), np.zeros(50)])
    lens, w = g.segment_weights(xy, BANDS, 15)
    assert w.sum() == 0


def test_band_weights():
    for radius, weight in [(30, 2.5), (60, 2.0), (120, 1.5), (200, 1.0), (500, 0.0)]:
        lens, w = g.segment_weights(arc(radius, 90), BANDS, 15)
        assert set(np.unique(w)) == {weight}, radius


def test_tight_curves_outweigh_broad():
    _, w_tight = g.segment_weights(arc(35, 90), BANDS, 15)
    _, w_broad = g.segment_weights(arc(250, 90), BANDS, 15)
    assert w_tight.max() > w_broad.max()


CFG = {"simplify_tolerance_m": 0.0, "resample_step_m": 10, "radius_offset_steps": 3, "min_curve_span_m": 15}


def embedded_arc(radius, degrees):
    """A curve with 300 m of straight road before and after it."""
    a = arc(radius, degrees, 2)
    lead = np.column_stack([np.linspace(-300, 0, 31)[:-1], np.zeros(30)])
    t = np.radians(degrees)
    direction = np.array([np.cos(t), np.sin(t)])
    tail = np.array([a[-1] + direction * s for s in np.linspace(0, 300, 31)[1:]])
    return np.vstack([lead, a, tail])


def test_mapping_wobble_is_not_curvature():
    rng = np.random.default_rng(1)
    x = np.linspace(0, 1000, 201)  # a point every 5 m, wobbling about 0.3 m
    xy = np.column_stack([x, rng.normal(0, 0.3, len(x))])
    _, lens, w, *_ = g.curvature_profile(xy, CFG, BANDS)
    assert (lens * w).sum() < 20


def test_profile_ranks_tight_over_broad_and_ignores_sweepers():
    totals = {}
    for radius in (30, 60, 120, 200, 400):
        _, lens, w, *_ = g.curvature_profile(embedded_arc(radius, 90), CFG, BANDS)
        totals[radius] = (lens * w).sum() / (radius * math.pi / 2)
    assert totals[30] > totals[60] > totals[120] > totals[200] > 0
    assert totals[400] == 0


def test_split_at_long_straight():
    lens = np.array([100, 100, 2000, 100, 100], float)
    w = np.array([1, 1, 0, 1, 1], float)
    assert g.split_at_straights(lens, w, 1609) == [(0, 2), (3, 5)]
    assert g.split_at_straights(lens, w, 5000) == [(0, 5)]


def test_maxspeed_units():
    assert parse_maxspeed("45 mph", True) == [45]
    assert parse_maxspeed("88", True) == [55]   # bare numbers are km/h in OSM
    assert parse_maxspeed("45 mph", False) == [72]
    assert parse_maxspeed("none", True) == []
    assert parse_maxspeed("35 mph;45 mph", True) == [35, 45]


def _way(nodes, coords, **tags):
    return {"highway": "tertiary", "nodes": np.array(nodes), "lonlat": np.array(coords, float), "tags": tags}


def test_chains_join_same_road_and_split_different():
    ways = {
        1: _way([1, 2, 3], [(0, 0), (1, 0), (2, 0)], name="A"),
        2: _way([5, 4, 3], [(4, 0), (3, 0), (2, 0)], name="A"),   # reversed, joins at 3
        3: _way([3, 6], [(2, 0), (2, 1)], name="B"),
    }
    chains = build_chains(ways, lambda wid: ways[wid]["lonlat"])
    by_len = sorted(chains, key=lambda c: -len(c.nodes))
    assert by_len[0].nodes.tolist() == [1, 2, 3, 4, 5]
    assert by_len[0].seg_way.tolist() == [1, 1, 2, 2]
    assert by_len[1].nodes.tolist() == [3, 6]


def test_oneway_carriageways_skipped():
    ways = {1: _way([1, 2], [(0, 0), (1, 0)], name="A", oneway="yes")}
    assert build_chains(ways, lambda wid: ways[wid]["lonlat"]) == []
