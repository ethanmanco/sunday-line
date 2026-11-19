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

*Revised 2026-11-18 after your review of the first top 20 (scoring v2). The aim is a road that is fun to drive: one that really works the car, at legal speeds.*

Curve detection is our own implementation of the **published approach** of the open-source Curvature project (Adam Franco): measure the radius of each curve and weight tight curves more than broad ones. No Curvature code is read into or copied into this project (it is GPL); the README credits the approach. On top of that sits a driving model borrowed from race engineering.

### 3.1 Which roads are considered
- Included: OpenStreetMap `highway` = primary, secondary, tertiary, unclassified, with a name or route number (unnamed ways are often private, military, or logging roads; the community can still submit them).
- Excluded: motorway, trunk, link ramps, residential, service, tracks, one-way carriageways, roundabouts, anything with `access=private` or `access=no`.
- Ways join into continuous roads when they share a route number (or name), then split wherever a straight longer than 1 mile breaks them up. Each piece is one candidate if it is at least 2 km long and has enough curvature.

### 3.2 The driving model (why tracks work a car)
Race tracks are built around a mix of corner types, braking zones into slower corners, quick left-right changes, and elevation. A lap simulator measures that by driving a virtual car around the course. We do the same on every road, with road rules:
- The road is re-measured every 10 m and each point's curve radius is taken across 60 m of road, so small wobbles in how the road is mapped do not read as corners.
- A virtual driver **never exceeds the speed limit**, slows for each curve so cornering stays under 0.5 g, brakes at up to 0.5 g, and accelerates at 0.3 g.
- From that speed trace come the track measures: average cornering load, braking zones, and left-right changes (esses), plus the average speed you can legally carry.
- **Calibration against real tracks:** Laguna Seca, Road Atlanta, Lime Rock, Barber, and COTA are run through the same model with a 55 mph cap (track outlines from OpenStreetMap; all five came out at their real lengths). Matching their average scores about 70 on Twisty. For comparison, the Tail of the Dragon (posted 30 mph) scores 63 Twisty and 0 Speed; the Pig Trail (AR 23) scores 48 and 62.
- The modeled speeds are a scoring tool only. **The app never shows them**, so nothing reads as a suggested speed.

### 3.3 The factors (each 0 to 100)

| Factor | How it is measured |
|---|---|
| **Twisty** | From the speed trace: 60% average cornering load, 25% braking zones, 15% esses, relative to the track average. |
| **Speed** | The average speed the virtual driver can legally carry: 35 mph scores 0, 65 mph scores 100. Rewards roads with sweepers you can take near the limit. |
| **Flow** | Interruptions per km: junctions with other drivable roads (driveways ignored), stop signs, signals, rail crossings. Tracks have none. |
| **Elevation** | Climb plus descent per km from a bare-earth model; bridges skipped so the model's dips under them don't fake hills. |
| **Paved surface** | From the `surface` tag. Untagged roads count as likely paved and are labeled so. |
| **Quiet road type** | Unclassified and tertiary roads above secondary and primary; minus 20 for more than two lanes. |
| **Scenic** | Average tree cover within 150 m (ESA WorldCover satellite land cover), share of the road near water or wetland, time inside protected areas (national forests, parks), and a scenic byway bonus. |

### 3.4 Overall score and categories
- **Overall** = 60% Twisty and Speed together + 15% Flow + 10% Elevation + 5% Surface + 5% Quiet + 5% Scenic.
- Twisty and Speed count equally and are **combined** (geometric mean), so a road needs both: a twisty road you have to crawl through, or a fast road with no corners, can't ride on one of them. Other weightings were compared; the top 20 barely changes between them, so speed-limit accuracy matters far more than the exact weights.
- **Driver's roads** (the main list and the default map view): paved, and a speed limit of at least 40 mph on at least 80% of the stretch.
- **Most scenic**: a separate list sorted by Scenic, any speed. Roads under 40 mph still appear there, in search, and on the map when the filter is off.
- Length is not scored; the default list hides stretches under 3 km (1.9 mi).
- All numbers live in `pipeline/scoring.toml`; every road records the scoring version.

### 3.5 Speed limits (and how accurate they are)
Order of sources, each labeled in the app:
1. **Posted**: OpenStreetMap `maxspeed`.
2. **Estimated from similar roads**: for unposted state and US routes, the limit most similar numbered routes in the same state are posted at in OpenStreetMap.
3. **State default**: for other unposted roads, the state's legal default (Texas 60 mph off state routes, Louisiana 55, Arkansas 55 assumed). Local signs can be lower.

Only about 1 in 10 candidate roads here has a posted limit in OpenStreetMap. An internal check against Texas and Louisiana DOT speed-limit data (read for comparison only; their terms forbid redistribution, so none of it goes into the app or the repo) shows:
- Louisiana state routes: our value matches 95% of the time.
- Texas: after switching numbered routes to "similar roads," exact match went from 4% to 64%, and the 40 mph cutoff agrees 97% of the time.
- Not covered by any DOT data: Louisiana parish roads and Arkansas county roads, where the state default may be too high.

Ways to get more accurate:
- **Community speed reports** (planned for the contributions step): members report the posted limit they saw; two matching reports replace the estimate and show as "posted (reported by members)."
- **Ask the DOTs for permission** (Ethan's call): TxDOT allows distribution with written consent, and LaDOTD offers a release agreement. With either, their official limits could be loaded directly. ARDOT publishes speed-limit and curve-advisory sign data with no stated license, so it would need a request too.
- **Mapillary** street-level sign detections (free, CC BY-SA, needs a free account and token) as a later option.

### 3.6 Labels
- Map-found roads: **Candidate**.
- User-submitted roads: **Community submitted**.
- Either becomes **Verified** once 3 different members verify it and verifies outnumber flags (a submitter's own vote does not count). 3 flags that outnumber verifies mark it **Flagged: not worth it**, hidden by default but still listed when the filter is off.

### 3.7 Re-running the data script
`python -m pipeline fetch|score|load|score-pending --region shreveport`
- Downloads extracts and elevation tiles only when newer ones exist.
- On reload, a new candidate is matched to an existing road by geometry overlap (at least 80%), so ratings, notes, and verifications stay attached when OpenStreetMap ways get split or renumbered.
- Roads that no longer qualify are marked retired, never deleted (their community data stays).
- `score-pending` fills in scores for community submissions (see 4.4). It runs on a scheduled GitHub Action every hour, same Python code, so there is one scoring implementation.

### 3.8 Elevation and land cover sources
- US regions: **USGS 3DEP 1 arc-second** (about 30 m), public domain, and bare-earth, which matters here: a surface model would read pine canopy as hills.
- Outside the US: Copernicus GLO-30 as the documented fallback (free with attribution; it is a surface model, so forested roads read a little rough, noted in the README).
- Land cover for forest and water: **ESA WorldCover 10 m (2021)**, CC BY 4.0, global. Added in step 2 because OpenStreetMap barely maps forest in this region.

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
- **README:** what it is, screenshots, how scoring works, data sources and licenses, future ideas (native apps, turn-by-turn navigation, live location sharing, push notifications on iPhone without installing, more regions), link to https://mancolabs.dev/lab/, and: "Built with Claude Code. I designed, directed, reviewed, and tested it."

---

## 9. Decisions (my picks; change any)

1. **Name:** Sunday Line.
2. **Legal contact email:** ethanmanco@gmail.com (decided 2026-11-18: a personal project, nothing tied to Manco Labs).
3. **Hosting:** Vercel + Next.js. Links start as `<name>.vercel.app`; a `mancolabs.dev` subdomain can come later.
4. **Sign-in:** email magic link. Note: Supabase's built-in email sender allows only a few emails per hour, fine for a demo; real use needs a free SMTP service (for example Resend).
5. **Who creates meets:** the organizer and moderators who have the "create events" permission (see section 11).
6. **Verification:** 3 members to verify.
7. **Public groups:** joining needs admin approval (per your spec). Private groups: the invite link is the approval.
8. **Repo:** public `ethanmanco/<name>`, pushed as ethanmanco, then gh switched back.

## 10. Known limits

- Supabase free projects pause after about a week with no traffic; a portfolio visitor may hit a paused project. Upgrading or a weekly keep-alive ping fixes it (your call later).
- Rural stop signs and surfaces are often untagged in OpenStreetMap, so Flow and Surface lean on estimates; labeled as such.
- Community submissions show up immediately but their scores fill in within the hour (scheduled scoring job).
- No moderation and no report button, per your rules; the legal contact email is the only channel for notices.

---

## 11. Additions from your 2026-11-18 review

### 11.1 Better road checks (built in the data script)
- **Gravel detection from aerial photos.** Most rural roads here have no surface tag in OpenStreetMap, and many are gravel. The script samples small clips of USDA NAIP aerial imagery (public domain, about 1 m per pixel, with infrared) along every road, reads the color of the open ground at the centerline, and learns from the roads whose surface is tagged. It reports its own accuracy. Roads it thinks are gravel leave the Driver's roads list and go to a **Gravel / rally** list (off by default in the app). Roads mapped as paved but that look like gravel are flagged.
- **Neighborhood detection.** Buildings within 60 m of the road (Overture Maps buildings, which include Microsoft and Google footprints) plus driveways. At 10 or more homes per km (a house about every 100 m), the road is treated as a neighborhood street and leaves the main list. The typical rural road here has about 4.
- **Off-road parks, motor venues, parks, and fee areas.** Areas from OpenStreetMap plus places from Overture Maps (ATV parks, race tracks). A road inside one, or within 400 m of an off-road or motor venue, leaves the main list; roads inside parks are labeled "may charge entry."
- **Loose gravel on paved roads** can't be seen from the air, so it becomes part of community ratings (11.4).
- **Local list** uses miles: driver's roads within 50 miles of home, adjustable in the region file and as a slider in the app.

### 11.2 Fast road checking (built)
`review/index.html` is a road-check page: list on the left, map on the right, a Satellite button, Street View and Google Maps links, and one-tap verdicts (Good, Gravel, Neighborhood, Off-road or private, Too slow, Not sure) with keyboard shortcuts. Verdicts export to a file that the scoring uses as corrections and the gravel detector uses as extra training data. In the app, the same idea becomes the community **Verify** flow.

### 11.3 The map look
- **OpenStreetMap is the data, not the look.** The map you saw through the report links is the OpenStreetMap website's own style. Our map draws the same data with our own style, and every layer is ours to change: road colors and widths per road type, water, forest, parks, labels, fonts, and our scored roads on top. The review page already uses a first custom theme (charcoal ground, muted forest, deep blue water, quiet gray roads, scored roads glowing from blue through amber to red).
- **Satellite view:** USGS aerial imagery (public domain, free, no key, US only) as a toggle, with our labels and road lines on top. For regions outside the US later: Sentinel-2 cloudless imagery (10 m, free) is the fallback.
- No paid map APIs are needed for either.

### 11.4 Road ratings (community)
Signed-in members rate a road they drove on: **Fun** (1 to 5 stars), **Pavement condition** (smooth, some patches, rough, loose gravel on the surface), **Traffic** (empty, light, busy), plus "I drove it," car or motorcycle, best direction, and a note. Once a road has enough ratings, Fun and Pavement condition feed its Overall score, and a road that members mark "loose gravel" gets a warning chip.
Members can also **report the posted speed limit** they saw; two matching reports replace our estimate.

### 11.5 Profiles
- **Profile page:** display name, banner image, avatar, a short bio, "What I drive" (one or more vehicles with year, make, model, and a photo), and a gallery of photos and GIFs.
- **Preset avatars:** original illustrated cars and bikes by body style (roadster, hot hatch, muscle car, JDM coupe, truck, sport bike, cruiser, adventure bike, and so on), in several colors. **Car brand logos are not included**: they are trademarks, and using them as avatars could draw a takedown, even on a portfolio project. Users can upload their own picture instead.
- **Uploads:** JPEG, PNG, WebP, and GIF. Banner and avatar up to 5 MB; gallery images and GIFs up to 8 MB each, 24 per profile. Stored in Supabase Storage. Supabase's free plan includes 1 GB of file storage, which covers a portfolio launch; heavy use would need the paid plan.
- **Privacy:** profiles are public by default with a "private profile" switch (only followers see the gallery and vehicles). EXIF data, including GPS location, is stripped from uploaded photos before they are stored, since phone photos often carry the spot they were taken.

### 11.6 Follows and messages
- **Follow** anyone. Followers and following lists show on profiles (hidden for private profiles).
- **Direct messages** between two people, and **group chats** for each car or bike group (members only). Text, emoji, and GIFs from the user's own uploads; real-time via Supabase Realtime.
- **Who can message me:** everyone, people I follow, or nobody. **Block:** a blocked person can't message you, see your private profile, or find you in search. These are controls each user has over their own space; there is still no moderation of content and no report button, per your rules. The legal contact email stays the channel for legal notices.

### 11.7 Groups: organizer and moderators
- **Roles:** organizer (the creator), moderators, members. ("Owner" and "admin" in sections 4 to 7 now read as organizer and moderator.)
- **Moderators** can approve join requests and remove any member. They can't remove the organizer, and only the organizer can remove a moderator.
- **The organizer** adds and removes moderators and chooses each moderator's permissions: approve requests, remove members, create events, create private events, manage invite links, manage spots. The organizer can hand the organizer role to someone else.
- **Private events:** visible only to group members (or people holding the event's private link). Created by the organizer and moderators with that permission.
- **Event notifications:** when an event is created, changed, or canceled, every member gets an in-app notification and an email (each member can turn email off), plus a reminder the day before for people who RSVP'd Going or Maybe. Email goes through a free sending service (for example Resend, free for 3,000 emails a month), which you'd sign up for. Browser push notifications come later; on iPhones they only work when the site is added to the home screen.

### 11.8 New tables and their rules

```
profiles (added)    banner_path, avatar_path, avatar_preset, bio, is_private, dm_policy (everyone | following | nobody)
vehicles            id, user_id, kind (car | motorcycle), year, make, model, photo_path, sort
profile_media       id, user_id, path, kind (image | gif), caption, sort, created_at
follows             follower_id, followee_id, created_at
blocks              blocker_id, blocked_id, created_at
conversations       id, kind (direct | group), group_id (for group chats), created_at
conversation_members conversation_id, user_id, last_read_at
messages            id, conversation_id, sender_id, body, media_path, created_at, edited_at, deleted_at
notifications       id, user_id, kind, payload, read_at, created_at
notification_prefs  user_id, email_events, email_messages
group_members (changed) role (organizer | moderator | member), permissions (set of: approve, remove, events, private_events, invites, spots)
road_ratings (changed)  fun (1-5), pavement (smooth | patchy | rough | loose_gravel), traffic (empty | light | busy), vehicle, drove_it, direction_note
speed_reports       road_id, user_id, posted_limit, reported_at
```

| Table | Read | Write |
|---|---|---|
| vehicles, profile_media | anyone, or only followers when the profile is private; never someone you blocked or who blocked you | owner only |
| follows | anyone (hidden for private profiles except to the person) | the follower adds and removes their own |
| blocks | only the blocker | only the blocker |
| conversations, conversation_members, messages | **only members of that conversation**; group chats only current group members | send only as yourself, only into conversations you belong to; direct messages only if the recipient's message setting allows it and neither has blocked the other (checked in the database) |
| notifications | only the recipient | created by database functions only; recipient marks read |
| group_members | members of that group | role and permission changes only through functions that check the organizer or a moderator's permission |
| Storage: avatars, banners, profile media | public files, except a private profile's gallery (followers only, through signed links) | each user writes only inside their own folder |
| Storage: message media | conversation members only (signed links) | sender only |

Security tests add: a non-member can't read a group chat or a direct conversation by guessing its ID; a blocked person can't send a message; a private profile's gallery can't be fetched by a non-follower; a moderator without the permission can't create a private event or remove another moderator.

### 11.9 Build order (updated)
After you okay the road list: map and list, sharing, accounts and road ratings, **profiles and follows**, groups (with moderators), events and notifications, **messages and group chats**. Each step still lands in small commits.

### 11.10 Map and list (built 2026-11-18)
The road list is served as a static file (`public/data/<region>/roads.json`, written by `python -m pipeline export`) instead of from Supabase. Roads are public and change only when the data script runs, so a file is faster, free, and keeps working if a free Supabase project pauses. Supabase arrives with sign-in, ratings, groups, and meets; member ratings will be read from the database and joined to these roads by road ID.

### 11.11 Pavement score (added 2026-11-18, after your second road check)
Your check of the top 20 found 6 gravel roads and 9 rough ones, all county or parish roads. Aerial photos alone missed them. Changes:
- **Federal road data (FHWA HPMS 2024, public domain)** is matched to every road: who maintains it (state, county, city), surface type (Arkansas reports unpaved county roads), posted speed limits (about a quarter of Texas road sections), traffic counts, and measured roughness where the state samples it.
- **Pavement score (0 to 100)** starts from who maintains the road: state highways 85, Louisiana parish roads 60, Arkansas county roads 55, Texas county roads 40 (from your check: 2 of 16 Texas county roads near the top were good, 5 of 8 parish roads). Busy county roads (1,000+ cars a day) get +15, measured smooth or rough pavement +10 or -10, aerial photos that look like gravel subtract. Your checks always win.
- **Driver's roads need Pavement 55 or more.** Lower roads go to "Needs a check" with the reason, so a quick Street View look (or the community Verify flow later) can bring them back.
- **Overall weights (v3):** Twisty 28, Speed 28, Pavement 16, Flow 12, Elevation 10, Quiet 4, Scenic 2.
- **Quiet** now uses traffic counts where the state has them.
- The road-check page has a new "Rough pavement" verdict.


### 11.12 Usernames (added 2026-11-19, your request)
- **Every profile has a unique username**: 3 to 20 lowercase letters, numbers, or underscores. "Mango" and "mango" count as the same name. A short list of names is reserved (admin, support, sundayline, and similar).
- It is the handle for profile links (`/u/<username>`), follows, and messages later. The display name stays free-form and optional; it falls back to the username.
- People can change their username; the old one is then free for someone else.
- The database enforces all of this, so no app can skip the rules. The profile page checks availability as you type.
- Existing profiles got a username from their display name.

### 11.13 Keeping a phone app possible
If Sunday Line takes off, a phone app (likely React Native with Expo, one codebase for iPhone and Android) should reuse everything except the screens. What keeps that open:
- **Rules live in the database.** Who can read or change what, unique usernames, and limits are enforced by Supabase, not by website code. A phone app talks to the same database and gets the same rules.
- **No website-only server code for data.** The site reads and writes Supabase directly with the public key. Anything that must run on a server goes in a Supabase Edge Function, which a phone app can call too, not in a Next.js API route.
- **Road data is one static file** (`roads.json`) that a phone app can download as is.
- **Shared logic stays plain TypeScript** (`lib/roads.ts`, `lib/polyline.ts`, scoring labels) with no browser-only code, so it can move into a shared package.
- **Links use stable paths** (`/road/<id>`, later `/u/<username>`, groups, meets) so they can open the app directly later.

Things a phone app will need first:
- **Sign-in by code.** Email links open a browser, not the app, so the 6-digit code matters on phones. That needs a custom email sender (see `docs/setup.md` step 5).
- **In-app account deletion.** Apple and Google both require it. The website should get "Delete my account" before then (an Edge Function, since removing the sign-in record needs a server key).
- **A decision on reporting.** Apple's and Google's store rules for apps with user posts require a way to report objectionable content and block abusive users. That conflicts with the "no report button" rule for the website. A block feature is already planned. Reporting would need your call before an app store submission; the website is not affected.

### 11.14 Profiles and follows (built 2026-11-19)
- **Profile:** username, display name, avatar (an uploaded photo or one of 72 original drawings: 8 body styles in 9 colors, no brand logos), banner, bio up to 300 characters, and a private switch. Public page at `/u/<username>`, editing at `/me`.
- **Cropping (added 2026-11-19):** picking a profile photo or banner opens a crop step: drag to move, pinch, scroll, or slider to zoom, arrow keys and +/- for keyboard users. Banners are 5:2 (1500 by 600), a little taller than the first 3:1 version.
- **Garage:** up to 10 cars or motorcycles with year, make (optional), model, and a photo. The old one-line "what I drive" moved into the garage.
- **Photos:** up to 24 photos or GIFs, each up to 8 MB, with captions.
- **Follows:** public profiles follow instantly. **Following a private profile sends a request the owner approves** (my call: if anyone could follow and then see, the private switch would mean nothing). Switching to public approves everyone waiting. Owners can remove followers. Counts are always public; the lists follow the same privacy as the garage.
- **Private profiles** hide the garage, photos, and follow lists from anyone but approved followers. Name, picture, banner, bio, and road ratings stay public.
- **Blocking** is private to the blocker. It removes follows both ways, stops new ones in either direction, and hides the garage and photos from the blocked person even on a public profile.
- **Files:** avatars and banners are public files. Garage and gallery photos are not: each view gets a link that expires in an hour, and storage checks the same rules as the database before handing one out. Everyone can only write inside their own folder, with caps on file size, type, and count.
- **Photo privacy:** photos are redrawn in the browser before upload, which strips GPS and camera data (tested with a GPS-tagged photo). GIFs are kept as is so they still move; the GIF format has no place for GPS. A person who skips this step could only leak their own data.
- **Database tests:** 40 new checks (76 in total) cover all of the above.

Not built yet: search for people, account deletion, and the "who can message me" setting (comes with messages).
