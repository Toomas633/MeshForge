const MAX_PREVIEW_TRIS = 6000;

async function generatePreview(jobId: string, file: File): Promise<void> {
  const wrap = document.getElementById(`preview-${jobId}`);
  if (!wrap) return;
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  try {
    const buf = await file.arrayBuffer();
    let flat: number[] | undefined;
    if (ext === '.stl') flat = parseStlBuf(buf);
    else if (ext === '.obj') flat = parseObjText(new TextDecoder().decode(buf));
    else return;
    if (!flat || flat.length < 9) return;
    const canvas = renderMeshFlat(flat);
    wrap.innerHTML = '';
    wrap.appendChild(canvas);
  } catch {
    /* preview failed silently */
  }
}

function parseStlBuf(buf: ArrayBuffer): number[] {
  const view = new DataView(buf);
  if (buf.byteLength >= 84) {
    const count = view.getUint32(80, true);
    if (buf.byteLength === 84 + count * 50 && count > 0) {
      const step = Math.max(1, Math.ceil(count / MAX_PREVIEW_TRIS));
      const flat: number[] = [];
      for (let i = 0; i < count; i += step) {
        const o = 84 + i * 50 + 12;
        for (let j = 0; j < 9; j++) flat.push(view.getFloat32(o + j * 4, true));
      }
      return flat;
    }
  }
  return parseAsciiStlText(new TextDecoder().decode(buf));
}

function parseAsciiStlText(text: string): number[] {
  const all: number[] = [];
  let verts: number[] = [];
  for (const raw of text.split('\n')) {
    const s = raw.trimStart();
    if (s.startsWith('vertex ')) {
      const p = s.split(/\s+/);
      verts.push(+p[1], +p[2], +p[3]);
    } else if (s.startsWith('endfacet')) {
      if (verts.length === 9) all.push(...verts);
      verts = [];
    }
  }
  return subsampleFlat(all);
}

function parseObjText(text: string): number[] {
  const vc: number[] = [];
  const all: number[] = [];
  for (const raw of text.split('\n')) {
    const s = raw.trimStart();
    if (s.startsWith('v ')) {
      const p = s.split(/\s+/);
      vc.push(+p[1], +p[2], +p[3]);
    } else if (s.startsWith('f ')) {
      const parts = s.split(/\s+/).slice(1);
      const idx = parts.map((p) => {
        const n = Number.parseInt(p);
        return n > 0 ? n - 1 : vc.length / 3 + n;
      });
      for (let i = 1; i < idx.length - 1; i++) {
        const a = idx[0] * 3;
        const b = idx[i] * 3;
        const c = idx[i + 1] * 3;
        if (
          a >= 0 &&
          b >= 0 &&
          c >= 0 &&
          a + 2 < vc.length &&
          b + 2 < vc.length &&
          c + 2 < vc.length
        ) {
          all.push(
            vc[a],
            vc[a + 1],
            vc[a + 2],
            vc[b],
            vc[b + 1],
            vc[b + 2],
            vc[c],
            vc[c + 1],
            vc[c + 2]
          );
        }
      }
    }
  }
  return subsampleFlat(all);
}

function subsampleFlat(flat: number[]): number[] {
  const n = flat.length / 9;
  if (n <= MAX_PREVIEW_TRIS) return flat;
  const step = Math.ceil(n / MAX_PREVIEW_TRIS);
  const out: number[] = [];
  for (let i = 0; i < flat.length; i += 9 * step) {
    out.push(
      flat[i],
      flat[i + 1],
      flat[i + 2],
      flat[i + 3],
      flat[i + 4],
      flat[i + 5],
      flat[i + 6],
      flat[i + 7],
      flat[i + 8]
    );
  }
  return out;
}

function renderMeshFlat(flat: number[]): HTMLCanvasElement {
  const SIZE = 52;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Background is transparent — the .job-preview wrapper's CSS var(--preview-bg)
  // handles the background and switches automatically with the theme.

  let x0 = Infinity,
    y0 = Infinity,
    z0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity,
    z1 = -Infinity;
  for (let i = 0; i < flat.length; i += 3) {
    const x = flat[i],
      y = flat[i + 1],
      z = flat[i + 2];
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  const mx = (x0 + x1) / 2,
    my = (y0 + y1) / 2,
    mz = (z0 + z1) / 2;
  const sc = (SIZE * 0.42) / (Math.max(x1 - x0, y1 - y0, z1 - z0) || 1);

  const sY = Math.sin(0.7),
    cY = Math.cos(0.7);
  const sP = Math.sin(-0.44),
    cP = Math.cos(-0.44);

  function xf(x: number, y: number, z: number): [number, number, number] {
    x = (x - mx) * sc;
    y = (y - my) * sc;
    z = (z - mz) * sc;
    const x2 = cY * x + sY * z;
    const z2 = -sY * x + cY * z;
    return [x2, cP * y - sP * z2, sP * y + cP * z2];
  }

  const li = 1 / Math.sqrt(3);
  const half = SIZE / 2;

  const tris: Triangle[] = [];
  for (let i = 0; i < flat.length; i += 9) {
    const [ax, ay, az] = xf(flat[i], flat[i + 1], flat[i + 2]);
    const [bx, by, bz] = xf(flat[i + 3], flat[i + 4], flat[i + 5]);
    const [cx, cy, cz] = xf(flat[i + 6], flat[i + 7], flat[i + 8]);
    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az;
    const vx = cx - ax,
      vy = cy - ay,
      vz = cz - az;
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    const dot = Math.max(0, ((nx + ny + nz) * li) / nl);
    tris.push({ ax, ay, bx, by, cx, cy, z: (az + bz + cz) / 3, d: 0.15 + dot * 0.85 });
  }
  tris.sort((a, b) => a.z - b.z);

  for (const t of tris) {
    const d = t.d;
    ctx.fillStyle = `rgb(${Math.trunc(28 + 72 * d)},${Math.trunc(38 + 108 * d)},${Math.trunc(78 + 177 * d)})`;
    ctx.beginPath();
    ctx.moveTo(half + t.ax, half - t.ay);
    ctx.lineTo(half + t.bx, half - t.by);
    ctx.lineTo(half + t.cx, half - t.cy);
    ctx.closePath();
    ctx.fill();
  }
  return canvas;
}
