interface ThreeVector3 {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): this;
  sub(v: ThreeVector3): this;
  copy(v: ThreeVector3): this;
}

interface ThreeBox3 {
  setFromObject(object: ThreeObject3D): this;
  getCenter(target: ThreeVector3): ThreeVector3;
  getSize(target: ThreeVector3): ThreeVector3;
}

interface ThreeBufferGeometry {
  dispose(): void;
  computeVertexNormals(): void;
}

interface ThreeMaterial {
  dispose(): void;
}

interface ThreeObject3D {
  position: ThreeVector3;
  userData: Record<string, unknown>;
  children: ThreeObject3D[];
  add(...objects: ThreeObject3D[]): this;
  remove(...objects: ThreeObject3D[]): this;
  traverse(callback: (object: ThreeObject3D) => void): void;
}

interface ThreeMesh extends ThreeObject3D {
  geometry: ThreeBufferGeometry;
  material: ThreeMaterial | ThreeMaterial[];
}

interface ThreeGroup extends ThreeObject3D {}

interface ThreeCamera extends ThreeObject3D {
  near: number;
  far: number;
  updateProjectionMatrix(): void;
}

interface ThreePerspectiveCamera extends ThreeCamera {
  fov: number;
  aspect: number;
}

interface ThreeLight extends ThreeObject3D {}

interface ThreeWebGLRenderer {
  domElement: HTMLCanvasElement;
  outputEncoding: number;
  setPixelRatio(value: number): void;
  setClearColor(color: number): void;
  setSize(width: number, height: number): void;
  render(scene: ThreeObject3D, camera: ThreeCamera): void;
}

interface ThreeOrbitControls {
  target: ThreeVector3;
  enableDamping: boolean;
  dampingFactor: number;
  screenSpacePanning: boolean;
  minDistance: number;
  maxDistance: number;
  update(): void;
}

declare const THREE: {
  sRGBEncoding: number;
  Vector3: new (x?: number, y?: number, z?: number) => ThreeVector3;
  Box3: new () => ThreeBox3;
  Scene: new () => ThreeObject3D;
  AmbientLight: new (color?: number, intensity?: number) => ThreeLight;
  DirectionalLight: new (color?: number, intensity?: number) => ThreeLight;
  PerspectiveCamera: new (
    fov?: number,
    aspect?: number,
    near?: number,
    far?: number
  ) => ThreePerspectiveCamera;
  MeshStandardMaterial: new (params?: {
    color?: number;
    metalness?: number;
    roughness?: number;
  }) => ThreeMaterial;
  Mesh: {
    new (geometry?: ThreeBufferGeometry, material?: ThreeMaterial): ThreeMesh;
    readonly prototype: ThreeMesh;
  };
  WebGLRenderer: new (params?: {
    canvas?: HTMLCanvasElement;
    antialias?: boolean;
  }) => ThreeWebGLRenderer;
  OrbitControls: new (camera: ThreeCamera, domElement: HTMLElement) => ThreeOrbitControls;
  STLLoader: new () => { parse(data: ArrayBuffer): ThreeBufferGeometry };
  OBJLoader: new () => { parse(text: string): ThreeGroup };
};
