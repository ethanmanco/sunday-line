"""How hard a road works a car, measured the way a lap simulator would.

A virtual driver follows the road never exceeding the speed limit, slows for
each curve so cornering stays under a set grip level, and brakes and
accelerates at moderate rates. From that speed trace we read the same things a
driver feels on a race track: sustained cornering load, braking zones, quick
left-right changes, and the speed you can legally carry.

These speeds are a scoring tool only. The app never shows them as advice.
"""
from __future__ import annotations

import numpy as np

from . import geometry as g

MPH = 0.44704  # m/s


def analyze(xy: np.ndarray, limit_ms_at, cand_cfg: dict, bands: list, drive_cfg: dict) -> dict:
    """xy: projected meters. limit_ms_at(distances) -> speed limit (m/s) at those distances."""
    d, lens, w, r, turn = g.curvature_profile(xy, cand_cfg, bands)
    step = float(lens.mean()) if len(lens) else cand_cfg["resample_step_m"]
    limits = limit_ms_at(d)
    v, lat = g.speed_trace(
        r, step, limits,
        a_lat=drive_cfg["max_lateral_g"] * g.G,
        a_acc=drive_cfg["accel_g"] * g.G,
        a_brake=drive_cfg["brake_g"] * g.G,
    )
    m = g.trace_metrics(v, lat, r, step, turn, drive_cfg)
    m["weighted_curve_m"] = float((lens * w).sum())
    m["length_m"] = float(lens.sum())
    return m


def scores(m: dict, cfg: dict) -> dict:
    """Turn trace metrics into 0-100 Twisty and Speed scores.

    Twisty is measured against reference race tracks driven under the same
    rules (see references.toml): matching their average earns about 70.
    """
    ref = cfg["reference"]
    tw = cfg["twisty_mix"]
    ratio = (
        tw["cornering"] * min(2.0, m["mean_lat_g"] / ref["mean_lat_g"])
        + tw["braking"] * min(2.0, m["braking_ms_per_km"] / ref["braking_ms_per_km"])
        + tw["transitions"] * min(2.0, m["transitions_per_km"] / ref["transitions_per_km"])
    )
    # Smooth scale: a road that matches the track average scores about 70,
    # leaving room above for roads that work the car harder than that.
    twisty = 100 * (1 - np.exp(-ratio / cfg["track_ratio_scale"]))
    sp = cfg["speed"]
    avg_mph = m["avg_speed_ms"] / MPH
    speed = 100 * (avg_mph - sp["zero_at_mph"]) / (sp["full_at_mph"] - sp["zero_at_mph"])
    return {
        "twisty": float(np.clip(twisty, 0, 100)),
        "speed": float(np.clip(speed, 0, 100)),
        "avg_mph": avg_mph,
    }
