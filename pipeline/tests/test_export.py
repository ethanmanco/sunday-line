from pipeline.export import encode_polyline


def test_encode_polyline_matches_google_reference():
    # Google's documented example; the app's decoder test uses the same string.
    coords = [(-120.2, 38.5), (-120.95, 40.7), (-126.453, 43.252)]
    assert encode_polyline(coords) == "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
