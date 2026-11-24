import type { Metadata } from "next";
import { CONTACT_EMAIL, GITHUB_URL, MORE_PROJECTS_URL } from "@/lib/config";
import { loadIndex } from "@/lib/serverData";

export const metadata: Metadata = { title: "About", alternates: { canonical: "/about" } };

export default async function About() {
  const data = await loadIndex();
  return (
    <div className="page">
      <h1>About Sunday Line</h1>
      <p className="lead">
        Sunday Line finds the roads that are fun to drive across the United States: twisty, fast, paved, and quiet.
      </p>
      <p className="links">
        <a className="button" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">Star on GitHub</a>
        <a className="button ghost" href={MORE_PROJECTS_URL} target="_blank" rel="noopener noreferrer">More projects by Ethan</a>
      </p>

      <h2 id="scoring">How roads are scored</h2>
      <p>
        Every road in the region comes from OpenStreetMap. We simulate driving it at the speed limit: the car slows for
        each corner, brakes into it, and accelerates out, the way a lap simulator works a race track. Then we compare
        that drive with five real tracks (Laguna Seca, Road Atlanta, Lime Rock, Barber, and COTA), each capped at 55 mph.
      </p>
      <ul>
        <li><b>Twisty:</b> cornering, braking, and direction changes compared with those tracks. 70 is track average.</li>
        <li><b>Speed:</b> the average legal speed through the corners. 25 mph scores 0, 65 mph scores 100.</li>
        <li><b>Pavement:</b> how likely the pavement is smooth and kept up. Public data rarely measures pavement on county roads, so it starts from who maintains the road (state highways are kept up; many county roads here are rough chip seal or gravel), then uses federal road data, traffic counts, aerial photos, and people&apos;s checks, which always win.</li>
        <li><b>Overall:</b> needs both Twisty and Speed, so a slow twisty road and a fast straight one both score low. Pavement counts next, then flow (few stops), elevation, quiet, and scenery.</li>
        <li><b>Scenic:</b> what the land around the road looks like: mountains and views (USGS elevation), coast and big lakes, forest, open desert and range, and water (ESA WorldCover), plus parks and scenic byways. Towns and built-up land count against it. It counts least in Overall and has its own list.</li>
      </ul>
      <p>
        <b>Driver&apos;s roads</b> must be paved with a good Pavement score, have a speed limit of at least 35 mph on
        most of their length, score at least 30 Overall, and not sit inside a park, fee area, or off-road park. Every kind of public road can
        make the list: back roads, city streets, and interstates. Private roads and unnamed driveways are left out.
        Most rural roads here have no surface on the map, so we also read it from USDA aerial photos. County roads
        whose pavement we can&apos;t confirm, and roads where the photos are unclear, wait in &quot;Needs a
        check&quot; until a person looks.
      </p>

      <h2>Labels</h2>
      <ul>
        <li><b>Candidate:</b> found from map data, not yet checked by members.</li>
        <li><b>Speed limits:</b> &quot;posted&quot; comes from the map or from limits the state DOT reports to the Federal Highway Administration; &quot;state default&quot; is the legal limit where no sign is recorded; &quot;estimated&quot; comes from similar roads nearby. Always follow the signs.</li>
      </ul>

      <h2 id="terms">Terms of use</h2>
      <p>Plain language, not legal advice.</p>
      <ul>
        <li>You are responsible for following traffic laws and posted speed limits. Illegal driving activity is prohibited.</li>
        <li>Road information is estimated from public data and may be wrong or out of date. You use the app, and drive any road, at your own risk.</li>
        <li>Plan your drive before you head out.</li>
        <li>You own and control what you post.</li>
        <li>Legal notices: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></li>
      </ul>

      <h2>Reviews and heads-ups</h2>
      <ul>
        <li>
          <b>How far would you drive for it?</b> Reviews ask this instead of stars: Skip it, Fun if you&apos;re nearby,
          Worth a detour, or Worth a road trip. It means the same thing everywhere. To say a road is a local gem, tick
          &quot;One of the best roads around here&quot;.
        </li>
        <li>
          <b>Flags:</b> gravel or dirt, private or gated, closed, police often here, and poor pavement. When three
          members flag a road the same way, it gets a check and can move off Driver&apos;s roads.
        </li>
        <li>
          <b>Heads-ups</b> mark something on a road right now, like a crash or something in the lane. They end by
          themselves (1 to 12 hours, by kind), and they show without the poster&apos;s name.
        </li>
      </ul>

      <h2 id="bounties">Bounties and rep</h2>
      <ul>
        <li>
          <b>Bounties</b> are roads whose surface or access needs a check, like a county road nobody has confirmed is
          paved. Seen one? Review it with what you found: paved, gravel or dirt, private or gated, or closed.
        </li>
        <li>
          <b>Rep</b> is paid only for answers that turn out right. When three members flag a road the same way, the site
          admin checks it; if it&apos;s confirmed, everyone who flagged it earns rep (a bounty pays a fifth of the
          road&apos;s Overall score, other checks 5). A flag that&apos;s turned down costs 3. Agreeing alone earns nothing.
        </li>
        <li>
          Accounts earn rep once they&apos;re a week old, up to 50 a day. Profiles show rep next to how often that
          member&apos;s checks were right, and members with 5 or more confirmed checks and at least 80% right are marked
          Trusted checker.
        </li>
        <li>
          A locked gate or a &ldquo;No trespassing&rdquo; sign is a complete answer: never go past one. Answer after your
          drive, not while driving.
        </li>
      </ul>

      <h2>Data and credits</h2>
      <ul>
        <li>
          Road data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>,
          available under the Open Database License. Our scored road list is a derived database, also under the ODbL:{" "}
          <a href="/data/us/index.json">see the index</a> (updated {data.generated}; one file per map square in{" "}
          <a href="https://github.com/ethanmanco/sunday-line-data" target="_blank" rel="noopener noreferrer">the road data repository</a>).
        </li>
        <li>Base map: <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>, &copy; OpenMapTiles. Satellite view: USGS The National Map. Hill shading: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener noreferrer">Terrain Tiles</a> on AWS Open Data (Mapzen, from USGS and other sources).</li>
        <li>Town search: US Census Bureau 2024 Gazetteer and American Community Survey (public domain). Town and road searches run on your device.</li>
        <li>Elevation: USGS 3DEP. Aerial photos: USDA NAIP. Land cover: ESA WorldCover 2021 (CC BY 4.0).</li>
        <li>Road owner, surface, posted limits, traffic counts, and roughness: FHWA Highway Performance Monitoring System, 2024 (public domain).</li>
        <li>Buildings and places: Overture Maps Foundation.</li>
        <li>The curvature approach follows the published method of the <a href="https://github.com/adamfranco/curvature" target="_blank" rel="noopener noreferrer">Curvature project</a>, written independently.</li>
      </ul>

      <h2>Your privacy</h2>
      <p>
        If you allow it, the map starts centered on you and distances are measured from where you are. Your location
        is used inside this page only. It is never sent to a server or saved.
      </p>
      <ul>
        <li>Your email is used only to sign you in. It is never shown to other members.</li>
        <li>
          Photos you upload are resized in your browser first, which removes hidden details such as where a photo was
          taken.
        </li>
        <li>
          A private profile shows your garage, photos, and follow lists only to followers you approve. Your name,
          picture, bio, and road reviews stay public. Heads-ups never show who posted them.
        </li>
        <li>Blocking someone is private: they aren&apos;t told. You stop following each other, and they can&apos;t follow you or see your garage and photos.</li>
        <li>Notifications are yours alone. Read ones are deleted after 60 days, all of them after 120.</li>
        <li>If you turn on notifications for a device, only that device&apos;s push address is stored. Turning them off or signing out removes it.</li>
        <li>
          We count page views to see how the site is used: only the kind of page (and which road, on road pages) and
          the hour. Nothing about you, your device, or where you are is kept, and browsers with Do Not Track or Global
          Privacy Control aren&apos;t counted.
        </li>
        <li>
          We also use Vercel Web Analytics, which counts visitors without cookies. It gets the same cleaned-up page
          addresses (no group, chat, profile or invite ids, no spot links), and nothing from browsers with Do Not Track
          or Global Privacy Control.
        </li>
        <li>You can change or delete anything you post at any time.</li>
      </ul>

      <p className="fine">Contact: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
    </div>
  );
}
