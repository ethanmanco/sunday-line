"""Road IDs that changed between releases (11.81)."""

from pipeline.moves import find_moves, merge_moves


def test_a_road_goes_to_the_new_road_with_most_of_its_ways():
    old = {"aaa": [1, 2, 3, 4], "kept": [9]}
    new = {"kept": [9], "bbb": [1, 2, 3], "ccc": [4, 5, 6]}
    assert find_moves(old, new) == {"aaa": "bbb"}


def test_too_little_in_common_is_not_a_move():
    old = {"aaa": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
    new = {"bbb": [1, 2]}
    assert find_moves(old, new) == {}


def test_roads_with_no_ways_or_no_match_are_left_out():
    assert find_moves({"aaa": [], "ddd": [42]}, {"bbb": [1]}) == {}


def test_earlier_moves_follow_on_to_todays_road():
    earlier = {"one": "two"}
    found = {"two": "three"}
    assert merge_moves(earlier, found, {"three"}) == {"one": "three", "two": "three"}


def test_moves_to_a_road_that_is_gone_are_dropped_and_live_ids_never_move():
    assert merge_moves({"one": "gone", "back": "x"}, {}, {"back", "x"}) == {}
