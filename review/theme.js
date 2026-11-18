// Sunday Line map theme. Our own style over OpenFreeMap vector tiles
// (OpenStreetMap data in the OpenMapTiles schema). Every color, width, and
// label below is ours to change.
window.SUNDAY_THEME = {
  ground: "#14171c",
  wood: "#1a2620",
  park: "#1c2a23",
  wetland: "#18242a",
  water: "#0f2233",
  waterLine: "#1d4563",
  residential: "#1a1d23",
  roadMinor: "#2e333b",
  roadMid: "#454c57",
  roadMajor: "#5d6573",
  roadHighway: "#7a8291",
  label: "#c3c9d2",
  labelDim: "#8a919c",
  halo: "#0d0f12",
  boundary: "#4a4f58",
};

window.sundayStyle = function (t, satellite) {
  const name = ["coalesce", ["get", "name:en"], ["get", "name"]];
  const road = (id, classes, color, widths, minzoom = 5) => ({
    id, type: "line", source: "omt", "source-layer": "transportation", minzoom,
    filter: ["match", ["get", "class"], classes, true, false],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": color,
      "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 6, widths[0], 12, widths[1], 16, widths[2]],
      "line-opacity": satellite ? 0.0 : 1,
    },
  });
  const base = satellite
    ? [{ id: "imagery", type: "raster", source: "usgs" }]
    : [
        { id: "ground", type: "background", paint: { "background-color": t.ground } },
        { id: "residential", type: "fill", source: "omt", "source-layer": "landuse", filter: ["==", ["get", "class"], "residential"], paint: { "fill-color": t.residential } },
        { id: "wood", type: "fill", source: "omt", "source-layer": "landcover", filter: ["==", ["get", "class"], "wood"], paint: { "fill-color": t.wood } },
        { id: "wetland", type: "fill", source: "omt", "source-layer": "landcover", filter: ["==", ["get", "class"], "wetland"], paint: { "fill-color": t.wetland } },
        { id: "park", type: "fill", source: "omt", "source-layer": "park", paint: { "fill-color": t.park, "fill-opacity": 0.8 } },
        { id: "waterway", type: "line", source: "omt", "source-layer": "waterway", paint: { "line-color": t.waterLine, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 14, 2] } },
        { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": t.water } },
        { id: "boundary", type: "line", source: "omt", "source-layer": "boundary", filter: ["<=", ["get", "admin_level"], 4], paint: { "line-color": t.boundary, "line-dasharray": [3, 2], "line-width": 1 } },
        road("road-minor", ["minor", "service", "track"], t.roadMinor, [0.3, 1, 5], 11),
        road("road-mid", ["secondary", "tertiary"], t.roadMid, [0.5, 1.5, 7]),
        road("road-major", ["primary", "trunk"], t.roadMajor, [0.7, 2, 9]),
        road("road-highway", ["motorway"], t.roadHighway, [0.9, 2.5, 10]),
      ];
  const labels = [
    {
      id: "road-names", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 12,
      layout: { "symbol-placement": "line", "text-field": name, "text-font": ["Noto Sans Regular"], "text-size": 11 },
      paint: { "text-color": t.labelDim, "text-halo-color": t.halo, "text-halo-width": 1.5 },
    },
    {
      id: "places", type: "symbol", source: "omt", "source-layer": "place",
      filter: ["match", ["get", "class"], ["city", "town", "village", "hamlet"], true, false],
      layout: {
        "text-field": name, "text-font": ["Noto Sans Bold"],
        "text-size": ["match", ["get", "class"], "city", 15, "town", 13, 11],
      },
      paint: { "text-color": t.label, "text-halo-color": t.halo, "text-halo-width": 2 },
    },
  ];
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      omt: { type: "vector", url: "https://tiles.openfreemap.org/planet",
             attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' },
      usgs: { type: "raster", tileSize: 256, maxzoom: 16,
              tiles: ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"],
              attribution: "Imagery: USGS The National Map" },
    },
    layers: [...base, ...labels],
  };
};
