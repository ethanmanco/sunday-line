"use client";

import { useEffect, useState } from "react";
import { keptRoads, reachable, type KeptRoad } from "@/lib/offline";
import { loadCell } from "@/lib/roadData";
import { useMapShell } from "@/lib/mapShell";

/**
 * With no signal (11.83): the roads kept on this device, at the top of the
 * list. They open from the saved copies; everything else needs a connection.
 */
export default function OfflineRoads() {
  const shell = useMapShell();
  const [offline, setOffline] = useState(false);
  const [kept, setKept] = useState<KeptRoad[]>([]);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const update = async () => {
      const list = keptRoads();
      setKept(list);
      if (!list.length) return;
      const ok = navigator.onLine && (await reachable());
      if (live) setOffline(!ok);
    };
    update();
    const onVisible = () => document.visibilityState === "visible" && update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("sl-offline", update);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("sl-offline", update);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // On a phone, bring the list up so the kept roads are the first thing seen.
  const show = Boolean(shell && kept.length && (offline || shell.loadError));
  useEffect(() => {
    if (show && shell?.isSheet && shell.sheet === "closed") shell.setSheet("half");
    // Once, when it appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  // Shown offline, or when the road data didn't load (a signal too weak to count).
  if (!show || !shell) return null;

  function open(k: KeptRoad) {
    setFailed(null);
    loadCell(k.cell)
      .then((roads) => {
        const r = roads.find((x) => x.id === k.id);
        if (r) shell!.addRoad(r);
        else setFailed(k.id);
      })
      .catch(() => setFailed(k.id));
  }

  return (
    <section className="offline-roads" aria-labelledby="offline-title">
      <h2 id="offline-title">No signal. Roads kept on this device:</h2>
      <ul>
        {kept.map((k) => (
          <li key={k.id}>
            <button type="button" className="road" onClick={() => open(k)}>
              <span className="road-main">
                <span className="road-name">{k.name}</span>
                <span className="fine">{[k.near && `Near ${k.near}`, k.state].filter(Boolean).join(", ")}</span>
                {failed === k.id && <span className="fine warn">Couldn&apos;t open it. Keep it again when you have signal.</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
