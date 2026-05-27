"""Mesh-to-solid pipeline: PyMeshLab cleanup followed by pythonocc-core STEP export."""

from os import makedirs
from os.path import exists, dirname, basename, splitext, abspath, join
from typing import Callable, Optional, cast
from pymeshlab import MeshSet, PercentageValue  # type: ignore[import-untyped]

from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_Sewing, BRepBuilderAPI_MakeSolid
from OCC.Core.BRepCheck import BRepCheck_Analyzer
from OCC.Core.BRepLib import breplib  # type: ignore[import-untyped]
from OCC.Core.ShapeFix import ShapeFix_Shape, ShapeFix_Solid
from OCC.Core.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCC.Core.TopAbs import TopAbs_SHELL, TopAbs_ShapeEnum
from OCC.Core.TopExp import TopExp_Explorer
from OCC.Core.IFSelect import IFSelect_RetDone
from OCC.Core.Interface import Interface_Static  # type: ignore[import-untyped]
from OCC.Core.StlAPI import stlapi
from OCC.Core.STEPControl import (
    STEPControl_AsIs,
    STEPControl_StepModelType,
    STEPControl_Writer,
)
from OCC.Core.TopoDS import TopoDS_Shape, topods


def read_stl_file(filename: str) -> TopoDS_Shape:
    """Read an STL file and return a TopoDS_Shape."""
    shape = TopoDS_Shape()
    stlapi.Read(shape, filename)
    return shape


def write_step_file(shape: TopoDS_Shape, filename: str) -> None:
    """Write a TopoDS_Shape to a STEP file."""
    writer = STEPControl_Writer()
    Interface_Static.SetCVal("write.step.schema", "AP203")
    writer.Transfer(shape, cast(STEPControl_StepModelType, STEPControl_AsIs))
    if writer.Write(filename) != IFSelect_RetDone:
        raise PipelineError(f"STEP write failed for {filename}")


TOLERANCE = 0.01
REFINE_PASSES = 3
TARGET_FACE_COUNT = 100000
MERGE_THRESHOLD = 0.0001


class PipelineError(Exception):
    """Raised when mesh-to-solid conversion fails.

    Wraps arbitrary exceptions from C-extension libraries (OCC, pymeshlab)
    so callers see a single, documented exception type.
    """


def _cleanup_mesh(
    input_file: str,
    output_clean_mesh: str,
    log: Callable[[str], None],
) -> None:
    """Stage 1 — PyMeshLab mesh repair, optional decimation, and STL export."""
    log("=== MESHLAB CLEANUP ===")
    ms = MeshSet()

    log("Loading mesh...")
    ms.load_new_mesh(input_file)
    log("Removing duplicate vertices...")
    ms.meshing_remove_duplicate_vertices()
    log("Removing duplicate faces...")
    ms.meshing_remove_duplicate_faces()
    log("Removing unreferenced vertices...")
    ms.meshing_remove_unreferenced_vertices()
    log("Repairing non-manifold edges...")
    ms.meshing_repair_non_manifold_edges()
    log("Repairing non-manifold vertices...")
    ms.meshing_repair_non_manifold_vertices()
    log("Merging close vertices...")
    ms.meshing_merge_close_vertices(threshold=PercentageValue(MERGE_THRESHOLD))
    log("Removing null faces...")
    ms.meshing_remove_null_faces()
    log("Re-orienting normals...")
    ms.meshing_re_orient_faces_coherently()

    face_count = ms.current_mesh().face_number()
    log(f"Current face count: {face_count}")
    if face_count > TARGET_FACE_COUNT:
        log(f"Decimating to ~{TARGET_FACE_COUNT} faces...")
        ms.meshing_decimation_quadric_edge_collapse(
            targetfacenum=TARGET_FACE_COUNT,
            preservenormal=True,
            preservetopology=True,
            preserveboundary=True,
            optimalplacement=True,
            planarquadric=True,
            qualitythr=0.3,
            autoclean=True,
        )

    log("Applying smoothing...")
    ms.apply_coord_laplacian_smoothing(stepsmoothnum=1)
    log("Saving cleaned mesh...")
    ms.save_current_mesh(output_clean_mesh)


def _build_solid(output_clean_mesh: str, log: Callable[[str], None]):
    """Stage 2 — Sew triangles into a closed pythonocc-core solid.

    Returns the refined shape ready for CAD optimisation.
    """
    log("=== PYTHONOCC SOLID CONVERSION ===")
    log("Loading cleaned mesh...")
    mesh_shape = read_stl_file(output_clean_mesh)

    log(f"Sewing faces into a shell (tolerance={TOLERANCE} mm)...")
    sewer = BRepBuilderAPI_Sewing(TOLERANCE)
    sewer.Add(mesh_shape)
    sewer.Perform()
    sewn = sewer.SewedShape()

    log("Converting to solid...")
    make_solid = BRepBuilderAPI_MakeSolid()
    exp = TopExp_Explorer(sewn, cast(TopAbs_ShapeEnum, TopAbs_SHELL))
    shell_count = 0
    while exp.More():
        make_solid.Add(topods.Shell(exp.Current()))
        shell_count += 1
        exp.Next()

    if shell_count == 0:
        raise RuntimeError("No shells found after sewing — cannot create solid")
    log(f"  {shell_count} shell(s) added")

    log("Fixing solid orientation...")
    fix = ShapeFix_Solid(make_solid.Solid())
    fix.Perform()
    shape = fix.Solid()

    for i in range(REFINE_PASSES):
        log(f"Refine pass {i + 1}/{REFINE_PASSES}...")
        unify = ShapeUpgrade_UnifySameDomain(shape, True, True, True)
        unify.Build()
        shape = unify.Shape()

    return shape


def _optimise_and_export(shape, output_step: str, log: Callable[[str], None]) -> None:
    """Stage 3 — CAD optimisation passes and STEP file export."""
    log("=== CAD OPTIMISATION ===")

    log("Running shape fix (tolerances, orientations, wires)...")
    shape_fix = ShapeFix_Shape(shape)
    shape_fix.Perform()
    shape = shape_fix.Shape()

    log("Building 3-D curves on all edges...")
    breplib.BuildCurves3d(shape)
    log("Encoding edge regularity (G1 continuity)...")
    breplib.EncodeRegularity(shape)

    log("Checking geometry...")
    analyzer = BRepCheck_Analyzer(shape)
    if analyzer.IsValid():
        log("Geometry check passed.")
    else:
        log("WARNING: Geometry errors detected — STEP may still be usable.")

    log("Exporting STEP...")
    write_step_file(shape, output_step)


def run_pipeline(
    input_file: str,
    output_dir: Optional[str] = None,
    log: Callable[[str], None] = print,
) -> dict:
    """Run the full mesh-to-solid pipeline.

    Parameters
    ----------
    input_file:
        Path to input STL or OBJ file.
    output_dir:
        Directory for output files. Defaults to same directory as input.
    log:
        Callable that receives each progress message string.

    Returns
    -------
    dict with keys ``input``, ``cleaned_stl``, ``step``.
    """
    if not exists(input_file):
        raise FileNotFoundError(f"File not found: {input_file}")

    if output_dir is None:
        output_dir = dirname(abspath(input_file))
    makedirs(output_dir, exist_ok=True)

    base_name = splitext(basename(input_file))[0]
    output_step = join(output_dir, base_name + ".step")
    output_clean_mesh = join(output_dir, base_name + "_cleaned.stl")

    try:
        _cleanup_mesh(input_file, output_clean_mesh, log)
        shape = _build_solid(output_clean_mesh, log)
        _optimise_and_export(shape, output_step, log)
    except Exception as exc:
        raise PipelineError(str(exc)) from exc

    log("=== DONE ===")
    log(f"Input   : {basename(input_file)}")
    log(f"Cleaned : {basename(output_clean_mesh)}")
    log(f"STEP    : {basename(output_step)}")

    return {
        "input": input_file,
        "cleaned_stl": output_clean_mesh,
        "step": output_step,
    }
