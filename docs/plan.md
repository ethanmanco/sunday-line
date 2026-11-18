# Driving roads and meets app: plan for approval

Date: 2026-11-18. Status: waiting for Ethan's approval. Nothing built, no accounts touched.

Working title below is "the app" until you pick a name.

---

## 1. Twelve names

| # | Name | What it evokes |
|---|------|----------------|
| 1 | **Sunday Line** | The unhurried Sunday morning drive, and the line you pick through a corner. Calm, not about speed. |
| 2 | **Two-Lane Society** | Two-lane backroads plus the club feel of a meet. |
| 3 | **Twistline** | The squiggle a great road draws on a map. |
| 4 | **Gearpin** | A dropped map pin for people who care about gears. |
| 5 | **Blacktop Almanac** | A well-thumbed reference book of good pavement. |
| 6 | **Contour Club** | Roads that follow the land's contours, and the people who drive them together. |
| 7 | **Apex Atlas** | Every corner's apex, collected into a book of maps. |
| 8 | **Wayfold** | Roads that fold over hills and around lakes. |
| 9 | **Hairpin Social** | Tight turns and a gathering afterward. |
| 10 | **Ribbon Roads** | The "ribbon of road" image: flowing, scenic, unrolling ahead. |
| 11 | **Throttle & Pine** | Throttle plus the Piney Woods where it starts; local roots that still travel. |
| 12 | **Backroad Bureau** | A tongue-in-cheek official office of good backroads. |

**My pick: Sunday Line.** Short, easy to say, works for cars and bikes, and leans "enjoy the road" rather than "go fast," which fits the terms of use. Runner-up: Two-Lane Society. I have not checked trademarks or domains yet; I will check your pick before naming the repo.

---

## 2. Plan at a glance

**Stack**
- **Web app:** Next.js (App Router, TypeScript) on **Vercel**, connected to a public GitHub repo `ethanmanco/<name>`. Vercel gives a preview link for every branch and runs the server-side preview images (`@vercel/og`).
- **Map:** MapLibre GL JS. Base map tiles from **OpenFreeMap** (free, no key, OpenStreetMap data in the OpenMapTiles schema). Our road lines are drawn on top from our own database. Fallback if OpenFreeMap ever goes away: a self-hosted Protomaps PMTiles file of the region.
- **Backend:** Supabase: Postgres + PostGIS (road geometry), pgRouting (snapping a submitted stretch to real roads), Supabase Auth (email magic link), row level security on every table.
- **Data script:** Python 3.12 (pyosmium, shapely, pyproj, numpy, rasterio, psycopg). Re-runnable.
- **Tests:** pgTAP for database rules (`supabase test db` on a local Supabase in Docker), Vitest for scoring and API, Playwright for the app and share previews.
- **Code license:** MIT. Derived road data: ODbL (see section 8).

**Works anywhere:** every region is a config file (`regions/shreveport.toml`): bounding box, which OpenStreetMap extracts to download, elevation source, units (mph and miles here, km elsewhere), timezone, and speed-limit estimate table. Adding a region later means adding a config file and running the script; no code changes.

**Starting region:** northwest Louisiana, east Texas, south Arkansas. Box: longitude -95.6 to -92.0, latitude 31.0 to 34.0 (roughly Tyler to Monroe, Natchitoches and Toledo Bend to Hope and Arkadelphia). Source extracts: Geofabrik's Louisiana, Texas, and Arkansas files, clipped to the box once and cached.

**Build order (matches your steps, each its own small commits)**
1. This plan. Wait for approval.
2. Data script, run for the Shreveport region. Output a GeoJSON file plus a table of the **top 20 candidate roads** with scores and posted speed limits. I also include a "top 10 within about an hour of Shreveport" list since those are the ones you can check from memory. No interface yet. Wait for your check. (This step needs no accounts.)
3. Map and list (homepage).
4. Sharing and preview cards.
5. Accounts and community contributions.
6. Groups.
7. Meets.
8. README with screenshots, publish.

You create the Supabase and Vercel projects yourself when we reach step 3 (they are your accounts); I write the setup steps.

---

## 3. How road scoring works

Our own implementation. It follows the **published approach** of the open-source Curvature project (Adam Franco): find the radius of the circle through each three consecutive points along a road, and weight each piece of road by how tight that radius is, with straights counting zero. No Curvature code is read into or copied into this project (it is GPL); the README credits the approach.

### 3.1 Which roads are considered
- Included: OpenStreetMap `highway` = primary, secondary, tertiary, unclassified.
- Excluded: motorway, trunk (mostly divided highways), link ramps, residential, service, tracks, anything with `access=private` or `access=no`.
- Ways are joined into continuous stretches when they share a name or route number, then split wherever a straight longer than 1.6 km (1 mile) breaks them up. Each piece becomes one candidate.
- Kept if at least 2 km long and with enough weighted curvature to be worth showing (threshold set during step 2, then frozen).

### 3.2 The six factors (each 0 to 100)

| Factor | How it is measured |
|---|---|
| **Curvature** | Geometry projected to meters (local UTM zone picked from the region, so it works anywhere). Points closer than 5 m are merged to remove mapping jitter. Each vertex gets a radius from the circle through it and its neighbors. Bands: 300 m or more counts 0 (straight); 150 to 300 m weight 1.0 (broad); 80 to 150 m weight 1.5; 40 to 80 m weight 2.0; under 40 m weight 2.5 (hairpin). A single sharp kink at a junction or a one-point mapping artifact does not count; a curve must span at least about 15 m of road. Result: weighted curve meters per km of road, put through a curve that saturates near 100. |
| **Elevation change** | Elevation sampled every 30 m from a bare-earth model. Total climb plus descent per km, smoothed. Bridges are skipped and interpolated (bare-earth models drop bridges into the bayou below, which would fake a big dip). |
| **Paved surface** | Length-weighted from the `surface` tag. Paved tags (asphalt, concrete, chipseal, paved) 100. Untagged tertiary or larger 80, labeled "surface not tagged, likely paved." Untagged unclassified 60. Unpaved (gravel, dirt, compacted) 10 and labeled "unpaved." |
| **Quiet road type** | Length-weighted by class: unclassified 100, tertiary 90, secondary 65, primary 35. Minus 20 if more than two lanes. |
| **Scenery** | Share of the stretch within 150 m of forest (`landuse=forest`, `natural=wood`), within 300 m of water (`natural=water`, rivers, wetlands at lower weight), inside protected areas (national forests, state parks, nature reserves), plus a bonus for overlapping a scenic byway route or `scenic=yes`. |
| **Interruptions (flow)** | Per km: junctions with other drivable roads (driveways ignored), stop signs, traffic signals, railroad crossings, yield signs at lower weight. Fewer is better. Stop signs are under-tagged in rural OpenStreetMap; junctions come from the road network itself, so they are reliable. |

### 3.3 The ratings shown
- **Twisty** = the curvature factor.
- **Scenic** = the scenery factor.
- **Overall** = 35% Twisty + 20% Scenic + 15% Flow + 10% Elevation + 10% Quiet + 10% Surface.
- **Speed is not part of any score.** Length is not either; the default list hides stretches under 3 km via the minimum-length filter instead.
- All weights and thresholds live in one config file and are listed in the README. Every road records the scoring version that produced it. Thresholds get tuned once on the Shreveport results in step 2, then frozen as "scoring v1" so a 90 means the same thing in every region.

### 3.4 Posted speed limits
- From OpenStreetMap `maxspeed` (units parsed properly: OpenStreetMap treats a bare number as km/h; US roads are normally tagged "45 mph").
- A stretch with more than one posted limit shows a range, for example "35 to 45 mph."
- Untagged parts get an estimate from road type (and `source:maxspeed` if present) using the region's table, and are labeled **"estimated"** (or "partly estimated").

### 3.5 Labels
- Map-found roads: **Candidate**.
- User-submitted roads: **Community submitted**.
- Either becomes **Verified** once 3 different members verify it and verifies outnumber flags (a submitter's own vote does not count). 3 flags that outnumber verifies mark it **Flagged: not worth it**, hidden by default but still listed when the filter is off.

### 3.6 Re-running the data script
`python -m pipeline fetch|score|load|score-pending --region shreveport`
- Downloads extracts and elevation tiles only when newer ones exist.
- On reload, a new candidate is matched to an existing road by geometry overlap (at least 80%), so ratings, notes, and verifications stay attached when OpenStreetMap ways get split or renumbered.
- Roads that no longer qualify are marked retired, never deleted (their community data stays).
- `score-pending` fills in scores for community submissions (see 4.4). It runs on a scheduled GitHub Action every hour, same Python code, so there is one scoring implementation.

### 3.7 Elevation source
- US regions: **USGS 3DEP 1 arc-second** (about 30 m), public domain, and bare-earth, which matters here: a surface model would read pine canopy as hills.
- Outside the US: Copernicus GLO-30 as the documented fallback (free with attribution; it is a surface model, so forested roads read a little rough, noted in the README).

---

## 4. Database schema and row level security

### 4.1 Principles
- RLS is on for every table, with no exceptions. Anything not explicitly allowed is denied.
- Secrets (invite token hashes, meet-link token hashes, check-in secrets, attempt counters) live in a separate `private` schema that **is not exposed through the Supabase API at all**. Only specific security-definer functions touch it.
- Tokens are stored as SHA-256 hashes, never in plain text. An invite or private meet link is shown once when created; if lost, make a new one.
- RLS is row level, so data with different visibility lives in different tables. Example: a meet's title and date are in `meets`, its exact location is in `meet_locations` with stricter rules.
- Helper functions (security definer, `search_path` locked, stable): `is_member(group_id)`, `is_admin(group_id)` (owner or admin), `is_owner(group_id)`, `is_organizer(meet_id)` (meet creator or group admin), `meet_location_visible(meet_id)`. These avoid RLS recursion on `group_members`.
- The share-preview server uses only the public anon key, never the service-role key. It physically cannot read more than an anonymous visitor can.
- No table stores a user's own location. "Center on me" runs in the browser only and never sends coordinates anywhere.

### 4.2 Tables

```
profiles        id (= auth user), display_name, vehicle_note, created_at
regions         id, slug, name, bbox, units, timezone, data_updated_at
roads           id, short_id, region_id, name, ref, geom LineString,
                length_m, source (osm | community),
                status (candidate | community_submitted | verified | flagged | retired),
                score_overall, score_twisty, score_scenic, score_elevation,
                score_flow, score_quiet, score_surface  (0-100, null while pending),
                climb_m, elev_profile (distance/elevation pairs), surface_summary,
                paved, highway_class, speed_min, speed_max,
                speed_estimated (none | partial | all), scenery_tags,
                osm_way_ids, scoring_version, submitted_by, description,
                created_at, updated_at
road_votes      road_id, user_id, vote (verify | flag), reason, created_at
road_ratings    road_id, user_id, stars (1-5, optional), vehicle (car | motorcycle),
                drove_it, updated_at
road_notes      id, road_id, user_id, kind (pavement | traffic | direction | general),
                body, created_at, updated_at
road_network    edge geometry for pgRouting (eligible road classes only); service role
basemap_context simplified water, forest, and major-road shapes for preview images
groups          id, short_id, name, description, visibility (public | private),
                home_area (free text like "Shreveport, LA"), owner_id,
                members_can_create_meets, created_at
group_members   group_id, user_id, role (owner | admin | member), joined_at
join_requests   id, group_id, user_id, message, status, decided_by, decided_at, created_at
group_invites   id, group_id, created_by, label, expires_at, max_uses, use_count,
                revoked_at, created_at
group_spots     id, group_id, name, spot_type (meetup | scenic | food | gas |
                track_venue | custom), custom_type, notes, geom Point,
                created_by, created_at
meets           id, short_id, group_id, title, description,
                category (meet | cruise | track_and_legal), starts_at, ends_at,
                timezone, hide_location_after_end, created_by, created_at
meet_locations  meet_id, place_name, address_text, geom Point
meet_links      id, meet_id, created_by, revoked_at, created_at
rsvps           meet_id, user_id, status (going | maybe | no), via_link, updated_at
checkins        meet_id, user_id, via_link, checked_in_at

private.invite_tokens      invite_id, token_hash
private.meet_link_tokens   link_id, token_hash
private.checkin_secrets    meet_id, secret (32 random bytes)
private.checkin_attempts   meet_id, user_id, window_start, failures
```

### 4.3 Row level security rules

| Table | Read | Create | Change | Delete |
|---|---|---|---|---|
| profiles | anyone | automatic on sign-up | self | self (delete account) |
| regions, road_network, basemap_context | anyone (network: functions only) | data script | data script | data script |
| roads | anyone | signed-in users, community submissions only; a trigger forces scores empty and status "community submitted" | submitter: name and description only (column-level grant); scores and status: data script and triggers only | submitter, community roads only |
| road_votes, road_ratings, road_notes | anyone | self | self | self |
| groups | public: anyone. private: members only | signed-in user, who becomes owner (trigger adds the owner row) | owner and admins; visibility and ownership transfer: owner only | owner |
| group_members | members of that group only | never directly: only via create group, approve request, redeem invite | owner sets roles (function) | yourself (leave, unless owner); admins remove members; owner removes admins; nobody removes the owner |
| join_requests | the requester and the group's admins | signed-in user, public group, not already a member | admins, via `decide_join_request` | requester withdraws |
| group_invites | owner and admins | admins, via `create_invite` | admins (revoke) | admins |
| group_spots | **members only** | members | creator or admins | creator or admins |
| meets | public group: anyone. private group: members only | owner and admins (members too if the group allows it) | organizer | organizer |
| meet_locations | **members only**, and only while `meet_location_visible` (if hidden after the meet ends, organizers only) | organizer | organizer | organizer |
| meet_links | organizers | organizers, via `create_meet_link` | organizers (revoke) | organizers |
| rsvps | members of the group, plus your own row | self, if a member (link holders via `rsvp_by_link`) | self | self |
| checkins | organizers, plus your own row | only through `check_in` with a valid code | nobody | organizers |
| private.* | not reachable through the API | | | |

### 4.4 Functions (security definer, each re-checks the caller)

| Function | Who | Returns |
|---|---|---|
| `roads_in_view(bbox, filters, sort, zoom)` | anyone | road lines simplified for the zoom level, plus list fields, max 500 |
| `trace_stretch(start, end, via?)` | signed in | a line that follows real roads between tapped points (pgRouting) |
| `group_summary(group_id)` | anyone, public groups only | member count, upcoming meet count |
| `create_invite(group_id, expires_at?, max_uses?)` | admins | the token, once |
| `invite_preview(token)` | anyone | group name only |
| `redeem_invite(token)` | signed in | joins the group if the link is valid, unexpired, unrevoked, under its use limit (row lock so the limit holds) |
| `request_to_join`, `decide_join_request` | signed in / admins | |
| `set_member_role`, `transfer_ownership` | owner | |
| `create_meet_link(meet_id)` | organizers | the token, once |
| `meet_link_preview(token)` | anyone | meet title and date only (used by the share card, so the card renderer never even receives a location) |
| `meet_by_link(token)` | anyone holding the link | meet details including location, unless hidden after the end |
| `rsvp_by_link(token, status)` | signed in | |
| `checkin_code(meet_id)` | organizers, from 1 hour before start until 2 hours after end | current code and seconds left |
| `check_in(meet_id, code)` / `check_in_by_link(token, code)` | signed in members / link holders | |

### 4.5 Tokens and codes (cannot be guessed)
- **Invite links and private meet links:** 128 random bits, 22 characters, URL-safe. Example shape: `/j/Xq3...` and `/p/Xq3...`. Stored hashed.
- **Public short IDs** (roads, public groups, meets): 10 random characters. Public content anyway; a private group's or meet's short ID reveals nothing, because RLS checks membership, not secrecy of the ID.
- **Check-in code:** 6 characters from a 32-character alphabet with no look-alike characters (no 0/O, 1/I/L), computed from the meet's secret and the current minute (same idea as authenticator apps). Current and previous minute accepted. 5 wrong tries per person per meet per 10 minutes, then a cooldown. Only valid around the meet time. Odds of guessing it: about 1 in a billion per try with 5 tries allowed every 10 minutes.
- **QR code:** encodes a link to the check-in page with the code filled in, so scanning with the phone camera works without an in-app scanner.

---

## 5. Sharing and preview cards

- Share button: calls the phone's share menu (Web Share API) where available, otherwise copies the link and says "Link copied."
- Clean links: `/r/<id>` road, `/g/<id>` group, `/m/<id>` meet, `/j/<token>` private group invite, `/p/<token>` private meet link.
- Preview images are made on the server (`/og/...` routes), so iMessage, WhatsApp, Discord, Facebook, and others show them without running JavaScript.
  - **Road:** the road's shape drawn on a styled map made from our own `basemap_context` data (water, forest, nearby roads), with name, length, Twisty and Scenic scores, and "© OpenStreetMap contributors."
  - **Public group / meet:** name, and date for meets, in the app's style.
  - **Private group invite / private meet link:** name only, plus date for meets. Never location, spots, or members.
  - **Private group or meet reached by its plain short ID** (no token): a generic card with no name.
- **No preview card ever contains a location**, public or private. Simple and safe.
- Private link pages carry `noindex` so search engines skip them.

---

## 6. Security and privacy tests

All automated and run in CI on every push.

**Database (pgTAP), as three users: anonymous, signed-in non-member, member**
- Non-member and anonymous read 0 rows from: `group_spots`, `group_members`, `meet_locations`, `group_invites`, `meet_links`, `rsvps`, `checkins` of a private group, even when filtering by the exact known IDs.
- Private group row and its meets are invisible to non-members by ID.
- `private` schema is unreachable through the API.
- Location hidden after a meet ends, for members and link holders, when the organizer chose that.
- Invites: expired, revoked, and used-up links fail; the use limit holds under concurrent redemption.
- Role rules: admin cannot remove the owner or another admin; members cannot approve requests; nobody can write scores or status directly.
- Every security-definer function called by a non-member with real private IDs returns nothing.

**API (Vitest against the local Supabase REST endpoint)**: the same checks through the actual HTTP API that the app uses, including direct table queries with guessed and real IDs.

**Share previews (Playwright / HTTP)**: preview pages and images for private groups and meets contain no location, spot, or member text, by short ID or by token; wrong or revoked tokens give the generic card.

**Guessing**: token length and randomness checks; check-in rate limit trips after 5 wrong codes; codes expire after the window.

**No stored user location**: a schema test fails if any table gains a column meant for user position, and a Playwright test confirms "center on me" sends no coordinates over the network.

---

## 7. Layout sketch

**Phone (the main target)**

```
+-------------------------------+
| SUNDAY LINE        [Filter][o]|   o = account / settings
+-------------------------------+
|                               |
|     MAP: road lines colored   |
|     by score (cool = low,     |
|     warm = high)              |
|                       [+][-]  |
|  (c) OpenStreetMap contrib.   |
+===============================+
|          ----------           |   drag up for the full list
| 184 roads in view   Sort: v   |
| [Both][Cars][Bikes] [Twisty]  |
|-------------------------------|
| (92) Road name      Candidate |
|      Twisty 88  Scenic 71     |
|      14.2 mi   45 mph posted  |
|-------------------------------|
| (89) Road name       Verified |
|      Twisty 80  Scenic 90     |
|      9.8 mi   about 55 mph    |
|               (estimated)     |
+-------------------------------+
| Roads | Groups | Meets |  Me  |
+-------------------------------+
```

**Road detail (phone: full sheet; desktop: replaces the list column)**

```
< Back                      [Share]
Road name               Candidate
14.2 mi   45 mph posted
Overall 92   Twisty 88   Scenic 71
[elevation profile chart]
  "Climbs 180 ft total, high point 410 ft"   (text for screen readers)
Surface: asphalt   Flow: few stops
Community: 4.6 stars (12)  7 drove it
Best direction: "Eastbound, morning light" (note)
[Get directions to west end] [east end]
  -> opens Apple Maps / Google Maps / Waze, your pick
Notes: pavement / traffic / direction
[Rate] [I drove it] [Verify] [Not worth it]
(c) OpenStreetMap contributors
```

**Desktop**

```
+------------------------------------------------------------------+
| SUNDAY LINE    Roads  Groups  Meets               [Sign in]      |
+----------------------+-------------------------------------------+
| Filters (chips)      |                                           |
| Sort: Overall v      |                                           |
|----------------------|                 MAP                       |
| 1 (92) Road name     |    hovering a list item highlights its    |
| 2 (89) Road name     |    line; clicking a line opens detail     |
| 3 (87) Road name     |                                           |
| ...                  |                     (c) OpenStreetMap ... |
+----------------------+-------------------------------------------+
```

**Organizer check-in screen**

```
+-------------------------------+
| Check-in: Meet title          |
|                               |
|        K 7 P 4 M Q            |
|      [   QR CODE   ]          |
|   new code in 0:42            |
|-------------------------------|
| Checked in (14)   Going (21)  |
|  Name ..... 6:42 pm           |
+-------------------------------+
```

**Other screens:** Groups (mine, discover public), Group page (about, meets, members and spots for members, invite links for admins, join requests), Meet page (details, RSVP, location for those allowed, check-in), Submit a road (tap start and end on the map, the line snaps to real roads, add description), Settings and about.

**Accessibility:** the list is the full equivalent of the map (every road, every score, posted speed, status, all reachable by keyboard and screen reader). Scores are always shown as numbers, never color alone; the color ramp is color-blind safe. The detail panel manages focus and closes with Escape. Elevation profile has a text summary. Touch targets at least 44 px.

**Copy rules:** nothing suggests using the app while driving ("Plan your drive before you head out," never "use while driving"). Nothing detects or blocks it either. No em dashes anywhere.

---

## 8. Licenses, credits, terms

- **"© OpenStreetMap contributors"** on the map, the road detail panel, every preview image, the about page, the README, and data downloads.
- **ODbL:** our scored road table is a derived database of OpenStreetMap. Each data run publishes the derived candidate roads as a GeoJSON download (GitHub release asset) under ODbL, as the license requires. Community ratings and notes are a separate database and are not part of it.
- **Base map:** OpenFreeMap tiles, OpenStreetMap data (ODbL) in the OpenMapTiles schema (credited "© OpenMapTiles"). Exact license lines confirmed and recorded in the README when wired up.
- **Elevation:** USGS 3DEP, public domain (credited anyway).
- **Curvature project:** credited as the source of the approach; independent implementation, no GPL code.
- **Terms of use** (plain language, on the about page and shown once at sign-up): you are responsible for following traffic laws; illegal driving activity is prohibited; you use the app and attend meets at your own risk; you own and control what you post; contact email for legal notices. This is a plain draft, not legal advice.
- **About / settings:** "Star on GitHub" (repo link), "More projects by Ethan" (https://mancolabs.dev/lab/), terms, OpenStreetMap credit, contact email.
- **README:** what it is, screenshots, how scoring works, data sources and licenses, future ideas (native apps, turn-by-turn navigation, live location sharing, group chat, photo uploads, more regions), link to https://mancolabs.dev/lab/, and: "Built with Claude Code. I designed, directed, reviewed, and tested it."

---

## 9. Decisions (my picks; change any)

1. **Name:** Sunday Line.
2. **Legal contact email:** a forwarding address like `legal@mancolabs.dev` through Cloudflare Email Routing (free, you set it up in your Cloudflare account) so your personal Gmail is not published. Or give me the address you want.
3. **Hosting:** Vercel + Next.js. Links start as `<name>.vercel.app`; a `mancolabs.dev` subdomain can come later.
4. **Sign-in:** email magic link. Note: Supabase's built-in email sender allows only a few emails per hour, fine for a demo; real use needs a free SMTP service (for example Resend).
5. **Who creates meets:** owner and admins, with a per-group switch to let members.
6. **Verification:** 3 members to verify.
7. **Public groups:** joining needs admin approval (per your spec). Private groups: the invite link is the approval.
8. **Repo:** public `ethanmanco/<name>`, pushed as ethanmanco, then gh switched back.

## 10. Known limits

- Supabase free projects pause after about a week with no traffic; a portfolio visitor may hit a paused project. Upgrading or a weekly keep-alive ping fixes it (your call later).
- Rural stop signs and surfaces are often untagged in OpenStreetMap, so Flow and Surface lean on estimates; labeled as such.
- Community submissions show up immediately but their scores fill in within the hour (scheduled scoring job).
- No moderation and no report button, per your rules; the legal contact email is the only channel for notices.
