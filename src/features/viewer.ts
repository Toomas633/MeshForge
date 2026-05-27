let _viewer: Viewer | null = null;
let _activePreviewJobId: string | null = null;

function viewerBgColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--viewer-bg').trim();
}

new MutationObserver(() => {
  if (_viewer)
    _viewer.renderer.setClearColor(Number.parseInt(viewerBgColor().replace('#', ''), 16));
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

function initViewer(): void {
  if (_viewer) return;
  const canvas = document.getElementById('viewerCanvas') as HTMLCanvasElement;
  const panel = document.getElementById('viewerPanel') as HTMLDivElement;
  const empty = document.getElementById('viewerEmpty');
  if (!empty) return;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(Number.parseInt(viewerBgColor().replace('#', ''), 16));
  renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  const w = panel.clientWidth || 1;
  const h = panel.clientHeight || 1;
  const camera = new THREE.PerspectiveCamera(45, w / h, 0.001, 100000);
  camera.position.set(0, 0, 5);

  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(1, 2, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x6688cc, 0.35);
  fill.position.set(-2, -1, -2);
  scene.add(fill);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.screenSpacePanning = true;
  controls.minDistance = 0;
  controls.maxDistance = Infinity;

  renderer.setSize(w, h);

  const ro = new ResizeObserver(() => {
    const w2 = panel.clientWidth;
    const h2 = panel.clientHeight;
    if (w2 > 0 && h2 > 0) {
      renderer.setSize(w2, h2);
      camera.aspect = w2 / h2;
      camera.updateProjectionMatrix();
    }
  });
  ro.observe(panel);

  (function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  })();

  _viewer = { renderer, scene, camera, controls, empty };
}

async function loadJobPreview(jobId: string): Promise<void> {
  document.querySelectorAll('.job-card').forEach((c) => c.classList.remove('preview-active'));
  const card = document.getElementById(`job-${jobId}`);
  if (card) card.classList.add('preview-active');
  _activePreviewJobId = jobId;

  initViewer();
  const { scene, camera, controls, empty, renderer } = _viewer!;

  empty.style.display = 'none';
  renderer.domElement.style.display = 'block';

  scene.children
    .filter((c) => c.userData['isMesh'])
    .forEach((c) => {
      scene.remove(c);
      c.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => m.dispose());
        }
      });
    });

  const jobRes = await fetch(`/api/jobs/${jobId}`);
  if (!jobRes.ok) return;
  const job = (await jobRes.json()) as Job;
  const filename = job.filename ?? '';
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();

  try {
    const meshRes = await fetch(`/api/jobs/${jobId}/input-file`);
    if (!meshRes.ok) return;
    const buf = await meshRes.arrayBuffer();

    const mat = new THREE.MeshStandardMaterial({
      color: 0x4f7cff,
      metalness: 0.2,
      roughness: 0.55,
    });

    let meshObj: ThreeObject3D | null = null;
    if (ext === '.stl') {
      const geom = new THREE.STLLoader().parse(buf);
      geom.computeVertexNormals();
      meshObj = new THREE.Mesh(geom, mat);
    } else if (ext === '.obj') {
      meshObj = new THREE.OBJLoader().parse(new TextDecoder().decode(buf));
      meshObj.traverse((child) => {
        if (child instanceof THREE.Mesh) child.material = mat;
      });
    } else {
      return;
    }

    meshObj.userData['isMesh'] = true;

    const box = new THREE.Box3().setFromObject(meshObj);
    const center = box.getCenter(new THREE.Vector3());
    meshObj.position.sub(center);
    scene.add(meshObj);

    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const fov = camera.fov * (Math.PI / 180);
    const dist = (maxDim / 2 / Math.tan(fov / 2)) * 1.75;
    camera.position.set(dist * 0.65, dist * 0.45, dist);
    camera.near = dist * 0.001;
    camera.far = dist * 100;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
  } catch (err) {
    console.error('Preview load error:', err);
  }
}
