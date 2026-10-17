import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { UNIT_DEFS, UNIT_KINDS, type UnitKind } from "@scorched-3d/core";
import { getUnitIconDataUrl } from "../renderer/selectionIcons";
import { buildStudioBody, disposeStudioObject, frameStudioBody, STUDY_VIEWS, type StudyView } from "./studio";

export default function UnitFolio() {
  const [kind, setKind] = useState<UnitKind>("stump");
  const [view, setView] = useState<StudyView>("perspective");
  const [turntable, setTurntable] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [error, setError] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const actions = useRef<{ frame(view: StudyView): void; wireframe(on: boolean): void } | null>(null);
  const rotating = useRef(turntable);
  rotating.current = turntable;
  const def = UNIT_DEFS[kind];

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    setError(false);
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { setError(true); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x20271c);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.autoRotateSpeed = 1;
    const body = buildStudioBody(kind);
    scene.add(body);
    const size = new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3()).length();
    const grid = new THREE.GridHelper(size * 2.8, 24, 0x7d8c5e, 0x39432f);
    grid.position.y = -0.1;
    scene.add(grid, new THREE.HemisphereLight(0xe7f1d7, 0x373227, 1.6));
    const sun = new THREE.DirectionalLight(0xffedcd, 2.6);
    sun.position.set(-50, 90, 60);
    const rim = new THREE.DirectionalLight(0xb9d8ff, 1.3);
    rim.position.set(50, 30, -50);
    scene.add(sun, rim);
    const frame = (study: StudyView) => {
      controls.target.copy(frameStudioBody(body, camera, study));
      controls.minDistance = size * 0.5;
      controls.maxDistance = size * 8;
      controls.update();
    };
    const setWire = (on: boolean) => body.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
        if ("wireframe" in mat) (mat as THREE.MeshLambertMaterial).wireframe = on;
      }
    });
    actions.current = { frame, wireframe: setWire };
    let aspect = 0;
    const resize = () => {
      const w = Math.max(element.clientWidth, 1), h = Math.max(element.clientHeight, 1);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // Initial frame and major layout changes must fit both portrait and landscape.
      if (Math.abs(camera.aspect - aspect) > 0.1) frame(view);
      aspect = camera.aspect;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    frame(view);
    setWire(wireframe);
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      controls.autoRotate = rotating.current;
      controls.update(dt);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      actions.current = null;
      disposeStudioObject(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
    // Study controls update the existing camera/materials; only a roster change rebuilds the model.
  }, [kind]);
  useEffect(() => { actions.current?.frame(view); }, [view]);
  useEffect(() => { actions.current?.wireframe(wireframe); }, [wireframe]);

  return <section className="unit-folio" aria-label="Unit folio">
    <aside className="folio-roster">
      <p className="folio-eyebrow">ARM / FIELD CATALOG</p><h1>Unit folio<span>05 DESIGNS / LIVE 3D</span></h1>
      <div className="folio-unit-list" aria-label="Unit roster">
        {UNIT_KINDS.map((unit, index) => <button key={unit} aria-pressed={kind === unit} onClick={() => setKind(unit)}>
          <span className="folio-number">0{index + 1}</span><img src={getUnitIconDataUrl(unit)} alt="" />
          <span><strong>{UNIT_DEFS[unit].name}</strong><small>{UNIT_DEFS[unit].unitName}</small></span><span aria-hidden="true">↗</span>
        </button>)}
      </div>
      <p className="folio-note">Battlefield suspended.<br />Return to resume command.</p>
    </aside>
    <div className="folio-stage">
      <div ref={host} className="folio-canvas" role="img" aria-label={`Interactive 3D model of ${def.name}`} />
      {error && <p className="folio-error" role="alert">3D preview unavailable. WebGL is required to inspect this model.</p>}
      <div className="folio-stage-heading"><span>MODEL STUDY / {def.unitName}</span><span>1:1 BATTLEFIELD GEOMETRY</span></div>
      <div className="folio-caption"><p className="folio-eyebrow">ARMORY / {String(UNIT_KINDS.indexOf(kind) + 1).padStart(2, "0")}</p><h2>{def.name}</h2><p>{def.blurb}</p></div>
      <div className="folio-study-controls" aria-label="Study angle">{STUDY_VIEWS.map((study) => <button key={study} aria-pressed={view === study} onClick={() => { setView(study); actions.current?.frame(study); }}>{study === "perspective" ? "3/4" : study}</button>)}</div>
    </div>
    <aside className="folio-inspector"><p className="folio-eyebrow">INSPECTION TOOLS</p><h2>Look closer.</h2><p>Drag to orbit.<br />Scroll or pinch to zoom.</p>
      <button aria-pressed={turntable} onClick={() => setTurntable(!turntable)}>Turntable <span>{turntable ? "ON" : "OFF"}</span></button>
      <button aria-pressed={wireframe} onClick={() => setWireframe(!wireframe)}>Wireframe <span>{wireframe ? "ON" : "OFF"}</span></button>
      <button onClick={() => actions.current?.frame(view)}>Reset camera <span>↺</span></button>
      <div className="folio-spec"><small>CATALOG ID</small><strong>{def.unitName}</strong><small>MODEL SOURCE</small><strong>Live battlefield asset</strong><small>STUDY</small><strong>Geometry & silhouette</strong></div>
    </aside>
  </section>;
}
