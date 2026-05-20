interface Job {
  id: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled';
  log: string[];
  outputs: string[];
  filename?: string;
}

interface SseMessage {
  type: string;
  job?: Job;
}

interface Viewer {
  renderer: ThreeWebGLRenderer;
  scene: ThreeObject3D;
  camera: ThreePerspectiveCamera;
  controls: ThreeOrbitControls;
  empty: HTMLElement;
}

interface Triangle {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  cx: number;
  cy: number;
  z: number;
  d: number;
}
