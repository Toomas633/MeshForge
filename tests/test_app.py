"""Tests for the Flask backend (app.py).

mesh_pipeline is mocked so these tests run without pymeshlab or pythonocc-core.
"""

from zipfile import ZipFile
from io import BytesIO
from uuid import UUID, uuid4

from pytest import fixture

import app as flask_app


@fixture()
def client(tmp_path, monkeypatch):
    """Flask test client with JOBS_DIR redirected to a temp directory."""
    monkeypatch.setattr(flask_app, "JOBS_DIR", tmp_path)
    flask_app.app.config["TESTING"] = True
    with flask_app.jobs_lock:
        flask_app.jobs.clear()
    with flask_app.app.test_client() as c:
        yield c


def _stl_file(name: str = "cube.stl") -> tuple:
    """Minimal valid binary STL (1 triangle)."""
    header = b"\x00" * 80
    count = (1).to_bytes(4, "little")
    normal = b"\x00" * 12
    v1 = b"\x00\x00\x00\x00\x00\x00\x80\x3f\x00\x00\x00\x00"
    v2 = b"\x00\x00\x80\x3f\x00\x00\x00\x00\x00\x00\x00\x00"
    v3 = b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x80\x3f"
    attr = b"\x00\x00"
    data = header + count + normal + v1 + v2 + v3 + attr
    return (BytesIO(data), name, "application/octet-stream")


def _obj_file(name: str = "quad.obj") -> tuple:
    content = b"v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3\nf 1 3 4\n"
    return (BytesIO(content), name, "text/plain")


def test_index_serves_html(client):
    """GET / returns 200 with an HTML body."""
    resp = client.get("/")
    assert resp.status_code == 200
    assert b"<!doctype html>" in resp.data.lower()


def test_convert_no_files(client):
    """POST /api/convert with no files returns 400 with an error field."""
    resp = client.post("/api/convert")
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_convert_unsupported_extension(client):
    """Uploading a file with an unsupported extension returns 400."""
    resp = client.post(
        "/api/convert",
        data={"files": (BytesIO(b"data"), "model.xyz")},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 400
    body = resp.get_json()
    assert "Unsupported" in body["error"]


def test_convert_single_stl_accepted(client, tmp_path, monkeypatch):
    """A single STL upload is accepted and returns a valid UUID job ID."""
    monkeypatch.setattr(flask_app, "JOBS_DIR", tmp_path)
    resp = client.post(
        "/api/convert",
        data={"files": _stl_file()},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 202
    body = resp.get_json()
    assert "jobs" in body
    assert len(body["jobs"]) == 1
    UUID(body["jobs"][0])


def test_convert_obj_accepted(client, tmp_path, monkeypatch):
    """An OBJ file is accepted and returns one job ID."""
    monkeypatch.setattr(flask_app, "JOBS_DIR", tmp_path)
    resp = client.post(
        "/api/convert",
        data={"files": _obj_file()},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 202
    assert len(resp.get_json()["jobs"]) == 1


def test_convert_multiple_files(client, tmp_path, monkeypatch):
    """Uploading two files creates two separate job IDs."""
    monkeypatch.setattr(flask_app, "JOBS_DIR", tmp_path)
    resp = client.post(
        "/api/convert",
        data={"files": [_stl_file("a.stl"), _stl_file("b.stl")]},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 202
    assert len(resp.get_json()["jobs"]) == 2


def test_convert_client_provided_uuid(client, tmp_path, monkeypatch):
    """A client-supplied valid UUID is preserved as the job ID."""
    monkeypatch.setattr(flask_app, "JOBS_DIR", tmp_path)
    job_id = str(uuid4())
    resp = client.post(
        "/api/convert",
        data={"files": _stl_file(), "job_ids": job_id},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 202
    assert resp.get_json()["jobs"][0] == job_id


def test_convert_invalid_uuid_replaced(client, tmp_path, monkeypatch):
    """A malicious job_id string is replaced with a freshly generated UUID."""
    monkeypatch.setattr(flask_app, "JOBS_DIR", tmp_path)
    resp = client.post(
        "/api/convert",
        data={"files": _stl_file(), "job_ids": "../../etc/passwd"},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 202
    returned_id = resp.get_json()["jobs"][0]
    UUID(returned_id)
    assert returned_id != "../../etc/passwd"


def test_job_status_unknown(client):
    """Requesting status for a non-existent job ID returns 404."""
    resp = client.get(f"/api/jobs/{uuid4()}")
    assert resp.status_code == 404


def test_job_status_returns_job(client, tmp_path, monkeypatch):
    """Status endpoint returns job JSON with the correct ID and filename."""
    monkeypatch.setattr(flask_app, "JOBS_DIR", tmp_path)
    post = client.post(
        "/api/convert",
        data={"files": _stl_file()},
        content_type="multipart/form-data",
    )
    job_id = post.get_json()["jobs"][0]
    resp = client.get(f"/api/jobs/{job_id}")
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["id"] == job_id
    assert body["filename"] == "cube.stl"
    assert body["status"] in ("pending", "running", "done", "error")


def test_download_unknown_job(client):
    """Downloading from an unknown job ID returns 404."""
    resp = client.get(f"/api/jobs/{uuid4()}/download/out.step")
    assert resp.status_code == 404


def test_download_existing_file(client, tmp_path, monkeypatch):
    """A completed job's STEP file is served with 200 and correct bytes."""
    monkeypatch.setattr(flask_app, "JOBS_DIR", tmp_path)
    job_id = str(uuid4())
    out_dir = tmp_path / job_id / "output"
    out_dir.mkdir(parents=True)
    (out_dir / "model.step").write_bytes(b"STEP data")

    with flask_app.jobs_lock:
        flask_app.jobs[job_id] = {
            "id": job_id,
            "filename": "model.stl",
            "input_path": "",
            "status": "done",
            "log": [],
            "outputs": ["model.step"],
            "error": None,
        }

    resp = client.get(f"/api/jobs/{job_id}/download/model.step")
    assert resp.status_code == 200
    assert resp.data == b"STEP data"


def test_download_path_traversal_rejected(client, tmp_path, monkeypatch):
    """A path-traversal filename in the download URL is rejected with 400/404."""
    monkeypatch.setattr(flask_app, "JOBS_DIR", tmp_path)
    job_id = str(uuid4())
    with flask_app.jobs_lock:
        flask_app.jobs[job_id] = {
            "id": job_id,
            "filename": "x.stl",
            "input_path": "",
            "status": "done",
            "log": [],
            "outputs": [],
            "error": None,
        }
    resp = client.get(f"/api/jobs/{job_id}/download/../../etc/passwd")
    assert resp.status_code in (400, 404)


def test_input_file_unknown_job(client):
    """Requesting the input file for a non-existent job returns 404."""
    resp = client.get(f"/api/jobs/{uuid4()}/input-file")
    assert resp.status_code == 404


def test_input_file_served(client, tmp_path, monkeypatch):
    """The original uploaded mesh file is served back with correct bytes."""
    monkeypatch.setattr(flask_app, "JOBS_DIR", tmp_path)
    job_id = str(uuid4())
    in_dir = tmp_path / job_id / "input"
    in_dir.mkdir(parents=True)
    f = in_dir / "model.stl"
    f.write_bytes(b"stl content")

    with flask_app.jobs_lock:
        flask_app.jobs[job_id] = {
            "id": job_id,
            "filename": "model.stl",
            "input_path": str(f),
            "status": "done",
            "log": [],
            "outputs": [],
            "error": None,
        }

    resp = client.get(f"/api/jobs/{job_id}/input-file")
    assert resp.status_code == 200
    assert resp.data == b"stl content"


def test_cancel_returns_200(client):
    """POST /api/jobs/cancel always returns 200 with a cancelled count."""
    resp = client.post("/api/jobs/cancel")
    assert resp.status_code == 200
    body = resp.get_json()
    assert "cancelled" in body


def test_cancel_marks_pending_jobs(client, tmp_path, monkeypatch):
    """Cancel endpoint transitions all pending jobs to cancelled status."""
    monkeypatch.setattr(flask_app, "JOBS_DIR", tmp_path)
    client.post(
        "/api/convert",
        data={"files": _stl_file()},
        content_type="multipart/form-data",
    )
    resp = client.post("/api/jobs/cancel")
    assert resp.status_code == 200
    with flask_app.jobs_lock:
        for job in flask_app.jobs.values():
            assert job["status"] in ("cancelled", "done", "error")


def test_zip_no_jobs_param(client):
    """GET /api/jobs/zip without a jobs parameter returns 400."""
    resp = client.get("/api/jobs/zip")
    assert resp.status_code == 400


def test_zip_unknown_jobs_returns_empty_zip(client):
    """Requesting a ZIP for unknown job IDs returns a 200 empty ZIP archive."""
    resp = client.get(f"/api/jobs/zip?jobs={uuid4()}")
    assert resp.status_code == 200
    assert resp.content_type == "application/zip"


def test_zip_includes_done_job_output(client, tmp_path, monkeypatch):
    """ZIP archive contains the STEP output for a completed job."""
    monkeypatch.setattr(flask_app, "JOBS_DIR", tmp_path)
    job_id = str(uuid4())
    out_dir = tmp_path / job_id / "output"
    out_dir.mkdir(parents=True)
    (out_dir / "model.step").write_bytes(b"STEP")

    with flask_app.jobs_lock:
        flask_app.jobs[job_id] = {
            "id": job_id,
            "filename": "model.stl",
            "input_path": "",
            "status": "done",
            "log": [],
            "outputs": ["model.step"],
            "error": None,
        }

    resp = client.get(f"/api/jobs/zip?jobs={job_id}")
    assert resp.status_code == 200
    with ZipFile(BytesIO(resp.data)) as z:
        assert "model.step" in z.namelist()
        assert z.read("model.step") == b"STEP"


def test_zip_deduplicates_filenames(client, tmp_path, monkeypatch):
    """ZIP archive renames duplicate output filenames to avoid collisions."""
    monkeypatch.setattr(flask_app, "JOBS_DIR", tmp_path)
    ids = []
    for _ in range(2):
        jid = str(uuid4())
        out_dir = tmp_path / jid / "output"
        out_dir.mkdir(parents=True)
        (out_dir / "model.step").write_bytes(b"STEP")
        with flask_app.jobs_lock:
            flask_app.jobs[jid] = {
                "id": jid,
                "filename": "model.stl",
                "input_path": "",
                "status": "done",
                "log": [],
                "outputs": ["model.step"],
                "error": None,
            }
        ids.append(jid)

    resp = client.get(f"/api/jobs/zip?jobs={ids[0]},{ids[1]}")
    with ZipFile(BytesIO(resp.data)) as z:
        names = z.namelist()
    assert len(names) == len(set(names)), "ZIP contains duplicate arc names"
