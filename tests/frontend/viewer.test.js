'use strict';

// ── THREE.js mock objects (created before require) ───────────────────────────
const mockRenderer = {
  setPixelRatio: jest.fn(),
  setClearColor: jest.fn(),
  setSize: jest.fn(),
  render: jest.fn(),
  outputEncoding: undefined,
  domElement: { style: {} },
};

const mockSceneChildren = [];
const mockScene = {
  add: jest.fn(),
  remove: jest.fn(),
  get children() {
    return mockSceneChildren;
  },
};

const mockCameraPosition = { set: jest.fn() };
const mockCamera = {
  fov: 45,
  aspect: 1,
  near: 0.001,
  far: 100000,
  position: mockCameraPosition,
  updateProjectionMatrix: jest.fn(),
};

const mockControlsTarget = { set: jest.fn() };
const mockControls = {
  enableDamping: false,
  dampingFactor: 0,
  screenSpacePanning: false,
  minDistance: 0,
  maxDistance: 0,
  target: mockControlsTarget,
  update: jest.fn(),
};

function MockMesh(geometry, material) {
  this.geometry = geometry || { computeVertexNormals: jest.fn() };
  this.material = material || {};
  this.userData = {};
  this.position = { set: jest.fn(), sub: jest.fn() };
  this.traverse = jest.fn((cb) => cb(this));
}

const mockBox3 = {
  setFromObject: jest.fn().mockReturnThis(),
  getCenter: jest.fn(() => ({ x: 0, y: 0, z: 0 })),
  getSize: jest.fn(() => ({ x: 1, y: 1, z: 1 })),
};

globalThis.THREE = {
  WebGLRenderer: jest.fn(() => mockRenderer),
  Scene: jest.fn(() => mockScene),
  PerspectiveCamera: jest.fn(() => mockCamera),
  AmbientLight: jest.fn(() => ({})),
  DirectionalLight: jest.fn(() => ({ position: { set: jest.fn() } })),
  OrbitControls: jest.fn(() => mockControls),
  sRGBEncoding: 1,
  Mesh: MockMesh,
  Box3: jest.fn(() => mockBox3),
  Vector3: jest.fn(() => ({ x: 0, y: 0, z: 0 })),
  MeshStandardMaterial: jest.fn(() => ({})),
  STLLoader: jest.fn(() => ({
    parse: jest.fn(() => ({ computeVertexNormals: jest.fn() })),
  })),
  OBJLoader: jest.fn(() => ({
    parse: jest.fn(() => ({
      userData: {},
      position: { sub: jest.fn() },
      traverse: jest.fn((cb) => cb(new MockMesh())),
    })),
  })),
};

// ── DOM mocks ────────────────────────────────────────────────────────────────
let mutationObserverCallback = null;
let resizeObserverCallback = null;

globalThis.MutationObserver = jest.fn().mockImplementation((cb) => {
  mutationObserverCallback = cb;
  return { observe: jest.fn() };
});

globalThis.ResizeObserver = jest.fn().mockImplementation((cb) => {
  resizeObserverCallback = cb;
  return { observe: jest.fn() };
});

globalThis.requestAnimationFrame = jest.fn(); // prevent infinite animate loop

const mockViewerCanvas = { id: 'viewerCanvas', style: {} };
const mockViewerPanel = { id: 'viewerPanel', clientWidth: 800, clientHeight: 600 };
const mockViewerEmpty = { id: 'viewerEmpty', style: {} };

let nullifyViewerEmpty = false;
globalThis.document = {
  getElementById: jest.fn((id) => {
    if (id === 'viewerCanvas') return mockViewerCanvas;
    if (id === 'viewerPanel') return mockViewerPanel;
    if (id === 'viewerEmpty') return nullifyViewerEmpty ? null : mockViewerEmpty;
    return { id, className: '', classList: { add: jest.fn(), remove: jest.fn() }, style: {} };
  }),
  querySelectorAll: jest.fn(() => [{ classList: { add: jest.fn(), remove: jest.fn() } }]),
  documentElement: { style: {} },
};

globalThis.getComputedStyle = jest.fn(() => ({
  getPropertyValue: jest.fn(() => ' #1e1e2e '),
}));

globalThis.window = { devicePixelRatio: 2 };
globalThis.fetch = jest.fn();
globalThis.TextDecoder = TextDecoder;

// ── module under test ────────────────────────────────────────────────────────
const { viewerBgColor, initViewer, loadJobPreview } = require('../../static/features/viewer.js');

// ────────────────────────────────────────────────────────────────────────────
describe('viewerBgColor', () => {
  test('returns trimmed CSS custom property value', () => {
    const color = viewerBgColor();
    expect(color).toBe('#1e1e2e');
    expect(globalThis.getComputedStyle).toHaveBeenCalledWith(globalThis.document.documentElement);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('MutationObserver (theme change)', () => {
  test('callback does nothing when _viewer is null (before init)', () => {
    expect(() => mutationObserverCallback()).not.toThrow();
    expect(mockRenderer.setClearColor).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests 1–3 run in ORDER to share module-level _viewer state
describe('initViewer', () => {
  test('returns early when viewerEmpty element is null', () => {
    nullifyViewerEmpty = true;
    initViewer(); // _viewer stays null; early return
    expect(THREE.WebGLRenderer).not.toHaveBeenCalled();
    nullifyViewerEmpty = false;
  });

  test('initialises viewer with THREE components on first call', () => {
    initViewer();
    expect(THREE.WebGLRenderer).toHaveBeenCalledTimes(1);
    expect(THREE.Scene).toHaveBeenCalledTimes(1);
    expect(THREE.PerspectiveCamera).toHaveBeenCalledTimes(1);
    expect(THREE.OrbitControls).toHaveBeenCalledTimes(1);
    expect(mockRenderer.setPixelRatio).toHaveBeenCalled();
    expect(mockRenderer.setClearColor).toHaveBeenCalled();
    expect(mockScene.add).toHaveBeenCalled(); // lights added
    expect(globalThis.requestAnimationFrame).toHaveBeenCalled(); // animate IIFE ran
  });

  test('returns early on subsequent calls (_viewer already set)', () => {
    const prevCalls = THREE.WebGLRenderer.mock.calls.length;
    initViewer();
    expect(THREE.WebGLRenderer).toHaveBeenCalledTimes(prevCalls); // no new call
  });

  test('MutationObserver callback updates clearColor when _viewer is set', () => {
    jest.clearAllMocks();
    mutationObserverCallback();
    expect(mockRenderer.setClearColor).toHaveBeenCalled();
  });

  test('ResizeObserver callback resizes renderer when dimensions > 0', () => {
    jest.clearAllMocks();
    resizeObserverCallback();
    expect(mockRenderer.setSize).toHaveBeenCalledWith(800, 600);
    expect(mockCamera.updateProjectionMatrix).toHaveBeenCalled();
  });

  test('ResizeObserver callback does nothing when width/height are 0', () => {
    jest.clearAllMocks();
    const orig = { w: mockViewerPanel.clientWidth, h: mockViewerPanel.clientHeight };
    mockViewerPanel.clientWidth = 0;
    mockViewerPanel.clientHeight = 0;
    resizeObserverCallback();
    expect(mockRenderer.setSize).not.toHaveBeenCalled();
    mockViewerPanel.clientWidth = orig.w;
    mockViewerPanel.clientHeight = orig.h;
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('loadJobPreview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSceneChildren.splice(0);
  });

  test('removes preview-active from other cards and marks current card active', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false });
    await loadJobPreview('j1');
    expect(globalThis.document.querySelectorAll).toHaveBeenCalledWith('.job-card');
  });

  test('returns early when first fetch (job status) fails', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false });
    await loadJobPreview('j1');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test('loads and adds an STL mesh to the scene', async () => {
    const stlBuf = new ArrayBuffer(84 + 50);
    const v = new DataView(stlBuf);
    v.setUint32(80, 1, true);
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ filename: 'model.stl' }),
      })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: jest.fn().mockResolvedValue(stlBuf) });
    await loadJobPreview('j2');
    expect(mockScene.add).toHaveBeenCalled();
  });

  test('returns early when second fetch (mesh file) fails', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ filename: 'model.stl' }),
      })
      .mockResolvedValueOnce({ ok: false });
    await loadJobPreview('j3');
    expect(mockScene.add).not.toHaveBeenCalled();
  });

  test('loads and adds an OBJ mesh to the scene', async () => {
    const buf = new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n').buffer;
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ filename: 'model.obj' }),
      })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: jest.fn().mockResolvedValue(buf) });
    await loadJobPreview('j4');
    expect(mockScene.add).toHaveBeenCalled();
  });

  test('returns without loading for unknown file extension', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ filename: 'model.step' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
      });
    await loadJobPreview('j5');
    expect(mockScene.add).not.toHaveBeenCalled();
  });

  test('handles a missing filename gracefully (empty string fallback)', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({}) }) // no filename key
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
      });
    await loadJobPreview('j6');
    expect(mockScene.add).not.toHaveBeenCalled(); // empty ext → no loader
  });

  test('catches and logs errors thrown during mesh loading', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ filename: 'model.stl' }),
      })
      .mockRejectedValueOnce(new Error('Network error'));
    await expect(loadJobPreview('j7')).resolves.toBeUndefined();
  });

  test('disposes geometry and material of existing isMesh children', async () => {
    const existingMesh = new MockMesh();
    existingMesh.userData['isMesh'] = true;
    existingMesh.geometry = { dispose: jest.fn() };
    existingMesh.material = { dispose: jest.fn() };
    mockSceneChildren.push(existingMesh);

    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false });
    await loadJobPreview('j8');
    expect(mockScene.remove).toHaveBeenCalledWith(existingMesh);
    expect(existingMesh.geometry.dispose).toHaveBeenCalled();
  });

  test('disposes array of materials on isMesh children', async () => {
    const child = new MockMesh();
    child.userData['isMesh'] = true;
    const mat1 = { dispose: jest.fn() };
    const mat2 = { dispose: jest.fn() };
    child.material = [mat1, mat2];
    child.geometry = { dispose: jest.fn() };
    mockSceneChildren.push(child);

    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false });
    await loadJobPreview('j9');
    expect(mat1.dispose).toHaveBeenCalled();
    expect(mat2.dispose).toHaveBeenCalled();
  });
});
