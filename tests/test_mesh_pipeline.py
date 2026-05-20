"""Tests for src/mesh_pipeline.py with mocked OCC/pymeshlab dependencies."""

from importlib.util import module_from_spec, spec_from_file_location
from sys import modules
from pathlib import Path
from unittest.mock import MagicMock, patch

from pytest import approx, fixture, raises


def _load_pipeline():
    """Load src/mesh_pipeline.py with heavy C-extension deps mocked out."""
    _ret_done = 0
    _ifselect = MagicMock()
    _ifselect.IFSelect_RetDone = _ret_done
    _step = MagicMock()
    _step.STEPControl_Writer.return_value.Write.return_value = _ret_done
    mock_pkgs = {
        "pymeshlab": MagicMock(),
        "OCC": MagicMock(),
        "OCC.Core": MagicMock(),
        "OCC.Core.BRepBuilderAPI": MagicMock(),
        "OCC.Core.BRepCheck": MagicMock(),
        "OCC.Core.BRepLib": MagicMock(),
        "OCC.Core.IFSelect": _ifselect,
        "OCC.Core.Interface": MagicMock(),
        "OCC.Core.ShapeFix": MagicMock(),
        "OCC.Core.ShapeUpgrade": MagicMock(),
        "OCC.Core.STEPControl": _step,
        "OCC.Core.StlAPI": MagicMock(),
        "OCC.Core.TopAbs": MagicMock(),
        "OCC.Core.TopExp": MagicMock(),
        "OCC.Core.TopoDS": MagicMock(),
    }
    saved = {k: modules.get(k) for k in mock_pkgs}
    modules.update(mock_pkgs)
    try:
        spec = spec_from_file_location(
            "_mesh_pipeline_under_test",
            Path(__file__).parent.parent / "src" / "mesh_pipeline.py",
        )
        assert spec is not None and spec.loader is not None
        mod = module_from_spec(spec)
        spec.loader.exec_module(mod)
    finally:
        for k, v in saved.items():
            if v is None:
                modules.pop(k, None)
            else:
                modules[k] = v
    return mod


_mp = _load_pipeline()


def _ms_mock(face_count: int = 100) -> MagicMock:
    ms = MagicMock()
    ms.current_mesh.return_value.face_number.return_value = face_count
    return ms


def _exp_mock(n_shells: int = 1) -> MagicMock:
    exp = MagicMock()
    exp.More.side_effect = [True] * n_shells + [False]
    return exp


class TestConstants:
    """Verify pipeline constant values used by downstream callers."""

    def test_tolerance(self):
        """TOLERANCE must equal 0.01 mm (sewing tolerance)."""
        assert _mp.TOLERANCE == approx(0.01)

    def test_refine_passes(self):
        """REFINE_PASSES must be 3."""
        assert _mp.REFINE_PASSES == 3

    def test_target_face_count(self):
        """TARGET_FACE_COUNT must be 100 000."""
        assert _mp.TARGET_FACE_COUNT == 100_000

    def test_merge_threshold(self):
        """MERGE_THRESHOLD must equal 0.0001."""
        assert _mp.MERGE_THRESHOLD == approx(0.0001)


class TestRunPipelineErrors:
    """Tests for error paths that must raise before any I/O occurs."""

    def test_missing_file_raises_file_not_found(self, tmp_path):
        """run_pipeline raises FileNotFoundError for a non-existent input."""
        with raises(FileNotFoundError, match="File not found"):
            _mp.run_pipeline(str(tmp_path / "nonexistent.stl"))

    def test_no_shells_raises_pipeline_error(self, tmp_path):
        """PipelineError is raised when sewing produces zero shells."""
        stl = tmp_path / "t.stl"
        stl.write_bytes(b"dummy")
        with (
            patch.object(_mp, "MeshSet", return_value=_ms_mock()),
            patch.object(_mp, "TopExp_Explorer", return_value=_exp_mock(0)),
        ):
            with raises(_mp.PipelineError, match="No shells"):
                _mp.run_pipeline(str(stl), output_dir=str(tmp_path))


class TestRunPipelineSuccess:
    """Happy-path tests for run_pipeline with mocked heavy dependencies."""

    @fixture
    def stl(self, tmp_path):
        """Provide a dummy STL file path that exists on disk."""
        p = tmp_path / "mesh.stl"
        p.write_bytes(b"dummy")
        return p

    def _run(self, stl, tmp_path, **kw):
        """Run pipeline with default mocks; **kw forwarded to _ms_mock."""
        with (
            patch.object(_mp, "MeshSet", return_value=_ms_mock(**kw)),
            patch.object(_mp, "TopExp_Explorer", return_value=_exp_mock(1)),
        ):
            return _mp.run_pipeline(str(stl), output_dir=str(tmp_path))

    def test_returns_dict_with_expected_keys(self, stl, tmp_path):
        """Return value contains exactly the three expected path keys."""
        result = self._run(stl, tmp_path)
        assert set(result.keys()) == {"input", "cleaned_stl", "step"}

    def test_input_path_preserved(self, stl, tmp_path):
        """The 'input' value in the result matches the original file path."""
        result = self._run(stl, tmp_path)
        assert result["input"] == str(stl)

    def test_step_file_has_correct_extension(self, stl, tmp_path):
        """The STEP output path ends with '.step'."""
        result = self._run(stl, tmp_path)
        assert result["step"].endswith(".step")

    def test_cleaned_stl_has_correct_suffix(self, stl, tmp_path):
        """The cleaned mesh path ends with '_cleaned.stl'."""
        result = self._run(stl, tmp_path)
        assert result["cleaned_stl"].endswith("_cleaned.stl")

    def test_output_dir_used(self, stl, tmp_path):
        """Explicitly provided output_dir is reflected in the STEP path."""
        out = tmp_path / "output"
        with (
            patch.object(_mp, "MeshSet", return_value=_ms_mock()),
            patch.object(_mp, "TopExp_Explorer", return_value=_exp_mock(1)),
        ):
            result = _mp.run_pipeline(str(stl), output_dir=str(out))
        assert result["step"].startswith(str(out))

    def test_default_output_dir_is_input_dir(self, stl):
        """When output_dir is omitted the STEP lands next to the input file."""
        with (
            patch.object(_mp, "MeshSet", return_value=_ms_mock()),
            patch.object(_mp, "TopExp_Explorer", return_value=_exp_mock(1)),
        ):
            result = _mp.run_pipeline(str(stl))
        assert result["step"].startswith(str(stl.parent))

    def test_log_receives_stage_banners(self, stl, tmp_path):
        """log callback receives messages for all three pipeline stage banners."""
        logs: list[str] = []
        with (
            patch.object(_mp, "MeshSet", return_value=_ms_mock()),
            patch.object(_mp, "TopExp_Explorer", return_value=_exp_mock(1)),
        ):
            _mp.run_pipeline(str(stl), output_dir=str(tmp_path), log=logs.append)
        assert any("MESHLAB" in m for m in logs)
        assert any("PYTHONOCC" in m for m in logs)
        assert any("DONE" in m for m in logs)

    def test_geometry_valid_logs_passed(self, stl, tmp_path):
        """A valid geometry check logs a 'passed' message with no WARNING."""
        logs: list[str] = []
        analyzer = MagicMock()
        analyzer.IsValid.return_value = True
        with (
            patch.object(_mp, "MeshSet", return_value=_ms_mock()),
            patch.object(_mp, "TopExp_Explorer", return_value=_exp_mock(1)),
            patch.object(_mp, "BRepCheck_Analyzer", return_value=analyzer),
        ):
            _mp.run_pipeline(str(stl), output_dir=str(tmp_path), log=logs.append)
        assert any("passed" in m.lower() for m in logs)
        assert not any("WARNING" in m for m in logs)

    def test_geometry_invalid_logs_warning(self, stl, tmp_path):
        """An invalid geometry check logs a WARNING message."""
        logs: list[str] = []
        analyzer = MagicMock()
        analyzer.IsValid.return_value = False
        with (
            patch.object(_mp, "MeshSet", return_value=_ms_mock()),
            patch.object(_mp, "TopExp_Explorer", return_value=_exp_mock(1)),
            patch.object(_mp, "BRepCheck_Analyzer", return_value=analyzer),
        ):
            _mp.run_pipeline(str(stl), output_dir=str(tmp_path), log=logs.append)
        assert any("WARNING" in m for m in logs)


class TestDecimation:
    """Verify that mesh decimation is triggered only above the face-count threshold."""

    @fixture
    def stl(self, tmp_path):
        """Provide a dummy STL file path that exists on disk."""
        p = tmp_path / "big.stl"
        p.write_bytes(b"dummy")
        return p

    def test_no_decimation_below_target(self, stl, tmp_path):
        """Decimation is skipped when face count is strictly below TARGET_FACE_COUNT."""
        ms = _ms_mock(face_count=_mp.TARGET_FACE_COUNT - 1)
        with (
            patch.object(_mp, "MeshSet", return_value=ms),
            patch.object(_mp, "TopExp_Explorer", return_value=_exp_mock(1)),
        ):
            _mp.run_pipeline(str(stl), output_dir=str(tmp_path))
        ms.meshing_decimation_quadric_edge_collapse.assert_not_called()

    def test_decimation_at_target(self, stl, tmp_path):
        """Decimation is skipped when face count equals TARGET_FACE_COUNT exactly."""
        ms = _ms_mock(face_count=_mp.TARGET_FACE_COUNT)
        with (
            patch.object(_mp, "MeshSet", return_value=ms),
            patch.object(_mp, "TopExp_Explorer", return_value=_exp_mock(1)),
        ):
            _mp.run_pipeline(str(stl), output_dir=str(tmp_path))
        ms.meshing_decimation_quadric_edge_collapse.assert_not_called()

    def test_decimation_above_target(self, stl, tmp_path):
        """Decimation is applied when face count exceeds TARGET_FACE_COUNT."""
        ms = _ms_mock(face_count=_mp.TARGET_FACE_COUNT + 1)
        with (
            patch.object(_mp, "MeshSet", return_value=ms),
            patch.object(_mp, "TopExp_Explorer", return_value=_exp_mock(1)),
        ):
            _mp.run_pipeline(str(stl), output_dir=str(tmp_path))
        ms.meshing_decimation_quadric_edge_collapse.assert_called_once()

    def test_decimation_uses_target_face_count(self, stl, tmp_path):
        """Decimation call uses TARGET_FACE_COUNT as the targetfacenum argument."""
        ms = _ms_mock(face_count=_mp.TARGET_FACE_COUNT + 1)
        with (
            patch.object(_mp, "MeshSet", return_value=ms),
            patch.object(_mp, "TopExp_Explorer", return_value=_exp_mock(1)),
        ):
            _mp.run_pipeline(str(stl), output_dir=str(tmp_path))
        call_kwargs = ms.meshing_decimation_quadric_edge_collapse.call_args.kwargs
        assert call_kwargs["targetfacenum"] == _mp.TARGET_FACE_COUNT


class TestMultipleShells:
    """Verify that meshes with more than one shell are converted successfully."""

    def test_two_shells_succeed(self, tmp_path):
        """run_pipeline succeeds and returns a step key when sewing yields two shells."""
        stl = tmp_path / "multi.stl"
        stl.write_bytes(b"dummy")
        with (
            patch.object(_mp, "MeshSet", return_value=_ms_mock()),
            patch.object(_mp, "TopExp_Explorer", return_value=_exp_mock(2)),
        ):
            result = _mp.run_pipeline(str(stl), output_dir=str(tmp_path))
        assert "step" in result
