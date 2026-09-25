import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { WebGL } from "three/addons/capabilities/WebGL.js";

class BoxConfigurator {
  constructor(container) {
    this.container = container;
    this.loading = container.querySelector("#loading");
    this.state = {
      length: 200, width: 150, baseHeight: 80, lidHeight: 40,
      wallThickness: 2, overlap: 15, color: "#ffffff", finish: "matte", lidOpen: false
    };
    this.numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
    this.clock = new THREE.Clock();
    this.targetLidY = 0;
    this._resizeHandler = this.onWindowResize.bind(this);
    this._animate = this.animate.bind(this);
    this._listeners = [];
    this.init();
  }

  init() {
    if (!WebGL.isWebGLAvailable()) {
      this.showWebGLError();
      return;
    }
    try {
      this.initScene();
      this.initLights();
      this.initEnvironment();
      this.createBox();
      this.bindUI();
      this.updateBox();
      this.updateCalculations();
      this.onWindowResize();
      this.resetCamera();
      this.renderer.setAnimationLoop(this._animate);
      window.addEventListener("resize", this._resizeHandler);
      this._contextLostHandler = (event) => {
        event.preventDefault();
        this.renderer.setAnimationLoop(null);
        this.showError("The WebGL context was lost. Restore the tab or reload the page to resume the 3D view.");
      };
      this._contextRestoredHandler = () => window.location.reload();
      this.renderer.domElement.addEventListener("webglcontextlost", this._contextLostHandler, false);
      this.renderer.domElement.addEventListener("webglcontextrestored", this._contextRestoredHandler, false);
      this.loading?.classList.add("hidden");
    } catch (error) {
      console.error("Hardbox configurator initialization failed:", error);
      this.showError("The 3D scene could not be initialized.");
    }
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf5f5f5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0xf5f5f5, 1);
    this.renderer.domElement.setAttribute("aria-label", "Interactive 3D hardbox model");
    this.renderer.domElement.setAttribute("role", "img");
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.1;

    this.boxGroup = new THREE.Group();
    this.baseGroup = new THREE.Group();
    this.lidGroup = new THREE.Group();
    this.boxGroup.add(this.baseGroup, this.lidGroup);
    this.scene.add(this.boxGroup);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(1000, 96),
      new THREE.ShadowMaterial({ opacity: 0.2 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.01;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.grid = new THREE.GridHelper(1000, 20, 0xcccccc, 0xeeeeee);
    this.grid.position.y = 0.02;
    this.scene.add(this.grid);
  }

  initLights() {
    this.keyLight = new THREE.DirectionalLight(0xffffff, 3);
    this.keyLight.position.set(100, 200, 100);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 1000;
    this.keyLight.shadow.bias = -0.0001;
    this.keyLight.shadow.normalBias = 0.05;
    this.scene.add(this.keyLight);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));
  }

  initEnvironment() {
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    const environment = new RoomEnvironment(this.renderer);
    this.scene.environment = pmremGenerator.fromScene(environment).texture;
    environment.dispose();
    pmremGenerator.dispose();
  }

  createBox() {
    this.material = new THREE.MeshStandardMaterial({
      color: this.state.color,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
      envMapIntensity: 1
    });
    this.baseMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.lidMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.baseMesh.castShadow = this.baseMesh.receiveShadow = true;
    this.lidMesh.castShadow = this.lidMesh.receiveShadow = true;
    this.baseGroup.add(this.baseMesh);
    this.lidGroup.add(this.lidMesh);
  }

  roundedPart(w, h, d, x, y, z) {
    if (w <= 0 || h <= 0 || d <= 0) return null;
    const bevel = Math.min(0.5, w / 2 - 0.01, h / 2 - 0.01, d / 2 - 0.01);
    const geometry = new RoundedBoxGeometry(w, h, d, 2, Math.max(0.01, bevel));
    geometry.translate(x, y, z);
    return geometry;
  }

  mergeParts(parts) {
    const valid = parts.filter(Boolean);
    if (!valid.length) return new THREE.BufferGeometry();
    const merged = mergeGeometries(valid, false);
    valid.forEach((g) => g.dispose());
    return merged;
  }

  updateBox() {
    const { length: L, width: W, baseHeight: Hb, lidHeight: Hl, wallThickness: t, overlap: O } = this.state;
    const baseWallH = Math.max(0.01, Hb - t);
    const lidWallH = Math.max(0.01, Hl - t);
    const innerW = Math.max(0.01, W - 2 * t);

    const baseGeometry = this.mergeParts([
      this.roundedPart(L, t, W, 0, t / 2, 0),
      this.roundedPart(L, baseWallH, t, 0, (Hb + t) / 2, W / 2 - t / 2),
      this.roundedPart(L, baseWallH, t, 0, (Hb + t) / 2, -W / 2 + t / 2),
      this.roundedPart(t, baseWallH, innerW, -L / 2 + t / 2, (Hb + t) / 2, 0),
      this.roundedPart(t, baseWallH, innerW, L / 2 - t / 2, (Hb + t) / 2, 0)
    ]);

    const lidGeometry = this.mergeParts([
      this.roundedPart(L + 2 * t, t, W + 2 * t, 0, Hb - O + Hl - t / 2, 0),
      this.roundedPart(L + 2 * t, lidWallH, t, 0, Hb - O + lidWallH / 2, W / 2 + t / 2),
      this.roundedPart(L + 2 * t, lidWallH, t, 0, Hb - O + lidWallH / 2, -W / 2 - t / 2),
      this.roundedPart(t, lidWallH, W, -L / 2 - t / 2, Hb - O + lidWallH / 2, 0),
      this.roundedPart(t, lidWallH, W, L / 2 + t / 2, Hb - O + lidWallH / 2, 0)
    ]);

    const oldBase = this.baseMesh.geometry;
    const oldLid = this.lidMesh.geometry;
    this.baseMesh.geometry = baseGeometry;
    this.lidMesh.geometry = lidGeometry;
    oldBase.dispose();
    oldLid.dispose();

    this.applyFinish();
    this.updateCameraLimits();
    this.updateTarget(false);
    this.updateShadowBounds();
  }

  applyFinish() {
    const finishes = {
      matte: { roughness: 0.9, metalness: 0 },
      satin: { roughness: 0.5, metalness: 0 },
      glossy: { roughness: 0.1, metalness: 0 }
    };
    const finish = finishes[this.state.finish] || finishes.matte;
    this.material.color.set(this.state.color);
    this.material.roughness = finish.roughness;
    this.material.metalness = finish.metalness;
    this.material.needsUpdate = true;
  }

  updateShadowBounds() {
    const maxDim = this.getMaxDim();
    const extent = maxDim * 1.5;
    const shadowCamera = this.keyLight.shadow.camera;
    shadowCamera.left = -extent;
    shadowCamera.right = extent;
    shadowCamera.top = extent;
    shadowCamera.bottom = -extent;
    shadowCamera.updateProjectionMatrix();
  }

  updateCameraLimits() {
    const maxDim = this.getMaxDim();
    this.controls.minDistance = maxDim * 0.5;
    this.controls.maxDistance = maxDim * 5;
  }

  updateTarget(resetCamera = false) {
    const { baseHeight: Hb, lidHeight: Hl, overlap: O } = this.state;
    const targetY = (Hb + Hl - O) / 2;
    this.controls.target.set(0, targetY, 0);
    if (resetCamera) this.resetCamera();
    else this.controls.update();
  }

  getMaxDim() {
    const { length: L, width: W, baseHeight: Hb, lidHeight: Hl, overlap: O } = this.state;
    return Math.max(L, W, Hb + Hl - O);
  }

  resetCamera() {
    const maxDim = this.getMaxDim();
    const totalHeight = this.state.baseHeight + this.state.lidHeight - this.state.overlap;
    const target = new THREE.Vector3(0, totalHeight / 2, 0);
    this.camera.position.set(maxDim * 1.5, maxDim * 1.2, maxDim * 1.5);
    this.controls.target.copy(target);
    this.camera.near = 1;
    this.camera.far = Math.max(5000, maxDim * 10);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  updateCalculations() {
    const { length: L, width: W, baseHeight: Hb, lidHeight: Hl, wallThickness: t, overlap: O } = this.state;
    const totalH = Hb + Hl - O;
    const innerL = Math.max(0, L - 2 * t);
    const innerW = Math.max(0, W - 2 * t);
    const innerH = Math.max(0, Hb - t + Hl - t - O);
    const outerVolume = (L * W * totalH) / 1000;
    const innerVolume = (innerL * innerW * innerH) / 1000;
    const surfaceArea = (2 * (L * W + L * totalH + W * totalH)) / 100;

    this.setText("outer-dimensions", this.dim(L) + " × " + this.dim(W) + " × " + this.dim(totalH));
    this.setText("inner-dimensions", this.dim(innerL) + " × " + this.dim(innerW) + " × " + this.dim(innerH));
    this.setText("outer-volume", this.numberFormat.format(outerVolume) + " cm³");
    this.setText("inner-volume", this.numberFormat.format(innerVolume) + " cm³");
    this.setText("surface-area", this.numberFormat.format(surfaceArea) + " cm²");
  }

  dim(value) {
    return this.numberFormat.format(value) + " mm";
  }

  setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  bindUI() {
    const sliderIds = ["length", "width", "baseHeight", "lidHeight", "wallThickness", "overlap"];
    sliderIds.forEach((id) => {
      const input = document.getElementById(id);
      const output = document.getElementById(id + "-value");
      const handler = () => {
        this.state[id] = Number(input.value);
        output.textContent = input.value;
        this.updateBox();
        this.updateCalculations();
      };
      input.addEventListener("input", handler);
      this._listeners.push(() => input.removeEventListener("input", handler));
    });

    const color = document.getElementById("color");
    const colorHandler = () => { this.state.color = color.value; this.applyFinish(); };
    color.addEventListener("input", colorHandler);
    this._listeners.push(() => color.removeEventListener("input", colorHandler));

    const finish = document.getElementById("finish");
    const finishHandler = () => { this.state.finish = finish.value; this.applyFinish(); };
    finish.addEventListener("change", finishHandler);
    this._listeners.push(() => finish.removeEventListener("change", finishHandler));

    const toggle = document.getElementById("toggle-lid");
    const toggleHandler = () => {
      this.state.lidOpen = !this.state.lidOpen;
      this.targetLidY = this.state.lidOpen ? 100 : 0;
      toggle.textContent = this.state.lidOpen ? "Close Lid" : "Open Lid";
    };
    toggle.addEventListener("click", toggleHandler);
    this._listeners.push(() => toggle.removeEventListener("click", toggleHandler));

    const reset = document.getElementById("reset-camera");
    const resetHandler = () => this.resetCamera();
    reset.addEventListener("click", resetHandler);
    this._listeners.push(() => reset.removeEventListener("click", resetHandler));
  }

  animate() {
    const delta = this.clock.getDelta();
    void delta;
    if (!this.lidGroup) return;
    this.lidGroup.position.y = THREE.MathUtils.lerp(this.lidGroup.position.y, this.targetLidY, 0.1);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  onWindowResize() {
    if (!this.renderer) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  showWebGLError() {
    if (this.loading) this.loading.remove();
    this.container.innerHTML = '<div class="webgl-error"><h2>WebGL unavailable</h2><p>Your browser does not support WebGL. Please enable hardware acceleration or use a modern browser.</p></div>';
  }

  showError(message) {
    if (this.loading) this.loading.remove();
    this.container.innerHTML = '<div class="webgl-error"><h2>3D view unavailable</h2><p>' + message + '</p></div>';
  }

  dispose() {
    window.removeEventListener("resize", this._resizeHandler);
    this._listeners.forEach((remove) => remove());
    this.renderer?.setAnimationLoop(null);
    if (this.renderer?.domElement) {
      this.renderer.domElement.removeEventListener("webglcontextlost", this._contextLostHandler);
      this.renderer.domElement.removeEventListener("webglcontextrestored", this._contextRestoredHandler);
    }
    this.controls?.dispose();
    this.scene?.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
    });
    this.material?.dispose();
    this.scene?.environment?.dispose?.();
    this.renderer?.dispose();
  }
}

window.boxConfigurator = new BoxConfigurator(document.getElementById("viewport"));
