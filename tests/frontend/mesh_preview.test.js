'use strict';

const {
  generatePreview,
  parseStlBuf,
  parseAsciiStlText,
  parseObjText,
  subsampleFlat,
  renderMeshFlat,
} = require('../../static/features/mesh-preview.js');

function buildBinaryStl(n) {
  const buf = new ArrayBuffer(84 + n * 50);
  const view = new DataView(buf);
  view.setUint32(80, n, true);
  for (let i = 0; i < n; i++) {
    const base = 84 + i * 50;
    view.setFloat32(base + 0, 0, true);
    view.setFloat32(base + 4, 0, true);
    view.setFloat32(base + 8, 1, true);
    view.setFloat32(base + 12, 0, true);
    view.setFloat32(base + 16, 1, true);
    view.setFloat32(base + 20, 0, true);
    view.setFloat32(base + 24, 1, true);
    view.setFloat32(base + 28, 0, true);
    view.setFloat32(base + 32, 0, true);
    view.setFloat32(base + 36, 0, true);
    view.setFloat32(base + 40, 0, true);
    view.setFloat32(base + 44, 1, true);
    view.setUint16(base + 48, 0, true);
  }
  return buf;
}

describe('parseStlBuf (binary)', () => {
  test('single triangle returns 9 floats', () => {
    const flat = parseStlBuf(buildBinaryStl(1));
    expect(flat).toHaveLength(9);
  });

  test('vertex values are correct', () => {
    const flat = parseStlBuf(buildBinaryStl(1));
    expect(flat[0]).toBeCloseTo(0);
    expect(flat[1]).toBeCloseTo(1);
    expect(flat[2]).toBeCloseTo(0);
    expect(flat[3]).toBeCloseTo(1);
    expect(flat[4]).toBeCloseTo(0);
    expect(flat[5]).toBeCloseTo(0);
    expect(flat[6]).toBeCloseTo(0);
    expect(flat[7]).toBeCloseTo(0);
    expect(flat[8]).toBeCloseTo(1);
  });

  test('multiple triangles return 9 * n floats', () => {
    const flat = parseStlBuf(buildBinaryStl(4));
    expect(flat).toHaveLength(36);
  });

  test('empty buffer falls back to ASCII path and returns []', () => {
    const flat = parseStlBuf(new ArrayBuffer(0));
    expect(flat).toEqual([]);
  });
});

describe('parseAsciiStlText', () => {
  const asciiStl = `solid test
    facet normal 0 0 1
      outer loop
        vertex 0 1 0
        vertex 1 0 0
        vertex 0 0 1
      endloop
    endfacet
  endsolid test`;

  test('single facet returns 9 floats', () => {
    const flat = parseAsciiStlText(asciiStl);
    expect(flat).toHaveLength(9);
  });

  test('vertex values are correct', () => {
    const flat = parseAsciiStlText(asciiStl);
    expect(flat[0]).toBeCloseTo(0);
    expect(flat[1]).toBeCloseTo(1);
    expect(flat[2]).toBeCloseTo(0);
  });

  test('empty text returns []', () => {
    expect(parseAsciiStlText('')).toEqual([]);
  });

  test('missing endfacet skips incomplete facet', () => {
    const incomplete = `solid test
      facet normal 0 0 1
        outer loop
          vertex 0 1 0
          vertex 1 0 0
        endloop
      endfacet
    endsolid`;
    expect(parseAsciiStlText(incomplete)).toEqual([]);
  });
});

describe('parseObjText', () => {
  const singleTriObj = 'v 0 1 0\nv 1 0 0\nv 0 0 1\nf 1 2 3\n';

  test('single triangle returns 9 floats', () => {
    const flat = parseObjText(singleTriObj);
    expect(flat).toHaveLength(9);
  });

  test('quad face is triangulated into 2 triangles (18 floats)', () => {
    const quadObj = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n';
    const flat = parseObjText(quadObj);
    expect(flat).toHaveLength(18);
  });

  test('empty input returns []', () => {
    expect(parseObjText('')).toEqual([]);
  });

  test('relative negative face indices are resolved correctly', () => {
    const obj = 'v 0 1 0\nv 1 0 0\nv 0 0 1\nf -3 -2 -1\n';
    const flat = parseObjText(obj);
    expect(flat).toHaveLength(9);
  });

  test('out-of-bounds face index is silently skipped', () => {
    const obj = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 99\n';
    const flat = parseObjText(obj);
    expect(flat).toHaveLength(0);
  });
});

describe('subsampleFlat', () => {
  test('returns input unchanged when under the limit', () => {
    const small = Array.from({ length: 9 }, (_, i) => i);
    expect(subsampleFlat(small)).toEqual(small);
  });

  test('subsamples when over MAX_PREVIEW_TRIS', () => {
    const big = new Array(6001 * 9).fill(0);
    const out = subsampleFlat(big);
    expect(out.length).toBeLessThanOrEqual(6000 * 9);
    expect(out.length % 9).toBe(0);
  });
});

// ── Canvas / DOM helpers for the rendering tests ─────────────────────────────
function makeCtx() {
  return {
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    fill: jest.fn(),
    fillStyle: '',
  };
}
function makeCanvas(ctx) {
  return { width: 0, height: 0, getContext: jest.fn(() => ctx) };
}

// ────────────────────────────────────────────────────────────────────────────
describe('renderMeshFlat', () => {
  let ctx;
  let canvas;

  beforeEach(() => {
    ctx = makeCtx();
    canvas = makeCanvas(ctx);
    globalThis.document = {
      ...(globalThis.document || {}),
      createElement: jest.fn(() => canvas),
    };
  });

  test('returns canvas without drawing when getContext returns null', () => {
    canvas.getContext = jest.fn(() => null);
    const result = renderMeshFlat([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(result).toBe(canvas);
    expect(ctx.beginPath).not.toHaveBeenCalled();
  });

  test('draws one triangle and returns canvas', () => {
    const result = renderMeshFlat([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(result).toBe(canvas);
    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.fill).toHaveBeenCalledTimes(1);
  });

  test('draws multiple triangles', () => {
    // two triangles
    const flat = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
    renderMeshFlat(flat);
    expect(ctx.fill).toHaveBeenCalledTimes(2);
  });

  test('handles degenerate mesh where all coords are equal (zero extents)', () => {
    // all vertices the same → bbox size 0 → sc divisor uses || 1 fallback
    const result = renderMeshFlat([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(result).toBe(canvas);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('generatePreview', () => {
  let ctx;
  let canvas;
  let wrap;

  beforeEach(() => {
    ctx = makeCtx();
    canvas = makeCanvas(ctx);
    wrap = { innerHTML: '', appendChild: jest.fn() };
    globalThis.document = {
      getElementById: jest.fn((id) => (id.startsWith('preview-') ? wrap : null)),
      createElement: jest.fn(() => canvas),
    };
  });

  test('returns early when wrapper element is not found', async () => {
    globalThis.document.getElementById = jest.fn(() => null);
    await generatePreview('j1', {
      name: 'a.stl',
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
    });
    expect(wrap.appendChild).not.toHaveBeenCalled();
  });

  test('returns early for unsupported file extension', async () => {
    await generatePreview('j1', {
      name: 'model.gltf',
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
    });
    expect(wrap.appendChild).not.toHaveBeenCalled();
  });

  test('processes an STL file and appends canvas to wrapper', async () => {
    const buf = new ArrayBuffer(84 + 50);
    const view = new DataView(buf);
    view.setUint32(80, 1, true);
    view.setFloat32(84 + 12, 0, true);
    view.setFloat32(84 + 16, 1, true);
    view.setFloat32(84 + 20, 0, true);
    view.setFloat32(84 + 24, 1, true);
    view.setFloat32(84 + 28, 0, true);
    view.setFloat32(84 + 32, 0, true);
    view.setFloat32(84 + 36, 0, true);
    view.setFloat32(84 + 40, 0, true);
    view.setFloat32(84 + 44, 1, true);
    await generatePreview('j2', {
      name: 'model.stl',
      arrayBuffer: jest.fn().mockResolvedValue(buf),
    });
    expect(wrap.appendChild).toHaveBeenCalledWith(canvas);
  });

  test('processes an OBJ file and appends canvas to wrapper', async () => {
    const text = 'v 0 1 0\nv 1 0 0\nv 0 0 1\nf 1 2 3\n';
    const buf = new TextEncoder().encode(text).buffer;
    await generatePreview('j3', {
      name: 'model.obj',
      arrayBuffer: jest.fn().mockResolvedValue(buf),
    });
    expect(wrap.appendChild).toHaveBeenCalledWith(canvas);
  });

  test('returns early when parsed flat array has fewer than 9 values', async () => {
    // OBJ with no faces → flat = []
    const buf = new TextEncoder().encode('v 0 1 0\nv 1 0 0\n').buffer;
    await generatePreview('j4', {
      name: 'model.obj',
      arrayBuffer: jest.fn().mockResolvedValue(buf),
    });
    expect(wrap.appendChild).not.toHaveBeenCalled();
  });

  test('silently catches errors thrown by arrayBuffer()', async () => {
    const file = {
      name: 'model.stl',
      arrayBuffer: jest.fn().mockRejectedValue(new Error('IO error')),
    };
    await expect(generatePreview('j5', file)).resolves.toBeUndefined();
  });
});
