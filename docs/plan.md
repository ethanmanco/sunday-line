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

### 11.15 Garage photos, re-cropping, groups, and messages (built 2026-11-19)
- **Garage photos:** up to 8 photos per vehicle, swipeable on the profile. The first is the cover; "Make cover" changes it.
- **Re-cropping:** when you upload a profile photo or banner, the uncropped version (already resized and stripped of location data) is kept privately with the chosen crop. "Adjust crop" reopens it, so you never upload again just to reframe. Only you can open your uncropped pictures.
- **Groups:** public or private. Public groups are listed and searchable; the organizer picks "anyone can join" or "they ask, you approve." Private groups are invisible to non-members and grow through invite links.
  - Roles: one organizer, moderators, members. The organizer gives each moderator any of: approve join requests, remove members, make invite links. Moderators can remove members but never other moderators or the organizer. The organizer hands off the role before leaving.
  - Invite links: 128 random bits, shown once, stored only as a hash. Optional end date and use limit; revocable.
  - Share previews never name a private group, and invite pages use a generic title.
- **Messages:** direct messages and a chat for every group, with photos and GIFs, live updates, unread counts, and edit or delete for your own messages.
  - "Who can message me": everyone, people I follow, or nobody. Checked on every message. People you message first can always reply.
  - Blocking stops direct messages both ways. In group chats, messages from people you blocked are folded away on your screen.
  - Chat photos are only readable by people in that conversation.
- **Database tests:** 152 in total (67 new), including that outsiders can't read or post in a conversation by guessing its ID, invite links stop at their limit, and moderators can't do what they weren't given.

Still to come (next step): events with RSVPs, private events, spots, and notifications. Moderator permissions for events and spots are already in the database.

### 11.16 Group pages, spots, and the public review (built 2026-11-19)
- **Group pages** have a picture and a banner (organizer only, cropped and re-croppable like profiles). Group pictures are private files: only people who can see the group get a link, so a private group's pictures never leak.
- **Spots** are places people save. Two kinds:
  - **A place:** a pin for a meetup spot, scenic stop, food, gas, parking, a track, or other. Meetup spots will be what events point to.
  - **A road:** tap a road on the map, keep the whole road or slide a start and an end. Suggested roads (our scored list) are highlighted and picked first. Any other road works too: tapping it traces that named road from the base map (OpenFreeMap, OpenStreetMap data) as far as the loaded map goes. Unnamed roads, trails, or anything the trace gets wrong can be drawn by tapping points along it, with undo. The chosen stretch is saved with its own line, so it keeps drawing even if the road data changes (for example when the app expands to the whole country).
- **Your library** (`/spots`) has every spot you made, personal or added to groups. Add a spot to a group with one tap (a copy for that group).
- **On your profile:** show all your spots, only ones you pick, only your own spots from groups you pick, or none. Private profiles still limit them to approved followers. Group membership alone never puts someone's group spots on their profile.
- **Group spots:** members suggest, managers accept or decline. Managers are the organizer and moderators with the new "spots" permission. Declining or removing a spot from a group leaves it in its owner's library.
- **The public map:** the owner, or a group's spot manager, can submit a spot. Automatic checks:
  - account at least a week old
  - no links, email addresses, or phone numbers
  - no words on a review list (a short starter list in the database; more can be added in the Supabase SQL editor without putting them in the repo)
  - inside the United States
  - not "other" for places
  - not a near-duplicate of a public spot or an overlapping stretch of the same road
  - no more than 5 submissions a day

  Passing all of them puts the spot on the map right away. Anything else waits at `/admin/spots`, which only the site admin (your account) can open. You approve or turn down with an optional note the person sees, and you can take any public spot off the map. Editing a public spot runs the checks again.
- **On the main map**, public spots show as colored dots (places) and dashed blue lines (roads), with a tap-for-details card and directions.
- **Phones:** a "Full map" button hides the list so the map fills the screen.
- **Database tests:** 188 in total (36 new), including that outsiders never see a private group's spots or pictures, nobody can put a spot on the public map directly, and only the site admin reviews.

If the review queue gets busy later, options include: trusted members whose submissions skip review, more automatic checks, or letting group organizers with a good track record publish directly.

### 11.17 Map layers and private-group spots (built 2026-11-20)
- **Map layers:** a Spots button on the main map shows public spots, your groups' spots (each group can be switched on or off), or both. The choice is remembered in this browser only.
- **Private-group spots never show on profiles**, in any display mode. Only public groups can be picked for "from groups I pick." Enforced in the database.
- **Phones:** the full-map control is a small arrow at the bottom right of the map.

### 11.18 Group events (built 2026-11-20)
- **Who:** the organizer and moderators with the "events" permission create, edit, cancel, and delete events. Members see them and RSVP (going, maybe, can't make it). Nobody outside the group sees anything.
- **Where:** a spot: one of the group's spots, one of the creator's own spots, or a public spot. A copy of the spot is kept with the event, so the event keeps its location even if the spot changes.
- **Hidden until:** right away, 1 hour, 3 hours, 1 day, 2 days, or 1 week before, or a custom number of hours. Until then only event managers see the location; members see when it will be shared. The location lives in its own table so the rule is enforced by the database, not the page.
- **Group chat posts** (each optional): when created (plus cancellations and time changes), a reminder 1 day, 2 days, or 1 week before, and the day of (8 AM in the event's time zone, or an hour before an early start). When a hidden location is released, a post says it's out without naming the place. Posts come from "Sunday Line," not a person; nobody can post as Sunday Line.
- **Timing:** a pg_cron job runs every 5 minutes. A reminder whose moment has already passed when an event is created or moved is skipped rather than sent late.
- **Fix found while testing:** two permission checks treated "unknown" as "allowed" (a Postgres NULL). One was already live: someone outside a group could remove a regular member. Both are fixed and covered by tests; the live one was patched as soon as it was found.
- **Database tests:** 214 in total.

Not built yet: email or push notifications for events (in-app chat posts only), and events visible outside the group.

### 11.19 People, a livelier map, and pages with their map (built 2026-11-20)
- **Find people** (`/people`, the person-plus icon in the top bar): search by name or @username, and "People you may know": people in your groups and followers you don't follow back. Search runs in the database and never returns someone who blocked you or whom you blocked.
- **Map layers:** "My spots" joins public spots and each of your groups, with shortcuts for only mine, only groups, only public, or all.
- **Adding from the map:** a + button (bottom right of the map) opens "Add a road" and "Add a place". The spot editor opens over the map at the view you were looking at. After saving, the map shows your spots and flies to the new one.
- **Phones:** the map takes more of the screen, with the top roads in view as swipeable cards along the bottom. Swiping lights up each road; tapping opens it. "Roads" in the top bar gives way to the logo (which goes to the same place) to make room for People and Messages.
- **Profiles and groups with their map:** on wide screens (1100 px and up), the page sits on the left and a map of its spots on the right; "Show on map" on a spot zooms there. On phones a "Map" button flips to a full-screen map with a back button to the page. Group pages show accepted spots to members and only public-map spots to everyone else; profiles show what the owner chose.
- **Filters:** the one-line description under the road views is gone (it's a tooltip on each button now).

### 11.20 One map for everything (built 2026-11-20)
The map is the app. The road list, a road, a profile, a group, and an event all open on the same map instead of separate pages, so moving between them never leaves the map. Ordinary pages (groups list, messages, people, your settings, about) stay full pages.
- **Wide screens:** a panel on the left (wider for profiles, groups, and events), the map on the right.
- **Phones (portrait):** the map fills the screen. Pages come up as a sheet: halfway by default, with a handle to go full height and a Map button to tuck it down. On the home screen the list is behind "List and filters"; the road and spot cards along the bottom do most of the work. No more arrow; the + stays.
- **Phones on their side:** like a wide screen, page on the left, map on the right, no cards.
- **A page's spots take over the map** while it's open (a profile's chosen spots, a group's spots, an event's location), with "Show everything" to bring the rest back.
- **Adding a spot happens on the main map:** pick the place or tap the road right there; the settings sit in the panel or sheet. Group pages use the same map for their "Add a spot".
- **One "Show" control** covers roads (Driver's roads, Scenic, Gravel, All, or Off) and spots (Mine, Public, each group). The list, the cards, and the map all follow it. "Closest first" mixes roads and spots by distance from you or the home town; score sorts list roads first, then spots by distance.
- **Buttons, not underlined text:** action links became small buttons, and spot cards open the spot on the map when tapped, with Directions as one button.
- **Group pictures** show in the inbox and group chat headers.

Domain for email: not needed yet. Free stopgap when friends join: send sign-in email through Gmail with an app password. Proper fix: a domain (about $10 a year, at cost through Cloudflare) plus Resend's free plan.

### 11.21 One spot, many groups (built 2026-11-21)

- **No more copies.** Adding a spot to a group used to copy it, so the same place showed twice in All. Now a spot is one row owned by its creator, and a `spot_groups` link table says which groups it's in, each with its own status (suggested or accepted). The migration folded existing copies (same owner, name, and place) back into one spot that keeps all its groups.
- **Rules kept:** members see a group's accepted spots plus their own suggestions; managers see all suggestions. A spot in any private group never shows on a profile, even with "All my spots". Visitors see only the public-map spots a public group shared.
- **Your spots is on the main map** like profiles and groups. Each spot's groups show as chips (tap to take it out); "Add to a group" puts the same spot in another group.

### 11.22 Nationwide pipeline, Arkansas first (built 2026-11-21)

- The pipeline runs one state at a time: `python -m pipeline states` writes a region file per state, and `python -m pipeline state --region ar --cleanup` downloads, scores, exports, and deletes the state's raw inputs. `SUNDAY_LINE_DATA` moves the data folder to another drive. A home town is optional.
- Arkansas took 24.7 minutes, peaked at 2.4 GB of disk, and kept 30 MB. It added 2,855 roads (1,136 driver's roads). The site now covers Arkansas and the Shreveport area.
- Estimate for the lower 48 plus DC: 15 to 25 hours, about 160 GB downloaded (one state at a time), Texas needs about 18 GB at its peak. Alaska needs its own plan.
- Open decisions: speed limits outside TX/LA/AR show as "estimated"; county road pavement baselines exist only for TX/LA/AR; the aerial-photo gravel check is skipped for state runs.

### 11.23 Spot taps and the road panel (built 2026-11-21)

- Tapping a road spot finds the scored road it sits on (its saved road, or for a hand-drawn line, a scored road it follows at least 60% of the way within 45 m) and offers "Road stats". The card also links to the person who added it and the groups it's in (only groups the viewer can see).
- The road panel's All roads and Share bar sits outside the scrolling part, so nothing shows above it on iPhones, and every road opens scrolled to the top.

### 11.24 Editing spots works (fixed 2026-11-21)

- Every spot edit failed because the editor sends the spot's kind, which wasn't in the columns people may update. Now it is (the shape check still applies). The save error says what actually went wrong instead of always blaming the name.

### 11.25 Spots open like roads; privacy rules (built 2026-11-21)

- Tapping a spot (map, list, or card) selects it like a road: a white outline on the map, and on the home map the panel opens its details. A road-spot on a scored road opens that road's full stats with a "Saved spot" box on top (who added it, its groups, how much of the road it covers). Pages (profiles, groups, Your spots) highlight the spot's card instead. The map popup is gone. Back and forward move between spots.
- Road-spots on scored roads show the road's score in lists and cards instead of a dot.
- A spot's groups are all private or all public. Spots are picked for the profile one by one ("Show on profile"); the old all/groups/none modes were folded into those picks. Spots in a private group can't be picked. Approved followers of a private profile see its picks.
- Scores for a trimmed stretch: not yet. The scores are for the whole road; the box says so. Stretch scores need the pipeline to save per-section data (see 11.26 if built).

### 11.26 Scores for a stretch, spot colors, quiet star link (built 2026-11-21)

- The pipeline saves each road's simulated drive in 16 equal sections (distance, time, cornering load x time, speed scrubbed, left-right changes). The app adds up the sections a saved stretch covers and runs the pipeline's own Twisty and Speed formulas (constants in index.json "stretch"); Elevation comes from the road's height profile, calibrated to its measured climb and descent; Overall is recomputed with the stretch's Twisty, Speed, and Elevation and the road's Pavement, Flow, Quiet, and Scenic. Whole-road sums match each road's scores within 1 point (checked on Delaware's 251 roads; pipeline test added).
- States finished before this are re-run after the all-states run (`scripts/rerun_without_bins.py`). Hawaii's box is fixed to the main islands (its extract reaches Midway; 11.5 GB land-cover grid).
- Spots use one cool gradient (teal, sky, lavender) instead of category colors, so they read apart from the warm Driver's road ramp. Road spots draw the gradient along their length.
- A quiet "Star it on GitHub" line sits at the bottom of the account page (the About page has the main button).

### 11.27 Scoring roads on request (built 2026-11-21)

- A road-spot that isn't on a scored road shows "Score this road" to its owner. That queues it (`road_scores`, 20 requests a day per person). Anyone who can see the spot sees its score, so a spot on the public map carries its score; changing the line clears it.
- `.github/workflows/score-roads.yml` runs hourly (free on a public repo) and on demand: `python -m pipeline.score_queue` claims up to 20 requests and scores each with `pipeline/score_line.py`, which fetches only that road's corridor: OpenStreetMap through the Overpass API (classes, posted limits, surface, lanes, signs, signals, crossings, side roads, woods and water), federal HPMS sections (owner, roughness, traffic, unpaved, FHWA limits), and USGS 3DEP elevation (bridges skipped, as in the pipeline). Then the pipeline's own drive model and formulas. Scenery is estimated from map data instead of satellite land cover. About 40 to 60 seconds a road.
- Checked against Old Jena Road: Overall 60 vs the pipeline's 61; Pavement equal; Twisty and Speed within 5 (the saved line is simplified). That road's pipeline elevation was flat because it runs past the Shreveport region's DEM tiles; the on-request USGS profile is right, and the Louisiana state run fixes the pipeline copy.
- Setup: one repository secret, SUPABASE_SECRET_KEY (the project's secret key). Without it the workflow does nothing.

### 11.28 Car and bike photo profile pictures (built 2026-11-21)

- "Pick a drawing" is replaced by "Pick a car or bike": 200 CC0 and public-domain photos (147 cars, 25 trucks, 28 motorcycles) found through Openverse, cropped to 256 px WebP (2.7 MB total), in public/avatars/library with index.json and CREDITS.md. Search by make, model, or decade, or tap a kind (Classics, Muscle, 80s, 90s, 2000s, JDM, Euro, Sports cars, Supercars, Hypercars, Trucks and SUVs, Rally and race, Bikes). The picked photo's credit shows under the grid.
- Saved as avatar_preset "lib:<id>" (the database allows only letters, numbers, and dashes). Old drawings still render for anyone who had one. No brand logos (trademarks). 38 photos had readable licence plates, which were blurred. Scripts in scripts/avatars.
- Thin spots: motorcycles (28), and no usable C8 Corvette, NASCAR, monster truck, or adventure bike under these licenses.

### 11.29 Public groups on profile spots (built 2026-11-21)

- Spot cards on a profile show "In <group>" links for the public groups each spot is in (accepted links only). `profile_spot_public_groups(p_user)` only covers spots the viewer can see on that profile; private groups never appear.

### 11.30 Roads for the whole country (published 2026-11-22)

- Every state but Alaska, plus DC and the Shreveport area: 115,854 roads in 934 squares, about 205 MB in `public/data/us`, every road with drive sections for stretch scores.
- Lessons from the run: Geofabrik moved its state files into per-state folders and briefly answers "not found" while it posts each day's files, so state map downloads wait and retry (elevation tiles do not, since ocean tiles never exist). Rare native crashes are one-offs: re-run the step that failed. Run the pipeline with the project's `.venv` Python.
- Speed limits outside Texas, Louisiana and Arkansas are mostly estimated, and county pavement baselines exist only for those three states.
- Not done: Alaska needs its own plan.

### 11.31 Road squares on GitHub Pages (2026-11-22)

- Vercel's free plan takes at most 100 MB of static files per deploy, and the national road squares are about 200 MB. The squares (`cells/`) now live in the public repo ethanmanco/sunday-line-data and load from https://ethanmanco.github.io/sunday-line-data (open CORS, free, 1 GB site limit). The small files (index.json, road-cells.json, top.json, blocks/, about 6.5 MB) stay on Vercel.
- Updating data: `python -m pipeline tiles`, then `python scripts/publish_cells.py` (pushes as ethanmanco; replaces the data repo's history with one commit), then commit the small files here.
- Developing: `.env.development.local` sets `NEXT_PUBLIC_CELLS_BASE=/data/us` to read local squares.

### 11.32 Find a town (built 2026-11-22)

- A search box on the map (top left; next to "List" on phones) finds any of 31,686 US cities, towns and Census places, or a state. Picking a town moves the map there (about 40 by 35 miles) and measures distances from it; the x clears it back to the map center. A state fits the map to the state.
- The list is a static file, `public/data/places.json` (1.3 MB, about 0.5 MB compressed, loaded when the box is first used), built by `scripts/build_places.py` from the Census 2024 Gazetteer and ACS 2019-2023 populations (public domain). Search runs in the browser, so nothing typed is sent anywhere, and the chosen town is kept in memory only, like a location.
- Accepts "Jena", "jena la", "Jena, LA", "Springfield, Missouri"; ranks bigger places first. Alaska and Puerto Rico are left out (no road data).

### 11.33 Every public road counts (2026-11-22)

- Your call: city roads can be fun too, so nothing is left out for being in a city. Candidates now include residential streets, living streets, named service roads, and divided highways (interstates and expressways), not only primary to unclassified roads. Ramps, dirt tracks, private roads, one-way city street pairs, and unnamed driveways and parking aisles stay out.
- Driver's roads: speed limit at least 35 mph on 80% of the stretch (was 40). "Runs through a neighborhood" no longer keeps a road off the list; homes per km and built-up share are still recorded. Parks, fee areas, off-road venues, pavement and surface rules are unchanged.
- The curvature rule is unchanged (at least 2 km with 300 m of weighted curve, split at mile-long straights), so a straight city grid still finds nothing. That rule is what the app is for.
- Speed score: 25 mph average scores 0 (was 35), so 35 mph roads can rank. Scoring version 4-draft.
- Estimated limits count too (your call, 2026-11-22): a road with no posted limit that we estimate at about 35 mph makes Driver's roads. In West Virginia that is about half of the 3,550 driver's roads. The option of requiring 40 for estimated limits was offered and declined.
- Unposted city streets get 25 mph (living streets and service roads 15), never a state's rural default. Many rural roads are mapped as "residential", so that applies only where at least 12% of the land within 100 m is built up (ESA WorldCover) or the road passes 10 or more homes per km; elsewhere they get the rural default. In Louisiana most "residential" roads are rural parish roads (median 2.7 homes per km), which now count like any other parish road. The first Louisiana test lost 14 good rural roads before this fix. Unposted interstates use the state's typical posted limit, else 65 mph. A built-up city street with no known owner counts as city-kept for Pavement.
- Divided highways are two one-way halves on the map; both chain, and the curvier half is kept when the two run within 150 m of each other with the same route number or name.
- Published in steps: Louisiana first (2026-11-22, your ask, to see the Shreveport additions: 28 to 105 driver's roads within 25 miles), merged with every other state's earlier data; the other states follow when the rebuild finishes. The old Shreveport-area region output is left out of the merge, since the Louisiana, Texas and Arkansas state runs cover it.
- Geofabrik points its "latest" links at the day's files before posting them (404 or 503 for a while each evening), so state map downloads fall back to the previous days' dated files.

### 11.34 Landmarks on the map (2026-11-22)

- Your ask: show what's around the roads. The map now labels national parks and monuments, state parks and forests, national forests, wilderness areas and wildlife refuges (each with a tree icon, sorted by name because the tiles' park types are inconsistent), mountain peaks and passes with elevation in feet, volcanoes (own icon and color), viewpoints (zoom 12 and closer), and lake and reservoir names. Park outlines are drawn from zoom 7.
- Everything comes from the OpenFreeMap tiles the map already uses (OpenStreetMap data, already credited), so there is no new service, key, or cost. Icons are drawn in the browser.
- Zooms: peaks and volcanoes from 7 (the tiles have no peaks before that), only the most prominent peaks until 11; passes from 11. Park names were raised the same day on your note that they covered the roads: national parks from 9 (was 5), national forests and state parks from 10 (were 7 and 8), wilderness and refuges from 11 (was 9).
- When labels collide, volcanoes win, then national parks, then other peaks; a park's name always shows with its icon or not at all, never a lone icon. Labels stay visible over the satellite view.
- Not in the tiles: waterfalls. Doing those would mean adding them to our own data.

### 11.35 Driver's roads need 30 Overall (2026-11-22)

- Your call: a driver's road scoring under 30 Overall moves to All, with the reason "overall score under 30". `min_overall = 30` in `pipeline/scoring.toml`; applied when building and again when merging squares (`pipeline/tiles.py`), so states built before the rule follow it. A road a person checked as good stays. At the time: 56 of 22,450 driver's roads nationally, 29 in Louisiana (another 126 there score in the 30s).

### 11.36 Making a picked road longer (2026-11-22)

- Your ask: when adding a road, "Longer at the north end" / "south end" (or east and west; named by compass so you know which end is which) continue the road past that end. The map moves to that end at zoom 14 (the base map only carries every road name there), finds the base map road running out of the end by where it runs, not by name, and follows it as far as the loaded map goes; press again to go farther. It works from what's shown, trimmed or not.
- The divided-road rules from tracing apply: no U-turns, and anything running beside the road you already have is the other side, not more road.
- A suggested road that's made longer becomes your own road line; its scores stay with the original, and Score this road can score the longer one.
- Checked on the real map: Clyde Fant traced to 3.9 mi grew to 6.8 mi (one side end to end) in four presses, never doubling back. Tests use real map pieces for Clyde Fant and Arthur Ray Teague.

### 11.37 Reviews: how far you'd drive, not stars (2026-11-22)

- Your point: 5 stars mixes "great for Shreveport" with "great anywhere". Reviews now ask "How far would you drive for it?" (Skip it, Fun if you're nearby, Worth a detour, Worth a road trip), which means the same in every state, plus a separate "One of the best roads around here" tick for local gems. The summary shows the most common answer ("Worth a detour, say 3 of 4") and how many call it a local best.
- Other options considered: stars with written meanings (still invites grading on a local curve), or two scores (local and national; twice the work for every review). No live ratings existed, so the old 1 to 5 "fun" column was replaced outright.
- Every part of a review is optional: it can be just a flag, just pavement, or just a note.

### 11.38 Flags and road checks (2026-11-22)

- Review flags: Gravel or dirt road, Private/gated/no entry, Closed or doesn't go through, Police often here. "Poor quality" is Pavement: "Poor, broken up".
- Three members flagging the same thing (police excepted, it's information only) put the road in a check queue at /admin/roads (linked from your profile next to Spot review). Your own flags (as @mango, the site admin) are accepted the moment you save. "It's fine" dismisses a check; three newer flags bring it back. Accepted checks apply in the app right away: gravel moves the road to Gravel; private, closed, or poor pavement move it off Driver's roads, with the reason shown.
- Not yet: feeding accepted checks into the data pipeline's verdicts, so a rebuild keeps them in the data itself (the app keeps applying them meanwhile).

### 11.39 Heads-ups (2026-11-22)

- My recommendation, since there are few members yet: short-lived notes on the map, called heads-ups. Kinds and how long each lasts: Police and Animal 1 hour, Crash and Stalled car 2 hours, Something on the road 3 hours, Oil or spill 4 hours, Road work and Flooding 12 hours.
- Post from + then Heads-up, tap where it is (tap again to move it), pick the kind, optional note (120 characters). Others can say "Still there" (restarts its time) or "Gone" (two of those end it); the poster can take it down. Expired ones are deleted after a day (hourly job).
- Privacy: heads-ups show without the poster's name, and the table can't be read directly; the app reads them through a function that leaves out who posted. A limit of 20 a day per member. Copy never suggests posting while driving, and nothing checks or blocks it.

### 11.40 Notifications (2026-11-22)

- Your ask: a bell in the top bar with a list at /notifications. It covers follow requests (Accept or Decline right there), new followers, accepted requests; group invites (Join or Decline), join requests (to organizers and moderators who approve), approvals; new events (the whole group), time changes, cancellations, reminders, and the location going out (people going or maybe); new messages (one line per chat, counting up, cleared when you read the chat); Score this road finished; a public spot approved or not; group spot suggestions and acceptances; and "Your flag helped mark X as gravel" when a road check you contributed to is accepted. As site admin you also hear when a road check or a public spot is waiting.
- Direct group invites are new: group settings have "Invite a member" by username (needs the invites permission). Until now groups only had invite links.
- Rows are written only by the database (triggers and functions), so they always match what happened, and nobody is told about anything done by someone they blocked or who blocked them. Opening the page marks everything read; requests and invites keep their buttons until answered. The bell updates live. Read ones are deleted after 60 days, all after 120 (daily job).
- Not yet: email or phone push for notifications (needs the email sender set up for this, and a push service).


### 11.41 Phone card highlight (2026-11-22)

- Your note: on phones the road a card shows can hide behind the cards or the town search. In phone layout only, the road gets a soft glow underneath (it keeps its own color). Revised the same day on your second note: narrower and fainter, since a wide blurred line folds over itself on tight curves, and the other roads no longer dim. Cards light a road only after a swipe. The map doesn't move on its own: the cards list what's in view, so panning would reshuffle them mid-swipe. Desktop is unchanged.
- Phones: dragging the sheet down while a road is open goes back to all roads with nothing highlighted, keeping the same map view.

### 11.42 Account pages in the map panel (2026-11-22)

- Your ask: Groups, People, About, Notifications, Messages, and your profile now open in the map's left panel on desktop, in place of the list, with the map beside them (they moved into `app/(map)`; addresses are unchanged). A chat fills the panel with the message box at the bottom. On phones they open as a full-height sheet over the map.

### 11.43 Installable, with web push (2026-11-22)

- Your ask, after the app-store question: the site is installable (web app manifest, icons from the brand mark, a service worker that doesn't cache pages so the site is always current). On Android Chrome it offers Install; on iPhone it's Share, then Add to Home Screen.
- Web push: the Notifications page has "Turn on notifications" for this device. Every new notification is then also a phone or desktop notification; tapping it opens the right page. A chat pushes once until it's read. iPhones (iOS 16.4 and later) get pushes only from the Home Screen app, and the page says so.
- How it's sent: a trigger on new notifications calls a Supabase Edge Function (`supabase/functions/push`) through pg_net. The function needs no login to call, because it only claims real, unsent, unread notifications (each once, within 15 minutes) through `claim_push`, which only the service role can run. Dead devices are dropped. Push keys: the public key is in `lib/config.ts`; the private key is a Supabase function secret (copy in the gitignored `.env.local`). Signing out removes the device.
- App stores later: once regular phone users ask for it and the report-button question is decided (see 11.13).

### 11.44 Spot and phone fixes (2026-11-22)

- Your notes: (1) phones lose the map's +/- buttons (pinch to zoom; hidden on touch screens only). (2) A spot could only be in groups of one kind. Now a spot can join a private group any time, but can't join a public group once it's in a private one, so a private group's place still never reaches a public group (replaces the all-public-or-all-private rule from 11.25). (3) Only roads go on the public map; places (pins) stay with their owner, groups, and profile. A public road changed into a place comes off. There were no public places when this shipped. (4) Phones: swiping Notifications, Messages, profile, Groups, People, or About down goes back to the full map.

