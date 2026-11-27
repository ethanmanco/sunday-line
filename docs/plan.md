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


### 11.45 iPhone app top, profile, admin queues, photo galleries (2026-11-22)

- iPhone app, fifth try (your call): the blur is iOS's and stays, so in the installed iPhone app only the top bar is 20px taller in portrait (tuned on his iPhone: 28 too low, 8 let the blur halfway over the logo text; none in landscape) and its contents sit lower (--ios-edge); the blur covers plain dark bar. Full height to the bottom is kept.
- iPhone app, fourth try (same day): the blur looked the same through every status bar setting, so it's iOS 26's own top-edge blur. Now an invisible strip is pinned across the top edge in the installed app only (position: fixed, full width, status-bar height, the top bar's background clipped to text so it paints nothing). WebKit skips the blur when an opaque fixed box sits under the top edge; this is the one fix another project confirmed on an iPhone (gravesisme/planestro#574). Also fixed: a phone-only rule had wiped the top bar's status-bar padding. CSS and markup only: close and reopen the app, no re-adding.
- iPhone app, third try (same day): leaving the status bar key out made iOS reserve the status bar strip, so the app stopped short at the bottom and the blur stayed. Back to full screen (black-translucent + viewport-fit=cover), and the top bar is pinned (position: sticky) with a solid background: reports say iOS 26 then fills the status bar with that color instead of blurring. Needs remove and re-add. Map credit: centered, no dark box; on phones it's the compact (i) form that shows on load and folds away after the first drag (OSM's license needs it on the map; full credits are on About). Phone cards moved up a little to clear it.
- iPhone app, second try (same day): since iOS 26.1, the black-translucent status bar style itself makes iOS draw a blur over the top of installed web apps, and the page can't remove it. Following Apple's advice (WebKit bug 317153), the style key is gone: the status bar is solid, in the color of the page's top edge (the dark top bar). The safe-area padding below stays for the bottom home bar and is harmless at the top. Needs remove and re-add on the phone.
- First try: newer iOS draws installed web apps under the status bar and blurs what's behind it, which blurred the top half of the top bar. The app now fills the screen on purpose (viewport-fit=cover, black-translucent status bar): the top bar's dark background reaches up behind the status bar and its contents sit just below it (env(safe-area-inset-top)), so the blur covers plain dark color. Bottom items (cards, buttons, sheet, map credit) clear the home bar. Both spaces are zero on other devices; desktop is unchanged.
- Profile: the avatar in the top bar opens your profile as others see it (Instagram style), with Edit profile (the old /me page) and Your spots buttons. Recommendation taken for phones: Your spots lives on your profile next to Edit profile. The profile's Spots tab still shows only what others see.
- Site admin: spot review and road checks moved from the profile page to a collapsed box at the bottom of Notifications, showing what's waiting and links to the full review pages.
- Photos: vehicle photo strips have previous/next arrows on desktop (phones swipe), and the full-screen viewer is a gallery (arrows, arrow keys, swipe, "2 / 3") for garage photos and the Photos tab.

### 11.46 Phone polish and the Scenic floor (2026-11-23)

- Your notes: (1) the map credit's (i) sits at the right once the credit folds away, a few pixels below the cards, with no focus ring when tapped. (2) Phones: when the map moves and the card under your thumb is no longer the highlighted road, the highlight clears. (3) Tapping the logo while already on the map is a soft refresh: closes what's open, clears highlights, closes the sheet, back to the starting view, and lets go of the tap. (4) Phones: a group's Chat tab opens the sheet to full height with the tabs at the top and the message box at the bottom edge. (5) The Scenic list only shows roads scoring Scenic 50 and up (below that they don't look scenic).
- Install button: a download icon in the top bar of the mobile website only (not the installed app, not desktop). Android Chrome opens its own install prompt; iPhone, where a site can't start the install, shows the three steps (Share, Add to Home Screen, keep Open as Web App on). To fit it, Groups is an icon on phones (desktop keeps the word) and the icons sit a little closer.

### 11.47 Desktop group chat fills the panel (2026-11-23)

- Your note: a group's chat on desktop had empty space under it. The chat now fills the map panel down to its bottom edge.
- Your follow-up: it still meant scrolling down to reach it. Now the chat takes whatever height is left under the group's header and tabs, so the message box sits at the panel's bottom edge with nothing to scroll, on desktop and in the phone sheet. Long chats scroll inside the chat. On a very short window the chat keeps a usable height and the page scrolls instead.

### 11.48 Spot colors say whose a spot is (2026-11-23)

- Your call ("Build it"): spot colors stop being a single gradient and start meaning something. All are cool colors, so they never read as a road score (the warm Driver's road ramp).
  - Your own spots are teal.
  - Each group gets its own color from a palette of seven (Sky, Blue, Indigo, Violet, Cyan, Green, Ice). A new group gets the color its creator's groups use least; organizers can change it under Manage, Group settings, Spot color.
  - Spots on the public map are light slate.
- Road spots: the center line keeps the road's score color when the road is a rated one (your own on-request score, else the road's Overall); the owners' colors are the outline. A road in several of your groups wears one band per color, side by side.
- Places: the map pin is split into equal slices of its owners' colors. The list badge and spot page use the same colors (a ring around score badges, slices on dots).
- Save on road pages: next to Share, saves the whole road to Your spots or straight into one of your groups (suggested if you can't add spots there yourself). One spot per road, so saving it to more groups reuses it; trim it to a stretch later from Your spots. Only roads go on the public map, so places still can't be submitted there.
- Database: groups.color (0 to 6), picked by a trigger at creation, organizers update it.

### 11.49 Map credit centered under the cards (2026-11-23)

- Your note: the (i) and its credit text sit centered in the gap between the cards and the bottom of the screen (on an iPhone, 22px above and below). MapLibre's own 10px margin under it is dropped on phones.

### 11.50 The map starts on the mainland (2026-11-23)

- Your note: the starting view and the logo's reset no longer include Hawaii. They frame the lower 48, centered over the middle of the country. Hawaii's roads are still on the map; pan or search to get there.

### 11.51 The installed app's top: search, messages, you (2026-11-23)

- Your pick from the prototypes (K, "Messages icon + you"): the installed phone app has no top bar. The map runs up under the status bar like Google Maps, with a floating search (the logo on its left goes home, the same soft refresh as before), a round messages button with its unread count, and your avatar with the notification count on it, like Instagram. Under them: Driver's roads, Scenic, Gravel and List as pills.
- Tapping your avatar opens a menu: Your profile, Edit profile, Notifications (with the count), Your spots, Groups, People, About and map credits. Signed out, it shows Groups, People, About and Sign in.
- Only in the installed app held upright, and only on map pages (sign in and site admin keep the top bar). Turned sideways, desktop and the mobile website are unchanged. To try it in a phone browser, add ?app=1 to the address (?app=0 turns it off).
- The search is still the town and city search for now; searching roads, groups and people from it (prototype H) is a later step.
- Your note: the iPhone's blur under the status bar reached the middle of the search text. The installed iPhone app moves the search, pills and avatar menu 14px lower, so the text starts where the old top bar's did (the spot you called perfect, 11.45). Other phones are unchanged.

### 11.52 Spot outlines: rings, thinner, hollow when unrated (2026-11-23)

- Your notes from the phone: the side-by-side color bands looked off. They split apart at the ends, crossed over where a spot loops back (Fern Avenue's median), an unrated spot (Clyde Fant) looked like a solid fat line next to the rated ones, and all spots felt thick.
- Now each owner color is a ring around the line, yours innermost, so ends and loops close cleanly. Rated spots keep the score color in the center; unrated spots have a dark center (hollow), so they read as "not rated yet". Thinner: the center is 2 to 4px and each ring adds 1.5 to 2.5px a side (zoomed out to in), down from 8 to 16px for the whole spot.
- Colors follow the Show choices: with Mine off, your spots drop the teal ring; with a group off, that group's color goes away. A spot with nothing left on shows the light slate public color.

### 11.53 Spot list markers line up (2026-11-23)

- Your note: in Your spots, names sat right against rated roads' score badges, which were much bigger than the plain spot dots. Every marker now sits in the same 52px column: score badges are smaller (36 by 22) with room for their owner ring, and all names start at the same spot.

### 11.54 No contact autofill in the search (2026-11-23)

- Your note: iPhone kept offering to fill in your contact card in the search. Safari ignores autocomplete=off and guesses from the field's words, so "Find a town or city" looked like an address form. The search now reads "Find a place", has its own name, and turns off autocorrect and spell check (place names were getting "fixed").
- The installed app sometimes showing solid bars at the top and bottom between pages matches a known iOS 26 bug in Home Screen apps (WebKit bug 301994, reopened, no working fix yet). Closing and reopening the app clears it. Nothing changed in the app for this.

### 11.55 The map starts on you (2026-11-23)

- Your note: grab the location the first time the app opens and center on it, with no tap if possible. Opening the home map now asks the phone for your location right away (the system prompt is the one tap the browser requires). Allow, and the map centers on you about 50 miles across, with distances measured from you. After that it centers on you every time you open the app, without asking, while location is allowed. If you say no it never asks again on its own; the locate button still works.
- Links to a road, spot or page keep their own view, and a search or tap made while the location loads wins. Only "already asked" is saved on the device; the location itself stays in the page's memory, as before. About updated to say so.

### 11.56 All roads flies back out (2026-11-23)

- Your note: "All roads" closed a road but left the map zoomed in on it. Now All roads (on a road or a spot) closes it and flies the map smoothly back out: to the area around you, at the same zoom the app opens at, if your location is set (your own location, a point you set, or a town you searched); otherwise to the whole mainland (no Alaska or Hawaii), fitted between the search and the list on phones and on desktop. The list then shows every road in that view.
- The logo still returns to the full map as before; no Back button. The location stays in the page's memory only.
- Tested on a phone (website and installed-app layouts) and on desktop, with location set and not set.

### 11.57 No profile choice for private-group spots (2026-11-23)

- Your note: adding a spot in a private group still offered "Show on my profile". A private group's spots never show on a profile (the database already turns it off), so the spot form now leaves the checkbox out and says the spot stays off your profile. This covers adding a spot from a private group's page and editing a spot that's in a private group from Your spots.

### 11.58 Score a road from Your spots (2026-11-23)

- Your question: Your spots showed "Submit to public map" but no way to score a road. "Score this road" had only ever been on the spot's own card (open the spot on the map), so it was easy to miss. Your spots now shows it too, on a road you picked off the map or drew, then "Waiting to be scored" or "Being scored", then "Scored 72" (opens the spot with its scores). Suggested roads already have scores and show nothing extra.
- Recommendation taken: scoring stays separate from the public map. A score is seen only by people who can already see the spot (you, your groups, your profile), and the public map is a bigger step with a review, so tying the two together would make people publish just to get a number.

### 11.59 Score and publish roads from a group page (2026-11-23)

- Your note: members should be able to score a group's roads from the group page, and public groups should have "Submit to public map" there (not private groups). The road may not be in your own spots, but whoever asks gets the notification when it's scored.
- Any member can ask for a score on a road the group has accepted (not one only suggested), with the same 20-a-day limit. The notification now reads "<road> has its scores", since it may not be your road.
- "Submit to public map" shows on a public group's roads for its spot managers and for the road's owner. Private groups don't show it, and the database now refuses it there too unless the road's owner does it (owners still decide about their own roads, from Your spots).
- The note beside "Score this road" on a spot's card has a 12px gap and wraps in its own column beside the button instead of under it.

### 11.60 Editing a scored road keeps its score (2026-11-23)

- Your note: renaming a road you'd scored cleared its score. The editor sent the road's line again on every save, and any new line clears a score. Now saving a road you didn't change (name, notes, profile) leaves its line alone, so the score stays. If you change the road itself (draw, trim, extend, pick another), the editor warns that its score will be cleared and needs scoring again.
- Tested on the local database: renaming a scored drawn road kept the same line and its score; undoing a point showed the warning.

### 11.61 Swiping down a group or profile goes home (2026-11-23)

- Your note: minimizing a group or profile page should just go back to the default view. On phones (browser and installed app), swiping a group's or a person's page down to the bottom now opens the home map, like the account pages already did, instead of leaving a thin strip with the page's name. Dragging to half or full still stays on the page. Event pages and Your spots keep the strip.

### 11.62 @mentions in chats (2026-11-23)

- Your note: be able to @ usernames in messages and chats. Typing @ in a direct or group chat shows the people in that chat (by name or username, up to six); tap one, or use the arrow keys and Enter or Tab, to put in their @username. Escape closes the list.
- Mentions of people in the chat show as links to their profiles, and your own @username is highlighted when someone mentions you.
- The person mentioned gets "<name> mentioned you in <group>" (or "mentioned you in a message" in a direct chat) instead of the usual new-messages note, so one message never makes two notifications. Reading the chat clears it.
- Only people in the chat can be mentioned and told. Blocks hold both ways: nobody across a block is suggested or told. Email addresses and @ inside words don't count, and one message tells at most 20 people.
- Mentions are found when a message is sent; editing a message later to add a mention doesn't notify anyone.

### 11.63 Map styles (2026-11-23)

- Your note: prototype map themes inspired by Forza Horizon and Burnout Paradise maps. After three rounds of prototypes you kept Relief, Golden Hour, Evergreen, Moonlight, Soft Neon, Road Atlas and Trail Map (dropped: Terrain, Night Satellite, Ink, Blueprint, Alpine, Riso Print).
- More options now has a Map style picker with those seven plus Night (the map as it was). Relief is the default: the night map with the hills shaded in. The choice stays on the device, and the map repaints in place without reloading; spots, heads-ups and the satellite switch keep working in every style.
- Every style except Night shades hills from the free Terrain Tiles on AWS Open Data, credited on the map and on About. Road Atlas adds green dots beside roads scoring 70 or more, the old atlas mark for a scenic route.
- Points, badges and collectibles are a proposal for review (Rep, road-sign levels and badges, landmark stamps, barn finds); nothing is built for them yet.

### 11.64 Grey driver picture for profiles without one (2026-11-23)

- Your note: profiles with no profile picture get a default grey driver avatar. Instead of the first letter of the name, they now show a grey driver in a helmet behind the wheel, everywhere a profile picture shows (profiles, chats, the @ list, people lists).
- Groups without a picture keep their first letter.

### 11.65 Scenic score v2 (2026-11-23)

- Your note: roads right next to the ocean didn't score as scenic, and other things like that could make the Scenic score more accurate. The first score only counted trees, water (any pond), protected land and scenic byways, so ocean roads with no trees, deserts, red rock, and alpine passes scored low (Pacific Coast Highway at Laguna Beach 38, Monument Valley 35, Valley of Fire 12).
- Scenic v2 is a separate pass over the finished exports (pipeline/scenic.py) and adds: Terrain (how much the land rises and falls within 1.5 km, USGS elevation), Big water (open water filling a fifth of the land within 1 km, counted in full only when water also fills about 40% of the land within 3 km, as along the ocean, the Great Lakes and lakes like Tahoe; a small lake counts partly and a pond hardly at all), Open country (desert, rock, grassland, shrubs, snow, counted only where the land rises and falls, so flat farmland and prairie don't), Views (road above the land around it), and a Built-up penalty (buildings and pavement within 150 m; an ocean view loses less of it).
- The parts combine so any one striking thing makes a road scenic and more of them add up without passing 100. Weights were tuned against a check list (pipeline/scenic_refs.toml) of 34 famous scenic drives and 15 flat farmland and suburb areas, and a random sample of 1,500 roads so the Scenic list grows only a little (22% of roads to 29%). Run scripts/scenic_check.py to see the table.
- Results on the check list: famous drives average 60 to 97 (Big Sur 95, Going-to-the-Sun 97, Beartooth 91, Valley of Fire 75, Monument Valley 71, Big Bend's River Road 60), except Lake Mead's Northshore Road (24, open desert a few miles from the lake). Flat farmland and suburbs average 2 to 25. Suburban wooded roads drop (Cobbs Creek Parkway 61 to 17); flat pine forest with ponds drops a little (about 60 to 48).
- South Dakota as a test: the Scenic list grows from 26 roads to 192, mostly the Black Hills and Badlands (148). Roads by the eastern prairie lakes mostly land at 45 to 60 (South Shore Drive at Clear Lake 43 to 56); a few causeway roads with lakes on both sides reach the low 70s.
- Road pages list the new parts (along the coast or a big lake, mountains or hills around, open desert or range country). Overall moves at most 2 points (Scenic is 2% of it).
- Known gap: the Natchez Trace Parkway isn't marked as park land or a byway in our data, so it stays about 44.
- Viewpoints, cliffs and waterfalls from OpenStreetMap would need the state map files again (most were cleaned up), so they're left for later.

### 11.66 Site stats for the admin (2026-11-23)

- Your note: a dashboard on your profile with stats about the website: traffic and other useful or fun things to watch. Only admins can see it.
- Site stats lives at /admin/stats. Open it from Site stats in the You menu, under Account on Edit profile, or from the site admin box at the bottom of Notifications. Anyone else gets Not found, and the database refuses them too (admin_stats checks the site admin list).
- Shows: visits and active members today and this week; a day by day chart (visits, page views, active members, new members, road reviews, heads-ups, spots, messages) with 7, 30 or 90 days and a table view; people (accounts, private profiles, follows, garages, photos, push notifications on); most viewed pages and roads; most reviewed roads; spots, heads-ups and road checks; groups, drives, RSVPs, messages and notifications; top contributors (public things only: reviews, heads-ups, public spots); the most common makes in garages.
- Traffic: there was no analytics before. Instead of a third-party tracker, the app now keeps an anonymous count: each page shown adds one to (day, kind of page), and road pages also to (day, road). A visit is one browser session. Nothing about the visitor is kept: no account, IP address, device, location, cookie or referrer, and ids, usernames and invite links in the address are never kept. Browsers with Do Not Track or Global Privacy Control aren't counted, and the page has a switch to leave your own visits out on that device. Road counts are deleted after 120 days, page counts after 400.
- Active members are counted from what the app already keeps (signed in, rated, posted, voted, saved, followed, joined, or read a chat that day). Only totals are shown; no message text, locations, private spots or group members.
- The counter can't tell people apart, so it shows visits, not unique visitors. Vercel Web Analytics (also cookieless) could add unique visitors, countries and referrers later if wanted; it would need turning on in Vercel and a line on About.
- Days run on UTC time.

### 11.67 Google listing and a faster phone load (2026-11-23)

- Your note: Google listed the site with an http address and no icon, and PageSpeed scored phones 34 for performance (main content after 6.9 seconds, the page frozen about 4 seconds while it loads).
- Listing: the site already sends http to https; nothing told Google the official address. Now every page names its https address (canonical), robots.txt points to a sitemap of the main pages and the top-rated roads, and private pages (account, messages, invite links, admin) stay out of search. A favicon.ico (16, 32 and 48 px from the app icon) sits where Google looks for one. Google picks these up on its next crawl; Search Console can ask for it sooner.
- Phone load: the road cards waited for the page's scripts, the road data file (900 KB) and a database call before showing, and phones first drew the desktop layout. Now the data index and the top 24 roads are in the page itself, and the home map has the phone layout from the first paint (CSS decides before the scripts run). In a phone test (slow 4G, 4x slower processor) the first road card shows at about 1.3 seconds instead of 6.1. The full list and the map load after, as before.
- Pages opened on request (a road, a profile) don't carry the seed; they load as before.

### 11.68 Site stats: unique visitors, more time windows, more chart options (2026-11-23)

- Your note: add unique visitors with Vercel Analytics, give more options for the time window, and make the graph with more options.
- Vercel Web Analytics is added to every page (cookieless). It gets the same cleaned-up addresses as our own counter: group, drive, chat, profile and invite ids become placeholders, the ?part and #part are dropped (they can hold spot ids), and admin pages send nothing. Road pages keep the road (roads are public). Do Not Track, Global Privacy Control and "don't count my visits on this device" turn it off too. Vercel only gets a referrer when the visitor came from another site.
- Site stats asks Vercel for unique visitors (total, per day, week or month), where visitors came from, and phones vs computers, through an admin-only route (/api/admin/visitors) that checks you're the site admin first; the Vercel token stays on the server. Until it's connected, the Traffic section shows the three setup steps.
- To connect it: turn on Web Analytics in the sunday-line project on Vercel, make a Vercel access token, add it as VERCEL_ANALYTICS_TOKEN (plus VERCEL_ANALYTICS_TEAM if the project is under a team), and redeploy. The free plan keeps one month of Vercel data, so unique visitors stop at a month back; our own counts go back further.
- Time windows: Today, 7 days, 14 days, 30 days, 90 days, 6 months, 1 year, All time, or Pick dates (from and to). The headline numbers follow the window.
- The chart: pick what to show (unique visitors, visits, page views, active members, new members, reviews, heads-ups, spots, messages), group by day, week or month, bars or line, each period or a running total, compare with the same length of time just before (dashed line, with up or down %), an average line, or every chart at once (tap one to open it). Tap or hover a bar for its number; the table view follows the options.
- Active members (and unique visitors) count each person once per day, week or month, so they have no running total.

### 11.69 Recent reviews and road hazards for the admin (2026-11-23)

- Your note: as admin, a spot in the notifications you can collapse that shows when people give reviews, and one for road hazards too; it might be removed or grown into something bigger (like their stats) later.
- At the bottom of Notifications, under the review queues, two boxes only you see: "recent reviews" (how many this week) and "road hazards (heads-ups)" (how many are up now). Each opens and closes, and stays the way you left it on that device.
- Recent reviews: the 25 newest or most recently edited road reviews, with the road (linked), how far they'd drive for it, best around here, pavement, traffic, flags, the note, who wrote it (linked) and when. Reviews are already public with their author, so this needed nothing new in the database.
- Road hazards: the 30 newest heads-ups, up now or ended (ended ones are deleted a day later), with the kind, the note, the nearest town (worked out on your device from the town list), whether it's up and for how long, and the still there and gone votes. Like on the map, it never says who posted one; the new database function (admin_recent_heads_ups) doesn't return the poster at all and refuses everyone but the site admin.
- It's one self-contained piece (components/AdminActivity.tsx) so it can be removed, or grown into a stats view, without touching the rest.

### 11.70 Installed iPhone app: no black strip at the bottom after coming back (2026-11-24)

- Your note: the Home Screen app sometimes isn't full screen: the top is fine but the very bottom is black. It happens most when the app has been open a while and you come back to it.
- Cause: a known iOS bug in installed web apps. After the app has been in the background, iOS can hand the page a shorter screen than it really has until the app is closed and opened again. Other apps hit the same thing (bulwarkmail/webmail#1226).
- Fix (components/ViewportHeal.tsx, installed iPhone app only): the app remembers its tallest height at each width. When it's shown again, or a text box closes, and the screen is shorter than that, it hides and shows the page once, which makes iOS measure the screen again. Scroll positions are put back, so nothing jumps. It does nothing while you're typing, and nothing on the website or on other phones.
- No re-adding needed: close and reopen the app once to get the update.

### 11.71 Your location after a drive (2026-11-24)

- Your note: driving to a road with the Home Screen app, your dot stayed where you left from, and the center-on-me button didn't move it.
- Cause: once the app had your location, the button only re-centered on that saved spot and never asked the phone again. The phone was also allowed to answer with a location up to 10 minutes old.
- Now the button centers on the last spot right away, then always asks the phone for a fresh fix (GPS, nothing saved), and moves the map if you've moved more than about 100 m. If GPS is slow it takes the phone's rough location from the last minute instead.
- Coming back to the app with your location on updates your dot and distances quietly; the map stays where it is. Opening the app accepts a location up to a minute old (was 10).
- Still only in the page's memory: never sent anywhere or saved. Nothing follows you continuously.

### 11.72 Site stats days run on Central time (2026-11-24)

- Your note: Site stats showed all 99 page views and 54 visits as today and none on earlier days, though you'd seen views the day before.
- The counts were right; the days were UTC. UTC's day turns over at 6 pm Central (7 pm in summer), and the counter went live at 11:15 pm Central on Nov 23, already Nov 24 in UTC, so every view so far was filed under Nov 24.
- Recommendation taken (your pick): days now run on Central time. The counter files each view under the Central date, and the stats ("today", 7 days, the chart, date ranges) are built in Central time; the Vercel visitors range uses Central dates too. Views already counted stay on the day they were filed under, since the counter keeps only the day.
- Also from your note: the Vercel token goes in Vercel's environment variables (Settings, Environment Variables, Production), not GitHub's Actions secrets, then a redeploy. The GitHub secret isn't used and can be deleted.

### 11.73 Group invites show who you're inviting (2026-11-24)

- Your note: in a group's Invite a member, typing the @username should drop down a list with the display name, username and profile picture, so you invite the right person.
- Typing two or more letters (with or without the @) lists up to 8 matching people under the box, each with their picture, name and @username, using the same people search as the People page (blocked people never show). People already in the group say so.
- Tap one (or use the arrow keys and Enter) to fill in their @username; a line under the box then shows "Inviting" with their picture and name. Typing a username by hand and pressing Invite still works as before.

### 11.74 Site stats by the hour (2026-11-24)

- Your ask: group the Over time chart by hour.
- The page-view counter kept only the day, so it now also keeps a count per hour (Central time) and kind of page. Still anonymous: nothing about who, where, or what device. Hourly counts are deleted after 90 days. About now says the hour instead of the day.
- Group by has an Hour option for windows of 14 days or less (Today picks it on its own). Sign-ups, reviews, heads-ups, spots, messages and active members have their own times, so their past hours show too; page views and visits by the hour start when this went live (Nov 24, about 3 PM). Hours later today show as no data. Unique visitors from Vercel come by the day, so they sit out the hourly chart.

### 11.75 New message button, and messages to private profiles wait for a follow (2026-11-24)

- Your note: a + in Messages to start a chat with people you've never messaged; you can message people you don't follow, but they only see it when they accept your follow request; public accounts get messages from anyone. Follows don't go both ways, so recommendation taken:
- Public profiles: a new chat lands in their inbox right away (their "Who can message me" setting still applies, as before).
- Private profiles: a chat from someone who isn't their approved follower, and whom they don't follow, waits. Your first message also sends them a follow request (if you haven't). They don't see the chat, its messages, or a message notification until they accept; then it shows up with everything you sent and one "new messages" notification. If they decline, it never shows and nobody is told. Going public shows all waiting chats; following you (or asking to) shows yours.
- Your side: the chat and the inbox row say Waiting, with "They'll see your messages when they accept your follow request."
- Once a chat has shown up it stays, even if a follow ends later. Blocks still stop everything.
- The + opens a picker: search anyone by name or @username (blocked people never show); with no search it lists people you follow and who follow you. Each row has the picture, name and @username, and says when messages would wait or when they aren't taking messages from you.
- Database tests: supabase/tests/database/message_requests.test.sql (22 checks).

### 11.76 Better push notifications (2026-11-24)

- Your note: pushes read "Sunday Line / from Sunday Line / alex asked to follow you" every time. The top line is the app's name and the "from" line is added by iOS for Home Screen web apps; neither can change. The bold title was always "Sunday Line" from our sender.
- Titles now say who or what it's about, and the text says what happened: "Alex / Asked to follow you", "Night Crew / Alex: Ride Sunday?", "Sunday at Big Bend / Canceled", "Road check waiting / Old Jena Road (gravel or dirt)".
- Message and mention pushes show the start of the latest message (up to about 140 characters), or "Sent a photo", like iMessage. It shows on the lock screen.
- The installed app's icon shows the bell's number, set by each push and kept up to date while the app is open; it clears when everything is read.
- iOS doesn't show pictures or buttons in web app notifications, so those stay as they are.

### 11.77 Event times in pushes (2026-11-24)

- Your go-ahead on the gap found in 11.76: pushes were written on the server in UTC, so a 9 AM Central drive could read 3 PM.
- Event pushes now use the event's own time zone and name it: "Coming up: Sun, Nov 29, 9:00 AM CST". The list in the app already showed the right time and is unchanged.

### 11.78 Bounties and rep (2026-11-24)

- Your note: a Bounties section listing the nearest roads that need a check for the most rep (Moon Lake Road near Bossier scores 55 but sits in Needs a check), with rep that adds to the app's credibility and doesn't invite fake accounts or misinformation. Recommendation taken: rep is paid for being right, never for agreeing.
- Rep: flags still need three members to reach the site admin's road check queue, and nobody earns anything until the admin accepts the check. Accepting pays everyone whose review flags it: a bounty pays a fifth of the road's Overall score (Moon Lake Road 11), other checks 5. A check that's turned down (or an accepted one undone) costs each flagger 3; poor pavement, being opinion, costs nothing. Flags made after a check is settled earn nothing, and nothing is paid twice.
- Against farming: accounts earn only for flags made once they're a week old, at most 50 points a day; their flags still count toward the queue. Extra accounts can't confirm their own flags (only the admin accepts), and wrong answers lose rep. No public leaderboard.
- Trusted checker: 5 or more confirmed checks and at least 80% right. Shown on profiles (next to rep and how often their checks were right) and next to their reviews on road pages.
- Bounties: a new list view (Bounties chip and app pill) of roads whose surface needs a check, best first, each with its rep. A road page that needs a check has a Bounty box saying what to check, and that a locked gate or No trespassing sign is a full answer (never go past one), answered after the drive.
- New flag "Paved, I checked it", offered only on roads that need a check: accepted, it moves the road onto Driver's roads. Before this a check could only take a road off a list.
- The admin queue shows what each check pays and charges. The "your flag helped" notification (and push) adds the rep.
- Also fixed: a road page opened from a link showed the road as the data files have it, without members' accepted checks (private, gravel and so on); it now applies them like the map does.
- Local: supabase/seed.sql adds two test members (tester, dupper) after a local reset. Database tests: supabase/tests/database/rep.test.sql (21 checks).

### 11.79 Find a road (2026-11-24)

- Your note: "Find a place" only searched towns. Search roads too; an address should open the road it's on, if we have it; towns stay on top ("dallas" is Dallas, TX before roads starting with Dallas); still no autofill.
- The tile step now writes each state's road names to a small file next to the road squares on GitHub Pages (names-XX.json: name, nearest town, position, score, square; 16 MB for all states, Texas about 380 KB compressed). The search box loads only the states in view, or the state typed ("Moon Lake Rd, LA"), and searches on the device like the town search; nothing typed leaves it.
- Results: towns and states first, then up to five roads (every word typed matches the start of a word in the name, in any order; "Rd" and "Road", "Hwy" and "Highway", "CR" and "County Road" match each other), nearest first.
- A street address ("1234 Moon Lake Rd, Bossier City, LA") lists the road with that name within 25 miles of the town first, marked "The road at this address", then the town. Most homes are on streets we don't score, so then only the town shows.
- No "address", "street", "city" or "town" in the box's label or placeholder ("Find a place or road"), so iOS doesn't offer to autofill.

### 11.80 Street map when a blocker blocks it (2026-11-24)

- Your note: on desktop Firefox the street map was gone; only the road lines and hill shading showed.
- Cause: on 2026-11-24 the EasyPrivacy filter list (on by default in uBlock Origin, and used by Brave) added a rule blocking tiles.openfreemap.org/planet, where every street tile comes from. It blanks every site that uses OpenFreeMap; it's reported upstream (easylist/easylist issue 26522).
- Fix: before a map is made, the app asks OpenFreeMap for its tile list. A blocked request fails at once; then the map loads the same tiles through this site (/streets, a rewrite to OpenFreeMap in next.config.ts). Browsers that aren't blocked still get the tiles straight from OpenFreeMap, so the site's bandwidth only carries blocked visitors.
- Checked in Firefox with uBlock Origin: blank before, full street map after.

### 11.81 Fixes from the project review (2026-11-24)

- Your note: look over the whole project for what needs improving. Three reviews (security and privacy, the app, data and operations) found no leak of private data; these are the fixes from the "fix now" list.
- Push notifications: the sender couldn't read messages, events or notifications, so pushes went out without the message text, the event's time zone, or the count on the app icon. The database now hands those over with the notification (claim_push).
- Meet locations: a spot in a private group can no longer be a public group's meet spot (the same rule as adding it to the group), since the meet spot is copied to everyone who joins.
- Rep: each flag is timed when it's added, not when the review was last saved, so re-saving a review can't make a new account's flag count as a week old, or bring a dismissed check back. Who was flagging a check when it reached the queue is remembered, so taking a flag off before a dismissal still costs the 3 points; undoing an accepted check takes back what it paid from everyone it paid.
- Opening a road on a weak signal: if its full data can't load, the panel says so with Try again, instead of the whole page going blank. Error pages catch anything else.
- Road links after rebuilds: a road's ID comes from the OSM nodes at its ends, so a rebuild that joins or trims a road changes it; the last one changed about 12,900. Each release now records where every vanished road went (the new road sharing the most of its OSM ways; pipeline/moves.py, moved.json), and old links redirect there. Backfilled from earlier releases: 12,533 old IDs redirect (97% to a road of the same name); 401 roads were dropped outright. No member's review, check or public spot pointed at an old ID.
- Posted speeds: a road was labeled "posted" with up to a quarter of it estimated, and its range could include the estimate. Now "posted" means at least 95% posted, the range comes from the posted stretches only, the FHWA line shows only on posted roads, and a state's default-speed law only on default roads. This takes effect with the next rebuild.
- The admin stats test no longer depends on whatever else is in the local database.

### 11.82 Speed, messages, accessibility and operations (2026-11-25)

- Your note: the "worth doing soon" list from the 11.81 review.
- Phones: road squares loaded while panning are now let go past 64 (a dense one is about 2 MB), keeping the ones in view and the open road's; squares load nearest the middle of the view first. The road list is rebuilt only when the view moves onto different squares, not on every pan, and "Show more" starts over only when the filters change.
- Messages: coming back to the app fetches what came in or changed while it was in the background and reconnects live updates. A chat that can't load offline says so with Try again, instead of "isn't available".
- Notifications: road names come from a small endpoint (/api/road-names), not the 1.8 MB road index and whole road squares.
- Accessibility: a closed sheet is hidden from screen readers and Tab; the You menu keeps focus steady and returns it to its button; fine print is lighter (4.5:1 contrast or better on every panel); direction links are 44 px tall; text boxes are 16 px on touch screens so iOS doesn't zoom; score names and the Candidate chip open their explanation on tap (phones can't hover); the map credit button shows a focus ring for keyboard users.
- Road score queue: one bad road no longer stops the run, and a job that dies on its last try is marked failed instead of staying "scoring" forever.
- National rebuild (scripts/rebuild_national.py): stops at the first failure (a state that didn't export, Scenic, a missing state, tiles) and says so; runs the Scenic v2 pass itself (states already at the current version are skipped); no longer tries Shreveport.
- Backups: scripts/backup_db.ps1 saves the live database (structure, all app tables, accounts, roles) to E:\sunday-line-backups\<date>, keeping the newest 8. A Windows task runs it Sundays at 3 AM (or when the PC is next on). Photos in Storage aren't included.
- Tests run on GitHub on every push (types, app tests, pipeline tests, database tests). A health check runs every three hours (the site, its road data, the road squares on GitHub Pages, the push sender and database); if anything fails, GitHub emails you.

### 11.83 Keep a road for no signal (2026-11-25)

- Your note: save a road for offline use, since good roads often have no signal.
- A download button next to Save on each road's page keeps that road on the device: its square (all its details), the street map, labels and terrain shading along it (zoomed in, a ring of tiles around the road; zoomed out, just the road's own tiles), and the app's own files. Tap again to remove it; files another kept road still uses stay. A short 2-mile road in Texas takes about 6 MB, half of it the road square, which holds every road nearby.
- The service worker (public/sw.js) now answers when the network doesn't: pages and data still come from the network first (within 6 seconds), so the site stays current; offline it opens the saved home page, and the map uses the kept tiles.
- With no signal, the home list shows "Roads kept on this device" at the top (raised on phones). Phones often report being online with no data getting through, so the app asks the site itself whether it can be reached.
- Kept roads are listed in this browser's storage only; nothing about them is sent anywhere.
- Checked in Chromium with the network fully off: the app opened, listed the kept road, and opened it with the street map, labels and terrain. Not yet checked on an iPhone.

### 11.84 Private members' reviews: public, but anonymous (2026-11-25)

- Your decision: private members' reviews stay public but anonymous.
- A review's row (with its author) is readable only by people who can see that member's profile (public members, approved followers, themselves) and the site admin. Everyone still reads every review's text through road_reviews(), which leaves the author off when you can't see their profile, and every review still counts in a road's summary (road_community now runs as its owner; it has no authors in it). Speed reports follow the same rule.
- Before this, anyone could list a private member's reviews through the database, which showed where they drive.

### 11.85 Day route builder (2026-11-25)

- Your ask: a day route builder.
- On a road's page, "Add to day route" (in Get directions). /route lists the roads, up to 20, with up and down, drive it the other way, remove, "Shortest order" (from your location if it's set; each next road is the one with an end nearest where the last one finished), "Keep all offline", and Clear. A "Route (N)" chip on the home map opens it, and the route's roads show on the map.
- Directions: one Google Maps link with each road's two ends as stops, from wherever the phone is. A link holds 9 stops plus the destination, so longer routes come in parts of five roads. Apple Maps and Waze can't take several stops from a link; each road keeps its own directions for them.
- The route stays in this browser's storage; nothing about it is sent anywhere.

### 11.86 Heads-ups on your saved roads (2026-11-25)

- Your ask: heads-up alerts on saved roads.
- When someone posts a heads-up within about 250 m of a road in your spots, you get a notification (and a push, if they're on): "Something on the road reported on Lake Loop". It says nothing about who posted it, and your own heads-ups don't notify you. The database measures from the heads-up to the saved road's line (private.decode_line, private.meters_to_line).

### 11.87 Meets with a route (2026-11-25)

- Your ask: meets with a route.
- An event can hold the roads the group will drive, in order (event_roads, set with set_event_route by event managers, up to 20). In the event form: "Use my day route", remove roads, or clear. Members see the route at the same time as the location (event_location_visible); people outside the group never do.
- The event page lists the route, draws it on the map, opens it in Google Maps starting from the meet spot, and can copy it to your own day route.

### 11.88 Roads I've driven (2026-11-25)

- Your ask: roads I've driven.
- A Driven tab on profiles: the roads someone's reviews say "I drove it" on, newest first, with dates, and "Show on the map" (the 40 most recent). Private profiles show it only to approved followers, like the garage and photos (roads_driven()).

### 11.89 The profile menu closes the list (2026-11-25)

- Your note: in the installed app, tapping your picture (the menu with notifications, groups and people) should close the road list if it's open.
- It does now, on the home map: the list tucks away and the menu opens over the map. Checked in the installed-app layout (?app=1) on a phone-sized screen.

### 11.90 Road list pills: double tap or hold opens the list (2026-11-25)

- Your ask: double tapping Driver's roads, Scenic, Gravel, or Bounties (installed app) opens the list, and a long press too.
- A single tap still just picks the list, with no wait. A second tap on the same pill within 0.35 s, or holding a pill for half a second, also opens the road list full. Moving your finger (scrolling the pills) cancels a hold, and the pills no longer bring up the phone's copy menu or zoom on a double tap.

### 11.91 Your menu opens on top of any sheet (2026-11-25)

- Your report: on the iPhone app, tapping your picture with a list (or a road, group, and so on) half open put the menu behind it.
- Why: the menu was inside the floating top bar, which sits below the sheet, so no sheet but the home list (closed by 11.89) ever got out of the way.
- Now the menu opens on the page itself, over everything, with the rest dimmed. Closing it leaves whatever was open exactly as it was. The 11.89 step that closed the list is gone, so it works the same everywhere.

### 11.92 No slurs in usernames (2026-11-26)

- Your ask: you can't create a username with slurs; curse words are okay.
- The database refuses them (private.username_has_slur, check username_not_allowed), so no app or script can get around it. The profile form says "That username isn't allowed." as you type and won't save (lib/usernameWords.ts, the same lists).
- Covered: racial and ethnic slurs, anti-gay and anti-trans slurs, and "retard". Number swaps count as letters (n1gg3r), repeated letters still match, and underscores don't split a word. Short ones that turn up inside ordinary words ("spicy", "raccoon", "Montenegro", "Japan") only count on their own or set off by underscores, so a few run-together forms get through; that's the trade for not blocking ordinary names.
- Curse words stay allowed. Display names, bios, and everything else people write are still not checked.
- Every live username passed the rule before it went on (13 checked).

### 11.93 Profiles and groups: quick fixes (2026-11-27)

- Your ask: go over profiles and groups for usability; you picked the quick-fixes batch from the suggestions.
- Profile tabs fit on a phone. The follower and following counts are buttons that open those lists (tap again or Close to go back), so those two tabs are gone. Visitors don't see tabs with nothing in them; you still see all four on your own profile, so you know where to add things.
- A group's header is laid out like a profile: Join (or Ask to join, Requested, Leave, Organizer) sits beside the picture, and a back arrow on the banner goes to all groups. Tabs spread across the width, so Manage no longer runs off the edge.
- Profile photos are a tight three-across grid. Captions show in the full-screen viewer instead of under each square.
- Tap a profile's or group's banner or uploaded picture to see it full screen.
- A group's member list shows each member's first car under their name ("1986 Audi Quattro +1"). The database decides whose garage you may see, same as on their profile.
- Fixed in passing: the member list nested a list item inside another one (a React warning).

### 11.94 Faster photos (2026-11-27)

- Your ask: the faster-photos suggestion from the profile and group review.
- Gallery photos get a small copy (480 px, thumb-<name> beside the photo) made in the browser at upload. Profile photo grids and your gallery editor show the small copy; tapping still opens the full photo. A photo that's already small keeps no copy, and GIFs keep none (they'd stop moving). If a copy is missing the grid shows the full photo, so nothing breaks.
- Privacy is unchanged: the storage rule goes by the owner's folder, so the small copy is visible to exactly who can see the photo. No database change.
- Photos from before this get their small copy the next time their owner looks at their own profile or gallery.
- Photo links are reused for 50 minutes instead of made fresh on every page, per person signed in. Going back to a profile or group asks for no new links and shows photos from the browser's cache.
- New uploads (gallery, cars, group pictures) tell browsers they can keep the file for a week; every upload gets a new name, so that's safe.
- Room: the 150-file limit per person still fits 10 cars x 8 photos, 24 gallery photos with their copies, and the crop sources.
- Car photos keep one size: they show nearly full width, where a small copy would look soft.

### 11.95 Share previews for profiles and groups (2026-11-27)

- Your ask: the link-preview suggestion from the profile and group review.
- Pasting a profile link (/u/...) into iMessage, X, and the like now shows that person's own card: their banner, picture, name, @username, and their first car ("1986 Audi Quattro + 1 more"), or their bio if they have no car listed.
- A public group's link shows its banner, picture, name, "Austin, TX · Car and bike group · 3 members", and the start of its description.
- Nothing more than a signed-out visitor sees: the cards read with the public key only. A private profile's card shows its name, picture and banner (all public already) with "Private profile", and no cars or bio. A private group, or a link to nothing, gets a plain "A group on Sunday Line" card with no name.
- Cards are JPEGs of 20 to 60 KB (some apps skip preview images over about 300 KB). Uploaded pictures are WebP, which the card maker can't draw, so they're redrawn as JPEG first; if that ever fails the card shows the first letter instead.
- X shows these as large cards. Cards refresh within the hour after a change; apps that already fetched one may keep their own copy longer.

### 11.96 A fuller public group page for visitors (2026-11-27)

- Your ask: the visitor-view suggestion from the profile and group review.
- Someone who isn't in a public group (signed in or not) now sees an "about" box under the description: who the organizer is (tap through to their profile), how many events are coming up ("2 upcoming events · members see the dates and meet spots", or "No events planned right now"), whether anyone can join or the organizers approve new members, and when the group started.
- Nothing about the events themselves: no titles, dates, times, or places, and still no member list. The database hands out only the organizer and the count (public.group_visitor_summary). Private groups return nothing to outsiders, same as before.
- The note under it now reads "Join to see the group's events, meet spots, chat, and who's in it."
- Fixed in passing: the group page asked for the group chat even when no one was signed in (a 401 in the console).

### 11.97 The sheet handle no longer opens photos (2026-11-27)

- Tapping or dragging the handle to switch between half and full screen sometimes opened the profile or group banner on an iPhone. The handle moves the sheet as the finger lifts, and the phone's click comes after, aimed at the nearest button: since 11.93 that's the banner right under the handle.
- The handle now drops the one stray click that follows its own tap or drag, if it lands anywhere other than the handle, for up to 0.4 seconds. A real tap on the banner afterwards still opens it.
