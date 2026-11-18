import numpy as np

from pipeline import geometry as g
from pipeline.build import default_limit, overall_score


def test_straight_road_runs_at_the_limit_with_no_cornering():
    r = np.full(200, np.inf)
    v, lat = g.speed_trace(r, 10.0, np.full(200, 25.0), a_lat=4.9, a_acc=2.9, a_brake=4.9)
    assert np.allclose(v, 25.0)
    assert lat.max() == 0


def test_never_exceeds_limit_or_grip_and_brakes_before_a_hairpin():
    r = np.full(300, np.inf)
    r[150:160] = 30.0  # hairpin
    limit = np.full(300, 26.8)  # 60 mph
    v, lat = g.speed_trace(r, 10.0, limit, a_lat=4.9, a_acc=2.9, a_brake=4.9)
    assert (v <= limit + 1e-9).all()
    assert lat.max() <= 0.5 + 1e-6
    assert v[150] < v[100]          # slowed for the hairpin
    assert v[147] < v[100]          # braking starts about 58 m before it
    assert np.all(np.diff(v[100:150]) <= 1e-9)


def test_combined_score_needs_both_twisty_and_speed():
    w = dict(combine="geometric", twisty=30, speed=30, flow=15, elevation=10, surface=5, quiet=5, scenic=5)
    rest = dict(flow=80, elevation=50, surface=100, quiet=90, scenic=40)
    balanced = overall_score(dict(twisty=60, speed=60, **rest), w)
    lopsided = overall_score(dict(twisty=20, speed=100, **rest), w)
    assert balanced > lopsided


def test_unposted_numbered_routes_use_typical_posted_limit():
    sd = {"numbered": 70, "unnumbered": 60, "numbered_ref": r"^(FM|SH|US)[ -]?\d"}
    typical = {("Texas", "tertiary"): 55}
    assert default_limit({"ref": "FM 2015"}, "tertiary", sd, "Texas", typical, None) == (55, "estimated")
    assert default_limit({"name": "County Road 202"}, "unclassified", sd, "Texas", typical, None) == (60, "state_default")
    assert default_limit({"ref": "FM 9"}, "secondary", sd, "Texas", {}, None) == (70, "state_default")
