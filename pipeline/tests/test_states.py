import tomllib

from pipeline.build import state_route_ref
from pipeline.config import REGIONS_DIR, STATE_CODES, load_region
from pipeline.states import RESEARCHED_DEFAULTS, STATES, geofabrik_slug, state_toml

TEMPLATE = tomllib.loads((REGIONS_DIR / "shreveport.toml").read_text(encoding="utf-8"))


def test_every_state_and_dc_has_a_code_and_a_box():
    assert len(STATES) == 51
    for name, (tz, (w, s, e, n)) in STATES.items():
        assert name in STATE_CODES
        assert tz.startswith(("America/", "Pacific/"))
        assert w < e and s < n


def test_geofabrik_slugs():
    assert geofabrik_slug("District of Columbia") == "district-of-columbia"
    assert geofabrik_slug("New York") == "new-york"


def test_legal_defaults_only_for_researched_states():
    for name in STATES:
        d = tomllib.loads(state_toml(name, TEMPLATE))
        assert d["states"] == [name]
        assert "home" not in d
        assert d["speed_estimates"] == TEMPLATE["speed_estimates"]
        if name in RESEARCHED_DEFAULTS:
            assert d["speed_defaults"] == {name: TEMPLATE["speed_defaults"][name]}
        else:
            assert "speed_defaults" not in d


def test_shreveport_keeps_its_home_and_states():
    r = load_region("shreveport")
    assert r.home is not None and r.home_name == "Shreveport"
    assert r.state_codes == ["TX", "LA", "AR"]


def test_state_route_numbers_include_the_regions_own_state():
    assert state_route_ref(["MO"]).match("MO 7")
    assert not state_route_ref().match("MO 7")
    assert state_route_ref().match("AR 23")
