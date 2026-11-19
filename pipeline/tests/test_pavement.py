from pipeline.build import pavement_score
from pipeline.config import load_scoring

PC = load_scoring()["pavement"]
MIN = load_scoring()["categories"]["min_pavement"]


def score(**kw):
    base = dict(state="Texas", owner=None, state_ref=False, hp_unpaved=False, aadt=None, iri=None,
                tagged_paved=False, p_unpaved=None, photo_used=False, verdict=None)
    base.update(kw)
    return pavement_score(PC, **base)


def test_state_highway_passes():
    s, why = score(owner=1)
    assert s >= MIN and why == "state highway"


def test_state_route_number_counts_without_federal_match():
    assert score(state_ref=True)[0] >= MIN


def test_texas_county_road_needs_a_check():
    s, why = score(owner=2)
    assert s < MIN and why == "county road"


def test_busy_county_road_passes():
    s, why = score(owner=2, aadt=1500)
    assert s >= MIN and "cars a day" in why


def test_parish_road_passes_unless_photos_look_like_gravel():
    assert score(state="Louisiana", owner=2)[0] >= MIN
    assert score(state="Louisiana", owner=2, photo_used=True, p_unpaved=0.6)[0] < MIN


def test_federal_unpaved_is_zero():
    assert score(owner=2, hp_unpaved=True)[0] == 0


def test_people_win():
    assert score(owner=2, verdict="good")[0] >= MIN
    assert score(owner=1, verdict="rough")[0] < MIN
    assert score(owner=1, verdict="gravel")[0] == 0
