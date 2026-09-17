"""
Stage 5 Verification & Reliability Test Suite
============================================

Automated test runner and demonstration of the Stage 5 Deterministic Validation Engine.
Runs ground-truth reproductions, edge-case matrices, and geometric cross-checks.
"""

from __future__ import annotations

import sys
import unittest
from typing import Any, Dict

import stage5_engine as s5


class TestStage5Validation(unittest.TestCase):
    """Rigorous regression test suite for Stage 5 starwheel validation."""

    def setUp(self) -> None:
        self.branch_a_params = {
            "pocket_count": 16,
            "pcd_mm": 620.0,
            "pocket_radius_mm": 32.8,
            "pocket_clearance_mm": 0.8,
            "target_speed_cpm": 380,
            "machine_id": "CAP-16",
            "material_id": "UHMW-PE",
        }
        self.branch_a_ovality = 0.60

        self.branch_c_params = {
            "pocket_count": 16,
            "pcd_mm": 620.0,
            "pocket_radius_mm": 32.8,
            "pocket_clearance_mm": 0.35,  # 0.35 - 0.6/2 = 0.05 mm
            "target_speed_cpm": 380,
            "machine_id": "CAP-16",
            "material_id": "UHMW-PE",
        }
        self.branch_c_ovality = 0.60

    def test_01_reproduce_branch_a_accept(self) -> None:
        """Test 1: Reproduce doc's published Branch A accept case verbatim."""
        result = s5.validate_candidate("A", self.branch_a_params, self.branch_a_ovality)

        # Assert physical values match published numbers to < 0.01 mm
        self.assertAlmostEqual(
            result["computed"]["web_thickness_mm"],
            55.36,
            places=2,
            msg="Web thickness must match doc formula result 55.36mm",
        )
        self.assertAlmostEqual(
            result["computed"]["effective_clearance_mm"],
            0.50,
            places=2,
            msg="Effective clearance must match doc result 0.50mm",
        )
        self.assertAlmostEqual(
            result["computed"]["speed_utilisation"],
            0.844,
            places=3,
            msg="Speed utilisation must match doc result 0.844",
        )

        # Assert all checks passed and verdict is accept
        self.assertEqual(result["verdict"], "accept")
        for check_name, passed in result["checks"].items():
            self.assertTrue(passed, f"Check '{check_name}' should have passed")

        # Verify citation
        self.assertIn("21 CFR § 177.1520", result["citations"]["food_contact_compliant"])

    def test_02_reproduce_branch_c_reject(self) -> None:
        """Test 2: Reproduce doc's published Branch C reject case (SW-10884 jam fault)."""
        result = s5.validate_candidate("C", self.branch_c_params, self.branch_c_ovality)

        self.assertAlmostEqual(result["computed"]["effective_clearance_mm"], 0.05, places=2)
        self.assertEqual(result["verdict"], "reject")
        self.assertFalse(result["checks"]["effective_clearance"])

        # Check diagnostic reason points to binding and clearance floor
        reasons_text = " ".join(result["reasons"])
        self.assertIn("bind in pocket", reasons_text)
        self.assertIn("0.20 mm", reasons_text)

    def test_03_boundary_exactly_at_clearance_floor(self) -> None:
        """Test 3: Boundary condition — clearance exactly at 0.20mm floor must strictly reject."""
        # Solves to exactly 0.20mm effective: clearance = 0.20 + 0.6/2 = 0.50mm
        params = {**self.branch_a_params, "pocket_clearance_mm": 0.50}
        result = s5.validate_candidate("Boundary_Floor", params, 0.60)

        self.assertAlmostEqual(result["computed"]["effective_clearance_mm"], 0.20, places=2)
        self.assertEqual(
            result["verdict"],
            "reject",
            "Strict inequality required: 0.20 mm has zero machining tolerance margin",
        )
        self.assertFalse(result["checks"]["effective_clearance"])

    def test_04_speed_exceeds_machine_rating(self) -> None:
        """Test 4: Speed exceeds machine rating (CAP-16 rated 450 CPM, target 480)."""
        params = {**self.branch_a_params, "target_speed_cpm": 480}
        result = s5.validate_candidate("Overspeed", params, 0.60)

        self.assertEqual(result["verdict"], "reject")
        self.assertFalse(result["checks"]["speed_within_machine_limit"])
        reasons_text = " ".join(result["reasons"])
        self.assertIn("exceeds rated max of 450 CPM", reasons_text)

    def test_05_non_food_safe_material(self) -> None:
        """Test 5: Non-food-safe material (mild steel) must reject with regulatory citation."""
        params = {**self.branch_a_params, "material_id": "mild steel"}
        result = s5.validate_candidate("MildSteel", params, 0.60)

        self.assertEqual(result["verdict"], "reject")
        self.assertFalse(result["checks"]["food_contact_compliant"])
        reasons_text = " ".join(result["reasons"])
        self.assertIn("NOT food-contact compliant", reasons_text)
        self.assertIn("21 CFR", reasons_text)

    def test_06_unknown_material_fails_closed(self) -> None:
        """Test 6: Unknown / unregistered material must fail closed for safety."""
        params = {**self.branch_a_params, "material_id": "acme-unregistered-polymer-900"}
        result = s5.validate_candidate("UnknownMat", params, 0.60)

        self.assertEqual(result["verdict"], "reject")
        self.assertFalse(result["checks"]["food_contact_compliant"])
        reasons_text = " ".join(result["reasons"])
        self.assertIn("no verified food-contact rating on file", reasons_text)

    def test_07_structural_web_thickness_minimum(self) -> None:
        """Test 7: Web thickness below 8.0mm structural threshold must be rejected."""
        # Tight pocket pitch where web is 5.0mm (below 8.0mm)
        # w = 620 * sin(pi/16) - 2 * r -> 120.96 - 2r = 5.0 -> 2r = 115.96 -> r = 57.98
        params = {**self.branch_a_params, "pocket_radius_mm": 57.98}
        result = s5.validate_candidate("ThinWeb", params, 0.60)

        self.assertEqual(result["verdict"], "reject")
        self.assertFalse(result["checks"]["web_thickness"])
        reasons_text = " ".join(result["reasons"])
        self.assertIn("structural threshold of 8.00 mm", reasons_text)

    def test_08_geometric_euclidean_cross_check(self) -> None:
        """Test 8: Trigonometric formula vs. Euclidean pocket-center geometry measurement."""
        cases = [
            {"pcd": 620.0, "n": 16, "r": 32.8},
            {"pcd": 540.0, "n": 12, "r": 44.0},
            {"pcd": 920.0, "n": 24, "r": 38.0},
        ]
        for c in cases:
            trig_web = s5.web_thickness_mm(c["pcd"], c["n"], c["r"])
            geom_web = s5.measured_web_thickness_geometric(c["pcd"], c["n"], c["r"])
            self.assertAlmostEqual(
                trig_web,
                geom_web,
                places=4,
                msg=f"Formula must agree with Euclidean geometry for PCD={c['pcd']}, N={c['n']}",
            )

    def test_09_cadquery_solid_construction_and_bounding_box(self) -> None:
        """Test 9: Cross-check against real 3D solid built with OpenCASCADE / CadQuery."""
        try:
            import cadquery as cq
        except ImportError:
            self.skipTest("cadquery not installed, skipping OCCT 3D solid test")

        solid = s5.build_starwheel_solid(self.branch_a_params)
        bbox = solid.val().BoundingBox()

        # Check Outer Diameter bounding box: OD = 620 + 2*32.8 + 2*8 = 701.6 mm
        expected_od = 620.0 + 2.0 * 32.8 + 2.0 * 8.0
        self.assertAlmostEqual(bbox.xlen, expected_od, places=1)
        self.assertAlmostEqual(bbox.ylen, expected_od, places=1)
        self.assertAlmostEqual(bbox.zlen, 20.0, places=1)

        # Verify solid volume is strictly positive and non-trivial
        vol = solid.val().Volume()
        self.assertGreater(vol, 1_000_000.0, "Wheel solid volume should exceed 1e6 mm^3")


class TestFeedScrewValidation(unittest.TestCase):
    """Deterministic checks for the infeed timing screw change part."""

    def setUp(self) -> None:
        # CAP-16 at 380 CPM: a single-start screw would need 380 rpm (> 350 drive limit),
        # so the reference accept case is a 2-start screw at 190 rpm.
        self.accept_params = {
            "pitch_mm": 80.0, "outer_diameter_mm": 140.0, "root_diameter_mm": 90.0,
            "length_mm": 480.0, "starts": 2, "flight_thickness_mm": 10.0,
            "bottle_diameter_mm": 66.0, "target_speed_cpm": 380,
            "machine_id": "CAP-16", "material_id": "UHMW-PE",
        }

    def test_10_feed_screw_reference_accept(self) -> None:
        r = s5.validate_feed_screw("FS-A", self.accept_params, 0.60)
        self.assertEqual(r["verdict"], "accept", r.get("reasons"))
        self.assertAlmostEqual(r["computed"]["pocket_clearance_mm"], 4.0, places=2)
        self.assertAlmostEqual(r["computed"]["effective_clearance_mm"], 3.7, places=2)
        self.assertEqual(r["computed"]["bottles_engaged"], 6)
        self.assertAlmostEqual(r["computed"]["screw_rpm"], 190.0, places=1)
        # T = 1.5 * (6*0.25*0.55*9.81 + 40) * 0.07 = 5.05 N·m
        self.assertAlmostEqual(r["computed"]["drive_torque_nm"], 5.05, places=2)

    def test_11_single_start_exceeds_drive_rpm(self) -> None:
        r = s5.validate_feed_screw("FS-1start", {**self.accept_params, "starts": 1}, 0.60)
        self.assertEqual(r["verdict"], "reject")
        self.assertFalse(r["checks"]["screw_rpm_within_drive_limit"])
        self.assertIn("380 rpm", " ".join(r["reasons"]))

    def test_12_pocket_too_tight_binds(self) -> None:
        # pocket width = 70 - 10 = 60 < 66 mm bottle
        r = s5.validate_feed_screw("FS-tight", {**self.accept_params, "pitch_mm": 70.0}, 0.60)
        self.assertEqual(r["verdict"], "reject")
        self.assertFalse(r["checks"]["effective_clearance"])

    def test_13_backpressure_exceeds_drive_torque(self) -> None:
        r = s5.validate_feed_screw("FS-torque", {**self.accept_params, "accumulation_backpressure_n": 200.0}, 0.60)
        self.assertEqual(r["verdict"], "reject")
        self.assertFalse(r["checks"]["drive_torque_within_rating"])
        self.assertGreater(r["computed"]["drive_torque_nm"], 12.0)

    def test_14_too_short_for_stable_timing(self) -> None:
        r = s5.validate_feed_screw("FS-short", {**self.accept_params, "length_mm": 200.0}, 0.60)
        self.assertEqual(r["verdict"], "reject")
        self.assertFalse(r["checks"]["bottles_engaged"])

    def test_15_non_food_material(self) -> None:
        r = s5.validate_feed_screw("FS-steel", {**self.accept_params, "material_id": "mild steel"}, 0.60)
        self.assertEqual(r["verdict"], "reject")
        self.assertFalse(r["checks"]["food_contact_compliant"])

    def test_16_feed_screw_solid_is_a_real_helix(self) -> None:
        try:
            import cadquery  # noqa: F401
        except ImportError:
            self.skipTest("cadquery not installed")
        solid = s5.build_feed_screw_solid({**self.accept_params, "starts": 1})
        bb = solid.val().BoundingBox()
        self.assertAlmostEqual(bb.xlen, 141.0, delta=2.0)
        self.assertAlmostEqual(bb.ylen, 141.0, delta=2.0)
        core_volume = 3.14159 * 45.0 ** 2 * 480.0
        self.assertGreater(solid.val().Volume(), core_volume * 1.1, "flight must add real volume")


class TestGuideRailValidation(unittest.TestCase):
    """Deterministic checks for the curved outer guide rail change part."""

    def setUp(self) -> None:
        # Mates with the Branch A starwheel (PCD 620, 16 pockets) and a 54 mm bottle.
        self.accept_params = {
            "rail_radius_mm": 340.0, "arc_angle_deg": 120.0, "rail_height_mm": 25.0,
            "thickness_mm": 12.0, "contact_height_mm": 95.0, "mating_pcd_mm": 620.0,
            "bottle_diameter_mm": 54.0, "bottle_height_mm": 210.0, "target_speed_cpm": 380,
            "machine_id": "CAP-16", "material_id": "UHMW-PE",
        }

    def test_20_guide_rail_reference_accept(self) -> None:
        r = s5.validate_guide_rail("GR-A", self.accept_params, 0.60)
        self.assertEqual(r["verdict"], "accept", r.get("reasons"))
        self.assertAlmostEqual(r["computed"]["running_gap_mm"], 3.0, places=2)
        self.assertAlmostEqual(r["computed"]["effective_gap_mm"], 2.7, places=2)
        self.assertEqual(r["computed"]["mating_pocket_count_used"], 16)
        self.assertEqual(r["computed"]["bottles_in_arc"], 5)

    def test_21_rail_wraps_past_180_rejected(self) -> None:
        r = s5.validate_guide_rail("GR-wrap", {**self.accept_params, "arc_angle_deg": 200.0}, 0.60)
        self.assertEqual(r["verdict"], "reject")
        self.assertFalse(r["checks"]["arc_angle_range"])

    def test_22_contact_on_shoulder_rejected(self) -> None:
        r = s5.validate_guide_rail("GR-shoulder", {**self.accept_params, "contact_height_mm": 190.0}, 0.60)
        self.assertEqual(r["verdict"], "reject")
        self.assertFalse(r["checks"]["contact_height_band"])

    def test_23_gap_too_large_rejected(self) -> None:
        r = s5.validate_guide_rail("GR-loose", {**self.accept_params, "rail_radius_mm": 345.0}, 0.60)
        self.assertEqual(r["verdict"], "reject")
        self.assertFalse(r["checks"]["max_gap"])

    def test_24_rail_inside_bottle_envelope_invalid(self) -> None:
        r = s5.validate_guide_rail("GR-collide", {**self.accept_params, "rail_radius_mm": 330.0}, 0.60)
        self.assertEqual(r["verdict"], "reject")
        self.assertFalse(r["checks"]["geometry_valid"])

    def test_25_dispatcher_routes_by_part_type(self) -> None:
        r = s5.validate_change_part("guide_rail", "GR-A", self.accept_params, 0.60)
        self.assertEqual(r["part_type"], "guide_rail")
        with self.assertRaises(ValueError):
            s5.validate_change_part("conveyor_belt", "X", {}, 0.60)

    def test_26_guide_rail_solid_volume_matches_analytic(self) -> None:
        try:
            import cadquery  # noqa: F401
        except ImportError:
            self.skipTest("cadquery not installed")
        import math
        solid = s5.build_guide_rail_solid(self.accept_params)
        r_in, r_out = 340.0, 352.0
        expected = math.pi * (r_out ** 2 - r_in ** 2) * (120.0 / 360.0) * 25.0
        self.assertAlmostEqual(solid.val().Volume(), expected, delta=expected * 0.01)


def print_demo_report() -> None:
    """Prints a clear, formatted demonstration report of Stage 5 validation."""
    print("\n" + "=" * 78)
    print("STAGE 5 DETERMINISTIC VALIDATION ENGINE — DEMONSTRATION & RELIABILITY REPORT")
    print("=" * 78)

    sample_cases = [
        ("Branch A (Doc Published Accept)", {
            "pocket_count": 16, "pcd_mm": 620.0, "pocket_radius_mm": 32.8,
            "pocket_clearance_mm": 0.8, "target_speed_cpm": 380,
            "machine_id": "CAP-16", "material_id": "UHMW-PE"
        }, 0.60),
        ("Branch C (Doc Published Reject — SW-10884)", {
            "pocket_count": 16, "pcd_mm": 620.0, "pocket_radius_mm": 32.8,
            "pocket_clearance_mm": 0.35, "target_speed_cpm": 380,
            "machine_id": "CAP-16", "material_id": "UHMW-PE"
        }, 0.60),
        ("Boundary (Strict 0.20mm Floor)", {
            "pocket_count": 16, "pcd_mm": 620.0, "pocket_radius_mm": 32.8,
            "pocket_clearance_mm": 0.50, "target_speed_cpm": 380,
            "machine_id": "CAP-16", "material_id": "UHMW-PE"
        }, 0.60),
        ("Machine Overspeed (480 CPM vs 450 max)", {
            "pocket_count": 16, "pcd_mm": 620.0, "pocket_radius_mm": 32.8,
            "pocket_clearance_mm": 0.8, "target_speed_cpm": 480,
            "machine_id": "CAP-16", "material_id": "UHMW-PE"
        }, 0.60),
        ("Non-Food-Safe Material (mild steel)", {
            "pocket_count": 16, "pcd_mm": 620.0, "pocket_radius_mm": 32.8,
            "pocket_clearance_mm": 0.8, "target_speed_cpm": 380,
            "machine_id": "CAP-16", "material_id": "mild steel"
        }, 0.60),
        ("Unregistered Polymer (fails closed)", {
            "pocket_count": 16, "pcd_mm": 620.0, "pocket_radius_mm": 32.8,
            "pocket_clearance_mm": 0.8, "target_speed_cpm": 380,
            "machine_id": "CAP-16", "material_id": "acme-super-nylon"
        }, 0.60),
    ]

    for title, params, ovality in sample_cases:
        scorecard = s5.validate_candidate(title, params, ovality)
        v = scorecard["verdict"].upper()
        comp = scorecard["computed"]
        print(f"\n[{v}] {title}")
        print(f"  Web Thickness:       {comp['web_thickness_mm']} mm")
        print(f"  Effective Clearance: {comp['effective_clearance_mm']} mm")
        print(f"  Speed Utilisation:   {comp['speed_utilisation']}")
        print(f"  Checks: {scorecard['checks']}")
        if scorecard.get("reasons"):
            print("  Failure Diagnostics & Standards Violated:")
            for r in scorecard["reasons"]:
                print(f"    - {r}")
        if scorecard.get("citations"):
            print("  Regulatory Citations:")
            for k, cit in scorecard["citations"].items():
                print(f"    * {k}: {cit}")

    print("\n" + "=" * 78 + "\n")


if __name__ == "__main__":
    print_demo_report()
    unittest.main()
