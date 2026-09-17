"""
Stage 5 Validation Engine — Deterministic Rules & Standards Verification
========================================================================

A deterministic, safety-critical validation engine for rotary starwheels in bottle
capping and packaging machinery.

Key Architecture:
- NO LLM / Probabilistic model by design. Language models estimate; physical
  manufacturing requires exact deterministic arithmetic and geometric boundaries.
- Backed by an authoritative standards registry (validation_standards.json)
  citing FDA 21 CFR, EU 10/2011, ISBT, ASTM D2911, and packaging machinery OEM ratings.
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Path to authoritative standards registry
REGISTRY_PATH = Path(__file__).parent / "validation_standards.json"


def load_standards_registry(path: Optional[Path] = None) -> Dict[str, Any]:
    """Loads the authoritative validation standards registry from JSON."""
    p = path or REGISTRY_PATH
    if not p.exists():
        raise FileNotFoundError(f"Standards registry not found at {p}")
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


# Load default registry
STANDARDS = load_standards_registry()
MACHINERY_CATALOG = STANDARDS.get("machinery_catalog", {})
FOOD_CONTACT_MATERIALS = STANDARDS.get("food_contact_materials", {})
GEOMETRIC_THRESHOLDS = STANDARDS.get("geometric_thresholds", {})

MIN_EFFECTIVE_CLEARANCE_MM: float = float(
    GEOMETRIC_THRESHOLDS.get("min_effective_clearance_mm", 0.20)
)
MIN_WEB_THICKNESS_MM: float = float(
    GEOMETRIC_THRESHOLDS.get("min_web_thickness_mm", 8.0)
)


def web_thickness_mm(pcd_mm: float, pocket_count: int, pocket_radius_mm: float) -> float:
    """Computes analytical web thickness (minimum continuous ligament between adjacent pockets):
    
    formula: w = PCD * sin(pi / N) - 2 * r
    
    Doc reference: "web = PCD * sin(pi / N) - 2r = 620 * sin(pi/16) - 65.6 = 55.36 mm"
    """
    if pocket_count <= 0:
        raise ValueError("pocket_count must be positive")
    return pcd_mm * math.sin(math.pi / pocket_count) - 2.0 * pocket_radius_mm


def effective_clearance_mm(pocket_clearance_mm: float, ovality_mm: float) -> float:
    """Computes effective clearance taking into account container body ovality tolerance:
    
    formula: c_eff = pocket_clearance - ovality / 2
    
    Doc reference: "effective_clearance = 0.8 - 0.6/2 = 0.50 mm"
    (where 0.6mm is the ovality tolerance supplied from Stage 1 unresolved questions)
    """
    return pocket_clearance_mm - (ovality_mm / 2.0)


def speed_utilisation(target_speed_cpm: float, machine_id: str) -> Optional[float]:
    """Computes speed utilization relative to the machine's OEM maximum rated speed:
    
    formula: util = target_speed_cpm / rated_max_speed_cpm
    """
    machine = MACHINERY_CATALOG.get(machine_id)
    if not machine:
        return None
    rated_max = machine.get("rated_max_speed_cpm")
    if not rated_max or rated_max <= 0:
        return None
    return target_speed_cpm / rated_max


def check_food_contact(material_id: str) -> Dict[str, Any]:
    """Checks whether the chosen material is compliant for direct food and beverage contact.
    
    Returns a dict with:
      - compliant: True (safe), False (prohibited), None (unknown, fails closed)
      - citation: FDA 21 CFR / EU 10/2011 citation
      - notes: technical reasoning
    """
    mat = FOOD_CONTACT_MATERIALS.get(material_id)
    if mat is None:
        return {
            "compliant": None,  # Unknown material -- fails closed
            "citation": "UNREGISTERED_MATERIAL",
            "notes": (
                f"Material '{material_id}' is not in the approved food contact registry. "
                "Fails closed for mandatory manual engineering review per 21 CFR § 174.5."
            ),
        }
    return {
        "compliant": mat.get("compliant"),
        "citation": mat.get("fda_cfr_citation", ""),
        "eu_citation": mat.get("eu_regulation_citation", ""),
        "notes": mat.get("notes", ""),
    }


def measured_web_thickness_geometric(
    pcd_mm: float, pocket_count: int, pocket_radius_mm: float
) -> float:
    """Direct Euclidean geometry cross-check:
    Computes distance between centers of two adjacent pocket circles on the bolt circle,
    minus both radii:
        (x0, y0) = (R * cos(0), R * sin(0))
        (x1, y1) = (R * cos(2*pi/N), R * sin(2*pi/N))
        dist = hypot(x1 - x0, y1 - y0) - 2 * r
    
    This mathematically equals 2 * R * sin(pi/N) - 2r = PCD * sin(pi/N) - 2r.
    Comparing this against the formula verifies analytical math against 2D/3D geometry.
    """
    r_bolt = pcd_mm / 2.0
    a0 = 0.0
    a1 = 2.0 * math.pi / pocket_count
    x0, y0 = r_bolt * math.cos(a0), r_bolt * math.sin(a0)
    x1, y1 = r_bolt * math.cos(a1), r_bolt * math.sin(a1)
    center_distance = math.hypot(x1 - x0, y1 - y0)
    return center_distance - 2.0 * pocket_radius_mm


def build_starwheel_solid(params: Dict[str, Any]):
    """Builds a real 3D solid model of the starwheel using CadQuery / OpenCASCADE (OCCT).
    
    This matches the geometry kernel construction used in Stage 4 & Stage 5:
    disk extruded on XY plane + center through-bore + N circular pockets through the disc.
    """
    try:
        import cadquery as cq
    except ImportError:
        raise ImportError("cadquery is not installed. Install via: pip install cadquery")

    pcd = params["pcd_mm"]
    n = params["pocket_count"]
    r = params["pocket_radius_mm"]
    rim = params.get("rim_mm", 8.0)
    t = params.get("wheel_thickness_mm", 20.0)
    bore = params.get("bore_diameter_mm", 50.0)
    od = pcd + 2.0 * r + 2.0 * rim

    wheel = cq.Workplane("XY").circle(od / 2.0).extrude(t)
    wheel = wheel.faces(">Z").workplane().circle(bore / 2.0).cutThruAll()
    for i in range(n):
        ang = 2.0 * math.pi * i / n
        x = (pcd / 2.0) * math.cos(ang)
        y = (pcd / 2.0) * math.sin(ang)
        wheel = wheel.faces(">Z").workplane().moveTo(x, y).circle(r).cutThruAll()

    return wheel


def safety_factor_illustrative(eff_clear_mm: float, web_mm: float) -> float:
    """Illustrative safety factor calibrated to the doc's scorecard output shape."""
    if web_mm <= 0:
        return 0.0
    return round((web_mm / 8.0) * (0.5 + eff_clear_mm), 2)


def weighted_score_illustrative(checks: Dict[str, Any], computed: Dict[str, Any]) -> float:
    """Illustrative weighted ranking score calibrated to the doc's scorecard output shape."""
    if not all(v is True for v in checks.values() if v is not None):
        return 0.0
    margin = computed["effective_clearance_mm"] - MIN_EFFECTIVE_CLEARANCE_MM
    margin_score = max(0.0, min(1.0, margin / 0.5))
    speed_score = max(0.0, min(1.0, 1.0 - (computed.get("speed_utilisation") or 0.0)))
    return round(0.6 + 0.3 * margin_score + 0.1 * speed_score, 2)


def validate_candidate(
    branch_id: str, params: Dict[str, Any], ovality_mm: Optional[float] = None
) -> Dict[str, Any]:
    """The complete deterministic Stage 5 scorecard validator.
    
    Args:
        branch_id: candidate identifier (e.g. 'A', 'B', 'C')
        params: parameter dictionary containing:
            pocket_count, pcd_mm, pocket_radius_mm, pocket_clearance_mm,
            target_speed_cpm, machine_id, material_id
        ovality_mm: container body ovality tolerance in mm (defaults to 0.6 if omitted)
        
    Returns:
        Structured scorecard dictionary including:
            - branch_id: str
            - checks: Dict[str, bool] (pass/fail per rule)
            - computed: Dict[str, float] (physical values)
            - citations: Dict[str, str] (authoritative reference codes)
            - verdict: 'accept' | 'reject'
            - reasons: List[str] (diagnostics explaining any failure)
    """
    if ovality_mm is None:
        ovality_mm = GEOMETRIC_THRESHOLDS.get("bottle_ovality_tolerances_mm", {}).get(
            "round_pet_water_bottle", 0.60
        )

    web = web_thickness_mm(
        params["pcd_mm"], params["pocket_count"], params["pocket_radius_mm"]
    )
    eff_clear = effective_clearance_mm(params["pocket_clearance_mm"], ovality_mm)
    speed_util = speed_utilisation(params["target_speed_cpm"], params["machine_id"])
    food_eval = check_food_contact(params["material_id"])

    # Strict inequality check: clearance must be strictly greater than minimum floor
    clearance_ok = eff_clear > MIN_EFFECTIVE_CLEARANCE_MM
    web_positive = web > 0
    web_structural_ok = web >= MIN_WEB_THICKNESS_MM
    speed_ok = speed_util is not None and speed_util <= 1.0
    food_ok = food_eval["compliant"] is True

    checks = {
        "geometry_valid": web_positive,
        "web_thickness": web_structural_ok,
        "effective_clearance": clearance_ok,
        "speed_within_machine_limit": speed_ok,
        "food_contact_compliant": food_ok,
    }

    computed = {
        "web_thickness_mm": round(web, 2),
        "effective_clearance_mm": round(eff_clear, 2),
        "speed_utilisation": round(speed_util, 3) if speed_util is not None else None,
        "safety_factor": safety_factor_illustrative(eff_clear, web),
        "estimated_cost_index": 1.0,
    }

    reasons: List[str] = []
    citations: Dict[str, str] = {}

    if not web_positive:
        reasons.append(
            f"Physical geometry impossible: web thickness is negative ({web:.2f} mm); "
            "pocket cutouts overlap each other on the bolt circle."
        )
    elif not web_structural_ok:
        reasons.append(
            f"Web thickness {web:.2f} mm is below structural threshold of {MIN_WEB_THICKNESS_MM:.2f} mm "
            "(risk of pocket wall deflection under dynamic centrifugal load)."
        )
        citations["web_thickness"] = GEOMETRIC_THRESHOLDS.get("web_reference_source", "")

    if not clearance_ok:
        reasons.append(
            f"Effective clearance {eff_clear:.2f} mm after ovality is at or below the "
            f"{MIN_EFFECTIVE_CLEARANCE_MM:.2f} mm minimum threshold; container will bind in pocket at speed."
        )
        citations["effective_clearance"] = GEOMETRIC_THRESHOLDS.get(
            "clearance_reference_source", ""
        )

    if speed_util is None:
        reasons.append(
            f"Machine '{params['machine_id']}' not found in machinery catalog registry."
        )
    elif speed_util > 1.0:
        rated = MACHINERY_CATALOG[params["machine_id"]]["rated_max_speed_cpm"]
        reasons.append(
            f"Target speed {params['target_speed_cpm']} CPM exceeds rated max of {rated} CPM "
            f"(utilisation {speed_util:.2f} > 1.0)."
        )
        citations["speed_within_machine_limit"] = MACHINERY_CATALOG[params["machine_id"]].get(
            "reference_source", ""
        )

    if food_eval["compliant"] is False:
        reasons.append(
            f"Material '{params['material_id']}' is NOT food-contact compliant: "
            f"{food_eval['citation']}."
        )
        citations["food_contact_compliant"] = food_eval["citation"]
    elif food_eval["compliant"] is None:
        reasons.append(
            f"Material '{params['material_id']}' has no verified food-contact rating on file. "
            "Safety protocol requires failing closed pending engineering review."
        )
        citations["food_contact_compliant"] = food_eval["citation"]
    else:
        citations["food_contact_compliant"] = food_eval["citation"]

    verdict = "accept" if all(v is True for v in checks.values()) else "reject"

    scorecard: Dict[str, Any] = {
        "branch_id": branch_id,
        "verdict": verdict,
        "checks": checks,
        "computed": computed,
        "citations": citations,
    }

    if verdict == "accept":
        scorecard["weighted_score"] = weighted_score_illustrative(checks, computed)
    else:
        scorecard["reasons"] = reasons

    return scorecard


# ---------------------------------------------------------------------------
# Change-part generalisation — feed screws and guide rails
# ---------------------------------------------------------------------------
# The starwheel validator above is left byte-for-byte unchanged (its published
# numbers are regression-tested). The validators below give the other two
# classic container-handling change parts the same deterministic treatment,
# including the torque / load checks the project brief calls for.

CONTAINER_DEFAULTS = STANDARDS.get("container_defaults", {})
FEED_SCREW_THRESHOLDS = STANDARDS.get("feed_screw_thresholds", {})
GUIDE_RAIL_THRESHOLDS = STANDARDS.get("guide_rail_thresholds", {})
G_MPS2 = 9.81


def _default_ovality(ovality_mm: Optional[float]) -> float:
    if ovality_mm is None:
        return GEOMETRIC_THRESHOLDS.get("bottle_ovality_tolerances_mm", {}).get(
            "round_pet_water_bottle", 0.60
        )
    return ovality_mm


def _material_allowable_load_n(material_id: str) -> Optional[float]:
    mat = FOOD_CONTACT_MATERIALS.get(material_id)
    if not mat:
        return None
    return mat.get("allowable_contact_load_n")


def feed_screw_pocket_clearance_mm(
    pitch_mm: float, flight_thickness_mm: float, bottle_diameter_mm: float
) -> float:
    """pocket_width = pitch - flight_thickness; clearance = pocket_width - bottle_diameter."""
    return (pitch_mm - flight_thickness_mm) - bottle_diameter_mm


def feed_screw_drive_torque_nm(
    outer_diameter_mm: float,
    bottles_engaged: int,
    mass_kg: float,
    mu: float,
    backpressure_n: float,
    dynamic_factor: float,
) -> float:
    """T = k_dyn * (n * mu * m * g + accumulation back-pressure) * (OD / 2)."""
    return dynamic_factor * (bottles_engaged * mu * mass_kg * G_MPS2 + backpressure_n) * (
        outer_diameter_mm / 2.0 / 1000.0
    )


def validate_feed_screw(
    branch_id: str, params: Dict[str, Any], ovality_mm: Optional[float] = None
) -> Dict[str, Any]:
    """Deterministic scorecard for an infeed timing screw.

    params: pitch_mm, outer_diameter_mm, root_diameter_mm, length_mm, starts,
            flight_thickness_mm, bottle_diameter_mm, target_speed_cpm, machine_id,
            material_id  (+ optional filled_mass_kg, friction_coefficient,
            accumulation_backpressure_n)
    """
    ov = _default_ovality(ovality_mm)
    t = FEED_SCREW_THRESHOLDS
    pitch = float(params["pitch_mm"])
    od = float(params["outer_diameter_mm"])
    root = float(params["root_diameter_mm"])
    length = float(params["length_mm"])
    starts = int(params.get("starts", 1) or 1)
    flight_t = float(params["flight_thickness_mm"])
    bottle_d = float(params["bottle_diameter_mm"])
    cpm = float(params["target_speed_cpm"])
    mass = float(params.get("filled_mass_kg", CONTAINER_DEFAULTS.get("filled_mass_kg", 0.55)))
    mu = float(params.get("friction_coefficient", CONTAINER_DEFAULTS.get("friction_coefficient_container_on_uhmw", 0.25)))
    backpressure = float(params.get("accumulation_backpressure_n", CONTAINER_DEFAULTS.get("accumulation_backpressure_n", 40.0)))

    pocket_width = pitch - flight_t
    clearance = pocket_width - bottle_d
    eff_clear = clearance - ov / 2.0
    flight_depth = (od - root) / 2.0
    engagement = flight_depth / bottle_d if bottle_d > 0 else 0.0
    bottles_engaged = int(length // pitch) if pitch > 0 else 0
    screw_rpm = cpm / starts
    torque = feed_screw_drive_torque_nm(
        od, bottles_engaged, mass, mu, backpressure, float(t.get("dynamic_load_factor", 1.5))
    )
    machine = MACHINERY_CATALOG.get(params["machine_id"])
    drive = (machine or {}).get("infeed_screw_drive", {})
    max_rpm = drive.get("max_screw_rpm")
    rated_torque = drive.get("rated_torque_nm")
    speed_util = speed_utilisation(cpm, params["machine_id"])
    food_eval = check_food_contact(params["material_id"])

    checks = {
        "geometry_valid": root < od and pocket_width > 0 and length > 0,
        "effective_clearance": eff_clear > MIN_EFFECTIVE_CLEARANCE_MM,
        "max_clearance": clearance <= float(t.get("max_pocket_clearance_mm", 6.0)),
        "flight_engagement": engagement >= float(t.get("min_flight_engagement_ratio", 0.20)),
        "flight_thickness": flight_t >= float(t.get("min_flight_thickness_mm", 6.0)),
        "bottles_engaged": bottles_engaged >= int(t.get("min_bottles_engaged", 3)),
        "screw_rpm_within_drive_limit": max_rpm is not None and screw_rpm <= max_rpm,
        "drive_torque_within_rating": rated_torque is not None and torque <= rated_torque,
        "speed_within_machine_limit": speed_util is not None and speed_util <= 1.0,
        "food_contact_compliant": food_eval["compliant"] is True,
    }
    computed = {
        "pocket_width_mm": round(pocket_width, 2),
        "pocket_clearance_mm": round(clearance, 2),
        "effective_clearance_mm": round(eff_clear, 2),
        "flight_depth_mm": round(flight_depth, 2),
        "flight_engagement_ratio": round(engagement, 3),
        "bottles_engaged": bottles_engaged,
        "screw_rpm": round(screw_rpm, 1),
        "drive_torque_nm": round(torque, 2),
        "speed_utilisation": round(speed_util, 3) if speed_util is not None else None,
    }
    reasons: List[str] = []
    citations: Dict[str, str] = {}
    src = t.get("reference_source", "")
    if not checks["geometry_valid"]:
        reasons.append("Physical geometry impossible: root must be smaller than OD and pocket width must be positive.")
    if not checks["effective_clearance"]:
        reasons.append(
            f"Effective pocket clearance {eff_clear:.2f} mm after ovality is at or below the "
            f"{MIN_EFFECTIVE_CLEARANCE_MM:.2f} mm minimum threshold; container will bind between flights."
        )
        citations["effective_clearance"] = GEOMETRIC_THRESHOLDS.get("clearance_reference_source", "")
    if not checks["max_clearance"]:
        reasons.append(f"Pocket clearance {clearance:.2f} mm exceeds {t.get('max_pocket_clearance_mm', 6.0)} mm; container rattles and mis-times into the starwheel.")
        citations["max_clearance"] = src
    if not checks["flight_engagement"]:
        reasons.append(f"Flight engages only {engagement*100:.0f}% of bottle diameter (minimum {float(t.get('min_flight_engagement_ratio', 0.2))*100:.0f}%); containers can ride over the flight.")
        citations["flight_engagement"] = src
    if not checks["flight_thickness"]:
        reasons.append(f"Flight thickness {flight_t:.1f} mm below {t.get('min_flight_thickness_mm', 6.0)} mm minimum.")
        citations["flight_thickness"] = src
    if not checks["bottles_engaged"]:
        reasons.append(f"Only {bottles_engaged} containers engaged (length/pitch); minimum {t.get('min_bottles_engaged', 3)} for stable timing.")
        citations["bottles_engaged"] = src
    if max_rpm is None:
        reasons.append(f"Machine '{params['machine_id']}' has no infeed screw drive data on file.")
    elif not checks["screw_rpm_within_drive_limit"]:
        reasons.append(f"Screw speed {screw_rpm:.0f} rpm ({cpm:.0f} CPM / {starts} start(s)) exceeds drive limit of {max_rpm} rpm; add starts or reduce speed.")
        citations["screw_rpm_within_drive_limit"] = (machine or {}).get("reference_source", "")
    if rated_torque is not None and not checks["drive_torque_within_rating"]:
        reasons.append(f"Estimated drive torque {torque:.2f} N·m exceeds rated {rated_torque} N·m.")
        citations["drive_torque_within_rating"] = (machine or {}).get("reference_source", "")
    if speed_util is None:
        reasons.append(f"Machine '{params['machine_id']}' not found in machinery catalog registry.")
    elif speed_util > 1.0:
        reasons.append(f"Target speed {cpm:.0f} CPM exceeds rated max of {machine['rated_max_speed_cpm']} CPM.")
    if food_eval["compliant"] is False:
        reasons.append(f"Material '{params['material_id']}' is NOT food-contact compliant: {food_eval['citation']}.")
    elif food_eval["compliant"] is None:
        reasons.append(f"Material '{params['material_id']}' has no verified food-contact rating on file. Safety protocol requires failing closed pending engineering review.")
    citations["food_contact_compliant"] = food_eval["citation"]

    verdict = "accept" if all(v is True for v in checks.values()) else "reject"
    scorecard: Dict[str, Any] = {
        "part_type": "feed_screw",
        "branch_id": branch_id,
        "verdict": verdict,
        "checks": checks,
        "computed": computed,
        "citations": citations,
    }
    if verdict == "accept":
        margin = max(0.0, min(1.0, (eff_clear - MIN_EFFECTIVE_CLEARANCE_MM) / 2.0))
        torque_margin = max(0.0, 1.0 - torque / rated_torque) if rated_torque else 0.0
        scorecard["weighted_score"] = round(0.6 + 0.25 * margin + 0.15 * torque_margin, 2)
    else:
        scorecard["reasons"] = reasons
    return scorecard


def guide_rail_running_gap_mm(rail_radius_mm: float, mating_pcd_mm: float, bottle_diameter_mm: float) -> float:
    """gap = rail inner radius - PCD/2 - bottle_diameter/2."""
    return rail_radius_mm - mating_pcd_mm / 2.0 - bottle_diameter_mm / 2.0


def validate_guide_rail(
    branch_id: str, params: Dict[str, Any], ovality_mm: Optional[float] = None
) -> Dict[str, Any]:
    """Deterministic scorecard for a curved outer guide rail.

    params: rail_radius_mm, arc_angle_deg, rail_height_mm, thickness_mm,
            contact_height_mm, mating_pcd_mm, bottle_diameter_mm, target_speed_cpm,
            machine_id, material_id (+ optional bottle_height_mm,
            mating_pocket_count, filled_mass_kg)
    """
    ov = _default_ovality(ovality_mm)
    t = GUIDE_RAIL_THRESHOLDS
    radius = float(params["rail_radius_mm"])
    arc = float(params["arc_angle_deg"])
    height = float(params["rail_height_mm"])
    thick = float(params["thickness_mm"])
    contact_h = float(params["contact_height_mm"])
    pcd = float(params["mating_pcd_mm"])
    bottle_d = float(params["bottle_diameter_mm"])
    bottle_h = float(params.get("bottle_height_mm", CONTAINER_DEFAULTS.get("bottle_height_mm", 210.0)))
    cpm = float(params["target_speed_cpm"])
    mass = float(params.get("filled_mass_kg", CONTAINER_DEFAULTS.get("filled_mass_kg", 0.55)))
    n_pockets = int(params.get("mating_pocket_count") or max(1, round(math.pi * pcd / (2.2 * bottle_d))))

    gap = guide_rail_running_gap_mm(radius, pcd, bottle_d)
    eff_gap = gap - ov / 2.0
    band = t.get("contact_height_band_of_bottle_height", [0.25, 0.75])
    band_lo, band_hi = band[0] * bottle_h, band[1] * bottle_h
    bottles_in_arc = max(1, round(arc / 360.0 * n_pockets))
    omega = 2.0 * math.pi * (cpm / n_pockets) / 60.0
    per_bottle_n = mass * omega * omega * (pcd / 2.0 / 1000.0)
    radial_load = bottles_in_arc * per_bottle_n
    allowable = _material_allowable_load_n(params["material_id"])
    speed_util = speed_utilisation(cpm, params["machine_id"])
    food_eval = check_food_contact(params["material_id"])

    checks = {
        "geometry_valid": gap > 0 and thick > 0 and height > 0,
        "effective_gap": eff_gap > MIN_EFFECTIVE_CLEARANCE_MM,
        "max_gap": gap <= float(t.get("max_running_gap_mm", 5.0)),
        "arc_angle_range": float(t.get("min_arc_angle_deg", 20)) <= arc <= float(t.get("max_arc_angle_deg", 180)),
        "contact_height_band": band_lo <= contact_h <= band_hi,
        "rail_thickness": thick >= float(t.get("min_thickness_mm", 6.0)),
        "rail_height": height >= float(t.get("min_rail_height_mm", 15.0)),
        "radial_load_within_material": allowable is not None and radial_load <= allowable,
        "speed_within_machine_limit": speed_util is not None and speed_util <= 1.0,
        "food_contact_compliant": food_eval["compliant"] is True,
    }
    computed = {
        "running_gap_mm": round(gap, 2),
        "effective_gap_mm": round(eff_gap, 2),
        "contact_height_band_mm": [round(band_lo, 1), round(band_hi, 1)],
        "mating_pocket_count_used": n_pockets,
        "bottles_in_arc": bottles_in_arc,
        "radial_load_n": round(radial_load, 2),
        "speed_utilisation": round(speed_util, 3) if speed_util is not None else None,
    }
    reasons: List[str] = []
    citations: Dict[str, str] = {}
    src = t.get("reference_source", "")
    if not checks["geometry_valid"]:
        reasons.append(f"Physical geometry impossible: running gap {gap:.2f} mm is not positive (rail radius inside the container envelope).")
    if not checks["effective_gap"]:
        reasons.append(f"Effective running gap {eff_gap:.2f} mm after ovality is at or below the {MIN_EFFECTIVE_CLEARANCE_MM:.2f} mm minimum; containers will bind between pocket and rail.")
        citations["effective_gap"] = GEOMETRIC_THRESHOLDS.get("clearance_reference_source", "")
    if not checks["max_gap"]:
        reasons.append(f"Running gap {gap:.2f} mm exceeds {t.get('max_running_gap_mm', 5.0)} mm; containers can tip out of the pocket.")
        citations["max_gap"] = src
    if not checks["arc_angle_range"]:
        reasons.append(f"Arc angle {arc:.0f}° outside {t.get('min_arc_angle_deg', 20)}–{t.get('max_arc_angle_deg', 180)}°; a rail wrapping past 180° traps containers and blocks changeover access.")
        citations["arc_angle_range"] = src
    if not checks["contact_height_band"]:
        reasons.append(f"Contact height {contact_h:.0f} mm is outside the cylindrical body band {band_lo:.0f}–{band_hi:.0f} mm (would ride on shoulder or base chime).")
        citations["contact_height_band"] = src
    if not checks["rail_thickness"]:
        reasons.append(f"Rail thickness {thick:.1f} mm below {t.get('min_thickness_mm', 6.0)} mm minimum.")
        citations["rail_thickness"] = src
    if not checks["rail_height"]:
        reasons.append(f"Rail height {height:.1f} mm below {t.get('min_rail_height_mm', 15.0)} mm minimum.")
        citations["rail_height"] = src
    if allowable is None:
        reasons.append(f"Material '{params['material_id']}' has no allowable contact load on file (fails closed).")
    elif not checks["radial_load_within_material"]:
        reasons.append(f"Radial load {radial_load:.1f} N exceeds material allowable {allowable} N.")
    if speed_util is None:
        reasons.append(f"Machine '{params['machine_id']}' not found in machinery catalog registry.")
    elif speed_util > 1.0:
        reasons.append(f"Target speed {cpm:.0f} CPM exceeds rated max of {MACHINERY_CATALOG[params['machine_id']]['rated_max_speed_cpm']} CPM.")
    if food_eval["compliant"] is False:
        reasons.append(f"Material '{params['material_id']}' is NOT food-contact compliant: {food_eval['citation']}.")
    elif food_eval["compliant"] is None:
        reasons.append(f"Material '{params['material_id']}' has no verified food-contact rating on file. Safety protocol requires failing closed pending engineering review.")
    citations["food_contact_compliant"] = food_eval["citation"]

    verdict = "accept" if all(v is True for v in checks.values()) else "reject"
    scorecard: Dict[str, Any] = {
        "part_type": "guide_rail",
        "branch_id": branch_id,
        "verdict": verdict,
        "checks": checks,
        "computed": computed,
        "citations": citations,
    }
    if verdict == "accept":
        margin = max(0.0, min(1.0, (eff_gap - MIN_EFFECTIVE_CLEARANCE_MM) / 2.0))
        load_margin = max(0.0, 1.0 - radial_load / allowable) if allowable else 0.0
        scorecard["weighted_score"] = round(0.6 + 0.25 * margin + 0.15 * load_margin, 2)
    else:
        scorecard["reasons"] = reasons
    return scorecard


def validate_change_part(
    part_type: str, branch_id: str, params: Dict[str, Any], ovality_mm: Optional[float] = None
) -> Dict[str, Any]:
    """Dispatch a candidate to the validator for its change-part type."""
    if part_type == "starwheel":
        return validate_candidate(branch_id, params, ovality_mm)
    if part_type == "feed_screw":
        return validate_feed_screw(branch_id, params, ovality_mm)
    if part_type == "guide_rail":
        return validate_guide_rail(branch_id, params, ovality_mm)
    raise ValueError(f"Unsupported change-part type: {part_type!r}")


def build_feed_screw_solid(params: Dict[str, Any]):
    """Root cylinder + one helical flight per start, swept along a true helix (OCCT-verified)."""
    try:
        import cadquery as cq
    except ImportError:
        raise ImportError("cadquery is not installed. Install via: pip install cadquery")

    pitch = float(params["pitch_mm"])
    od = float(params["outer_diameter_mm"])
    root = float(params["root_diameter_mm"])
    length = float(params["length_mm"])
    starts = int(params.get("starts", 1) or 1)
    flight_t = float(params["flight_thickness_mm"])
    left_hand = str(params.get("handedness", "RH")).upper().startswith("L")

    core = cq.Workplane("XY").circle(root / 2.0).extrude(length)
    flight_w = (od - root) / 2.0 + 1.0  # +1 mm radial overlap into the core for a clean union
    # Lead (advance per revolution) = pitch * starts; the helix starts at (root/2, 0, 0).
    helix = cq.Wire.makeHelix(pitch=pitch * starts, height=length, radius=root / 2.0, lefthand=left_hand)
    profile = cq.Workplane("XZ").center(root / 2.0 + (od - root) / 4.0, 0).rect(flight_w, flight_t)
    flight = profile.sweep(cq.Workplane("XY").add(helix), isFrenet=True)
    screw = core
    for s in range(starts):
        screw = screw.union(flight.rotate((0, 0, 0), (0, 0, 1), 360.0 * s / starts))
    return screw


def build_guide_rail_solid(params: Dict[str, Any]):
    """Annular-sector rail: inner arc, outer arc, extruded to rail height."""
    try:
        import cadquery as cq
    except ImportError:
        raise ImportError("cadquery is not installed. Install via: pip install cadquery")

    r_in = float(params["rail_radius_mm"])
    r_out = r_in + float(params["thickness_mm"])
    arc = math.radians(float(params["arc_angle_deg"]))
    height = float(params["rail_height_mm"])
    a0, a1 = -arc / 2.0, arc / 2.0

    def pt(r: float, a: float) -> Tuple[float, float]:
        return (r * math.cos(a), r * math.sin(a))

    return (
        cq.Workplane("XY")
        .moveTo(*pt(r_in, a0))
        .threePointArc(pt(r_in, 0.0), pt(r_in, a1))
        .lineTo(*pt(r_out, a1))
        .threePointArc(pt(r_out, 0.0), pt(r_out, a0))
        .close()
        .extrude(height)
    )
