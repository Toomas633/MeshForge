"""Flask backend for MeshForge."""

from io import BytesIO
from json import dumps
from os.path import basename, exists, splitext
from queue import Full, Queue, Empty
from threading import Lock, Thread
from uuid import UUID, uuid4
from zipfile import ZipFile, ZIP_DEFLATED
from pathlib import Path

from flask import (
    Flask,
    Response,
    abort,
    jsonify,
    request,
    send_file,
    send_from_directory,
    stream_with_context,
)
from werkzeug.utils import secure_filename

import mesh_pipeline

JOBS_DIR = Path(__file__).parent.parent / "jobs"
ALLOWED_EXTENSIONS = {".stl", ".obj"}

app = Flask(__name__, static_folder="../static", static_url_path="")

jobs: dict = {}
jobs_lock = Lock()

_job_queue: Queue = Queue()

_sse_clients: set = set()
_sse_lock = Lock()


def _broadcast_job(job_id: str) -> None:
    """Push the current job state to all connected SSE clients."""
    with jobs_lock:
        job = jobs.get(job_id)
    if job is None:
        return
    msg = dumps({"type": "job_update", "job": job})
    with _sse_lock:
        dead: set = set()
        for q in _sse_clients:
            try:
                q.put_nowait(msg)
            except Full:
                dead.add(q)
        _sse_clients.difference_update(dead)


def _log(job_id: str, message: str) -> None:
    """Append a log message to the job record and broadcast the update."""
    with jobs_lock:
        jobs[job_id]["log"].append(message)
    _broadcast_job(job_id)


def _run_job(job_id: str, input_path: str, output_dir: str) -> None:
    """Execute the mesh pipeline for one job and update its status record."""
    try:
        with jobs_lock:
            if jobs[job_id]["status"] == "cancelled":
                return
            jobs[job_id]["status"] = "running"
        _broadcast_job(job_id)

        result = mesh_pipeline.run_pipeline(
            input_file=input_path,
            output_dir=output_dir,
            log=lambda msg: _log(job_id, msg),
        )
        with jobs_lock:
            jobs[job_id]["status"] = "done"
            jobs[job_id]["outputs"] = [
                basename(result["step"]),
            ]
        _broadcast_job(job_id)
    except mesh_pipeline.PipelineError as exc:
        with jobs_lock:
            if job_id in jobs:
                jobs[job_id]["status"] = "error"
                jobs[job_id]["error"] = str(exc)
                jobs[job_id]["log"].append(f"ERROR: {exc}")
        _broadcast_job(job_id)


def _worker() -> None:
    """Single background thread that drains the job queue one job at a time."""
    while True:
        job_id, input_path, output_dir = _job_queue.get()
        try:
            _run_job(job_id, input_path, output_dir)
        finally:
            _job_queue.task_done()


_worker_thread = Thread(target=_worker, daemon=True)
_worker_thread.start()


@app.route("/", methods=["GET"])
def index():
    """Serve the single-page application shell."""
    return send_from_directory(Path(__file__).parent, "index.html")


@app.route("/favicon.svg", methods=["GET"])
def favicon():
    """Serve the SVG favicon."""
    return send_from_directory(
        Path(__file__).parent / "assets", "favicon.svg", mimetype="image/svg+xml"
    )


@app.route("/api/convert", methods=["POST"])
def api_convert():
    """Accept one or more mesh files and start a conversion job per file."""
    files = request.files.getlist("files")
    if not files or all(f.filename == "" for f in files):
        return jsonify({"error": "No files provided"}), 400

    provided_ids = request.form.getlist("job_ids")

    def _validated_id(raw: str) -> str:
        try:
            return str(UUID(raw))
        except (ValueError, AttributeError):
            return str(uuid4())

    created = []
    for i, f in enumerate(files):
        ext = Path(f.filename or "").suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            return jsonify({"error": f"Unsupported file type: {f.filename}"}), 400

        job_id = (
            _validated_id(provided_ids[i]) if i < len(provided_ids) else str(uuid4())
        )
        job_dir = JOBS_DIR / job_id
        input_dir = job_dir / "input"
        output_dir = job_dir / "output"
        input_dir.mkdir(parents=True, exist_ok=True)
        output_dir.mkdir(parents=True, exist_ok=True)

        filename = secure_filename(f.filename or "")
        input_path = str(input_dir / filename)
        f.save(input_path)

        with jobs_lock:
            jobs[job_id] = {
                "id": job_id,
                "filename": filename,
                "input_path": input_path,
                "status": "pending",
                "log": [],
                "outputs": [],
                "error": None,
            }

        _job_queue.put((job_id, input_path, str(output_dir)))
        created.append(job_id)

    return jsonify({"jobs": created}), 202


@app.route("/api/jobs/<job_id>", methods=["GET"])
def api_job_status(job_id: str):
    """Return current status, log lines and output filenames for a job."""
    with jobs_lock:
        job = jobs.get(job_id)
    if job is None:
        abort(404)
    return jsonify(job)


@app.route("/api/jobs/<job_id>/download/<filename>", methods=["GET"])
def api_download(job_id: str, filename: str):
    """Download a converted output file."""
    with jobs_lock:
        job = jobs.get(job_id)
    if job is None:
        abort(404)

    safe_name = secure_filename(filename)
    if safe_name != filename:
        abort(400)

    file_path = JOBS_DIR / job_id / "output" / safe_name
    if not file_path.exists():
        abort(404)

    return send_file(str(file_path), as_attachment=True)


@app.route("/api/jobs/<job_id>/input-file", methods=["GET"])
def api_input_file(job_id: str):
    """Serve the original input mesh file for 3-D preview in the browser."""
    with jobs_lock:
        job = jobs.get(job_id)
    if job is None:
        abort(404)
    input_path = job.get("input_path")
    if not input_path or not exists(input_path):
        abort(404)
    return send_file(input_path)


@app.route("/api/jobs/cancel", methods=["POST"])
def api_cancel_all():
    """Cancel all pending and running jobs (called on page unload)."""
    drained = []
    while True:
        try:
            item = _job_queue.get_nowait()
            drained.append(item[0])
            _job_queue.task_done()
        except Empty:
            break

    cancelled_ids = []
    with jobs_lock:
        for job in jobs.values():
            if job["status"] in ("pending", "running"):
                job["status"] = "cancelled"
                cancelled_ids.append(job["id"])

    for job_id in cancelled_ids:
        _broadcast_job(job_id)

    return jsonify({"cancelled": len(drained)}), 200


def _unique_arc_name(fname: str, used_names: set) -> str:
    arc_name = fname
    if arc_name in used_names:
        stem, ext = splitext(fname)
        counter = 1
        while arc_name in used_names:
            arc_name = f"{stem}_{counter}{ext}"
            counter += 1
    return arc_name


@app.route("/api/jobs/zip", methods=["GET"])
def api_download_zip():
    """Stream a ZIP archive of the STEP outputs for the requested job IDs."""
    raw = request.args.get("jobs", "")
    if not raw:
        abort(400)
    job_ids = [j.strip() for j in raw.split(",") if j.strip()]

    buf = BytesIO()
    used_names: set = set()
    with ZipFile(buf, "w", ZIP_DEFLATED) as zf:
        for job_id in job_ids:
            with jobs_lock:
                job = jobs.get(job_id)
            if job is None or job["status"] != "done":
                continue
            for fname in job["outputs"]:
                file_path = JOBS_DIR / job_id / "output" / fname
                if not file_path.exists():
                    continue
                arc_name = _unique_arc_name(fname, used_names)
                used_names.add(arc_name)
                zf.write(str(file_path), arc_name)

    buf.seek(0)
    return send_file(
        buf,
        mimetype="application/zip",
        as_attachment=True,
        download_name="converted.zip",
    )


@app.route("/api/events", methods=["GET"])
def sse_events():
    """SSE endpoint — pushes job updates to the browser in real time."""
    client_q: Queue = Queue(maxsize=200)
    with _sse_lock:
        _sse_clients.add(client_q)

    def generate():
        try:
            with jobs_lock:
                snapshot = list(jobs.values())
            for job in snapshot:
                yield f"data: {dumps({'type': 'job_update', 'job': job})}\n\n"
            while True:
                try:
                    msg = client_q.get(timeout=25)
                    yield f"data: {msg}\n\n"
                except Empty:
                    yield ": keepalive\n\n"
        finally:
            with _sse_lock:
                _sse_clients.discard(client_q)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if __name__ == "__main__":
    JOBS_DIR.mkdir(exist_ok=True)
    app.run(host="127.0.0.1", port=5000, debug=False)
