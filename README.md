# Sunday Line

Find great local driving roads and organize meets with your car or bike group. Starting with northwest Louisiana, east Texas, and south Arkansas, and built to work anywhere.

**Live:** [sundayline.app](https://sundayline.app)

**Work in progress.** Built so far: the road data script, the map and list, road pages, share previews, sign-in, road ratings, profiles with garages and photos, follows, groups with roles and invite links, group spots, and messages. Coming next: events and notifications, then roads for the whole United States.

## How roads are scored

Every road comes from OpenStreetMap. A driving model takes each road at the speed limit (slowing for corners, braking in, accelerating out) and compares it with five real race tracks capped at 55 mph.

- **Twisty:** cornering, braking, and direction changes compared with those tracks.
- **Speed:** average legal speed through the corners.
- **Pavement:** how likely the pavement is smooth and kept up, from who maintains the road (FHWA HPMS), aerial photos (USDA NAIP), and people's checks.
- **Overall:** needs both Twisty and Speed, then Pavement, flow, elevation, quiet, and scenery.

Driver's roads must be paved, 40 mph or faster, and not in a neighborhood, park, or off-road area. See [docs/plan.md](docs/plan.md) for the full design.

## Running it

```
npm install
npm run dev            # http://localhost:3210

python -m venv .venv && .venv/Scripts/pip install -r pipeline/requirements.txt
python -m pipeline all --region shreveport   # download, score, report, export
python -m pipeline states                    # write regions/states/<abbr>.toml (50 states + DC)
python -m pipeline state --region ar --cleanup   # one state end to end, then delete its raw inputs
python -m pipeline tiles                     # merge every region into public/data/us
```

Set `SUNDAY_LINE_DATA` to keep downloads, caches, and outputs on another drive (default: `data/`).

## Data and licenses

- Code: MIT (see [LICENSE](LICENSE)).
- Road data © OpenStreetMap contributors, ODbL. The scored road list in `public/data` is a derived database, also under the ODbL.
- Base map: OpenFreeMap, © OpenMapTiles. Satellite: USGS The National Map.
- Elevation: USGS 3DEP. Aerial photos: USDA NAIP. Land cover: ESA WorldCover 2021 (CC BY 4.0). Road owner, traffic, and roughness: FHWA HPMS 2024. Buildings and places: Overture Maps Foundation.
- The curvature approach follows the published method of the Curvature project, written independently.
- Fonts: Barlow (SIL Open Font License).

More projects by Ethan: https://mancolabs.dev/lab/

Built with Claude Code. I designed, directed, reviewed, and tested it.
