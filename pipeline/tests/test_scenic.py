import tomllib

import numpy as np

from pipeline.scenic import HERE, box_share, combine, load_weights, old_parts, parts_from, resample

WT = load_weights()
with open(HERE / "scoring.toml", "rb") as f:
    SC1 = tomllib.load(f)["scenery"]

NOTHING = {"forest": 0.0, "water": 0.0, "protected": 0.0, "byway": 0.0, "terrain": 0.0, "rugged": 0.0,
           "overlook": 0.0, "big_water": 0.0, "open": 0.0, "built": 0.0}


def score(**parts):
    return combine({**NOTHING, **parts}, WT)


def test_flat_open_farmland_is_not_scenic():
    assert score(open=1.0) < 5


def test_ocean_counts_more_than_a_pond():
    assert score(big_water=1.0) > score(water=1.0) + 30


def test_desert_canyons_count_where_flat_desert_does_not():
    assert score(open=1.0, rugged=1.0, terrain=0.5) > 70
    assert score(open=1.0, rugged=0.0, terrain=0.0) < 5


def test_more_things_add_up_but_stay_under_100():
    one = score(forest=1.0)
    both = score(forest=1.0, terrain=1.0)
    assert one < both < 100


def test_towns_take_points_but_the_ocean_stays_a_view():
    assert score(forest=1.0, built=0.5) < score(forest=1.0) * 0.5
    assert score(big_water=1.0, built=0.5) > score(big_water=1.0) * 0.7


def test_parts_from_measurements():
    raw = {"relief": [10.0, 600.0], "above": [0.0, 400.0], "water_1k": [0.0, 0.5, 0.5, 0.0], "open": 0.4, "built": 0.1}
    p = parts_from(raw, WT)
    assert p["terrain"] == 0.5 and p["overlook"] == 0.5 and p["big_water"] == 0.5
    assert 0 < p["rugged"] <= 1


def test_protected_share_is_worked_back_from_the_first_score():
    road = {"scores": {"scenic": 65}, "scenery": {"forest": 1.0, "water": 0.0, "wetland": 0.0, "byway": None, "tags": []}}
    assert abs(old_parts(road, SC1)["protected"] - 1.0) < 0.05
    road["scores"]["scenic"] = 45
    assert old_parts(road, SC1)["protected"] == 0.0


def test_resample_spreads_points_along_the_line():
    pts = resample(np.array([[0.0, 0.0], [0.01, 0.0]]), 100, 300)
    assert 10 <= len(pts) <= 13
    assert pts[0][0] == 0.0 and abs(pts[-1][0] - 0.01) < 1e-12


def test_box_share_counts_only_cells_with_data():
    mask = np.zeros((5, 5), bool)
    mask[2, 2] = True
    valid = np.ones((5, 5), bool)
    valid[0, :] = False
    got = box_share(mask, np.array([2]), np.array([2]), 2, 2, valid)
    assert abs(got[0] - 1 / 20) < 1e-9
