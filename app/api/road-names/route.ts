import { findRoad, movedRoad } from "@/lib/serverData";

// Road names by ID, for lists that only need the name, like Notifications
// (11.82): without this a phone downloaded the 1.8 MB road index and whole
// road squares just to say "Moon Lake Road". Public road data only.

const ID = /^[a-f0-9]{12}$/;

export async function GET(req: Request) {
  const ids = [...new Set((new URL(req.url).searchParams.get("ids") ?? "").split(","))].filter((x) => ID.test(x)).slice(0, 60);
  const names: Record<string, string> = {};
  await Promise.all(ids.map(async (id) => {
    const road = (await findRoad(id)) ?? (await movedRoad(id).then((now) => (now ? findRoad(now) : null)));
    if (road) names[id] = road.name;
  }));
  return Response.json(names, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
}
