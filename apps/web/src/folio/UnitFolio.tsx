import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { UNIT_DEFS, UNIT_KINDS, type UnitKind } from "@scorched-3d/core";
import { buildPreviewTerrain } from "./preview";
import { DEFAULT_INSPECTION, applyStudyLighting, type Livery } from "./settings";
import { getUnitIconDataUrl } from "../renderer/selectionIcons";
import { disposeStudioObject, frameStudioBody, STUDY_VIEWS, type StudyView } from "./studio";
import { buildStudySubject, disposeStudySubject, type StudySubject } from "./subject";

export default function UnitFolio() {
  const [kind, setKind] = useState<UnitKind>("stump");
  const [view, setView] = useState<StudyView>("rts");
  const [inspection, setInspection] = useState({ ...DEFAULT_INSPECTION });
  const [turntable, setTurntable] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [terrain, setTerrain] = useState(true);
  const [motion, setMotion] = useState(false);
  const [shooting, setShooting] = useState(false);
  const [selection, setSelection] = useState(false);
  const preview = useRef({ terrain, motion, shooting, selection, inspection, wireframe });
  preview.current = { terrain, motion, shooting, selection, inspection, wireframe };
  const [error, setError] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const actions = useRef<{ frame(view: StudyView): void; wireframe(on: boolean): void; swap(kind: UnitKind, view: StudyView): void } | null>(null);
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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    // The roster effect swaps this per kind; renderer/scene/terrain persist.
    let subject: StudySubject | null = null;
    // Shared with swap: a fresh subject must apply finishes on its first frame.
    const applied: { lastSettings: typeof inspection | undefined; lastWire: boolean | undefined; lastTerrain: boolean | undefined } = { lastSettings: undefined, lastWire: undefined, lastTerrain: undefined };
    const field = buildPreviewTerrain();
    scene.add(field);
    const hemi = new THREE.HemisphereLight(0xdbe7cf, 0x34372c, 0.85);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffedcd, 1.8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, far: 250 });
    sun.shadow.normalBias = 0.15;
    sun.position.set(-35, 65, 40);
    const rim = new THREE.DirectionalLight(0xb9d8ff, 0.8);
    rim.position.set(50, 30, -50);
    scene.add(sun, rim);
    const frame = (study: StudyView) => {
      const current = subject;
      if (!current) return;
      controls.target.copy(frameStudioBody(current.body, camera, study));
      controls.minDistance = current.size * 0.5;
      controls.maxDistance = current.size * 8;
      controls.update();
    };
    const setWire = (on: boolean) => subject?.body.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
        if ("wireframe" in mat) (mat as THREE.MeshLambertMaterial).wireframe = on;
      }
    });
    // Roster switch: retire only the previous subject, then frame the new one.
    const swap = (next: UnitKind, study: StudyView) => {
      if (subject) {
        scene.remove(subject.root);
        disposeStudySubject(subject);
      }
      subject = buildStudySubject(next);
      scene.add(subject.root);
      applied.lastSettings = applied.lastWire = applied.lastTerrain = undefined;
      setWire(preview.current.wireframe);
      frame(study);
    };
    actions.current = { frame, wireframe: setWire, swap };
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
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      field.visible = preview.current.terrain;
      const sub = subject;
      if (sub) {
        sub.grid.visible = !preview.current.terrain;
        const current = preview.current;
        const comparing = sub.kind === "stump" && current.inspection.legacy;
        sub.body.visible = !comparing;
        sub.legacy.visible = comparing;
        // Update finishes only when controls change, not on every animation frame.
        if (applied.lastSettings !== current.inspection || applied.lastWire !== current.wireframe || applied.lastTerrain !== current.terrain) {
          sub.model.update(current.inspection, current.wireframe);
          sub.legacyModel.update(current.inspection, current.wireframe);
          renderer.toneMappingExposure = applyStudyLighting(scene, sun, hemi, rim, current.terrain, current.inspection.night);
          applied.lastSettings = current.inspection; applied.lastWire = current.wireframe; applied.lastTerrain = current.terrain;
        }
        const live = !current.inspection.wreck && !comparing;
        sub.animation.update(dt, current.motion && live, current.shooting && live, current.selection && !current.inspection.wreck);
      }
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
      subject = null;
      disposeStudioObject(scene);
      sun.shadow.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
    // Renderer, scene, and terrain persist for the visit; the roster effect below swaps subjects.
  }, []);
  // Roster switches swap only the study subject and reframe it; nothing else rebuilds.
  useEffect(() => { actions.current?.swap(kind, view); }, [kind]);
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
      <div className="folio-stage-heading"><span>MODEL STUDY / {def.unitName}</span><span>{kind === "stump" && inspection.legacy ? "ORIGINAL MODEL / COMPARISON" : "1:1 BATTLEFIELD GEOMETRY"}</span></div>
      <div className="folio-caption"><p className="folio-eyebrow">ARMORY / {String(UNIT_KINDS.indexOf(kind) + 1).padStart(2, "0")}</p><h2>{def.name}</h2><p>{def.blurb}</p></div>
      <div className="folio-study-controls" aria-label="Study angle">{STUDY_VIEWS.map((study) => <button key={study} aria-pressed={view === study} onClick={() => { setView(study); actions.current?.frame(study); }}>{study === "perspective" ? "3/4" : study === "rts" ? "Gameplay" : study}</button>)}</div>
    </div>
    <aside className="folio-inspector"><p className="folio-eyebrow">INSPECTION TOOLS</p><h2>Look closer.</h2><p>Drag to orbit.<br />Scroll or pinch to zoom.</p>
      <button aria-pressed={terrain} onClick={() => setTerrain(!terrain)}>Terrain <span>{terrain ? "ON" : "OFF"}</span></button>
      <button disabled={inspection.wreck || (kind === "stump" && inspection.legacy)} aria-pressed={motion} onClick={() => setMotion(!motion)}>Motion <span>{motion ? "ON" : "OFF"}</span></button>
      <button disabled={inspection.wreck || (kind === "stump" && inspection.legacy)} aria-pressed={shooting} onClick={() => setShooting(!shooting)}>Shooting <span>{shooting ? "ON" : "OFF"}</span></button>
      <button aria-pressed={selection} onClick={() => setSelection(!selection)}>Selection ring <span>{selection ? "ON" : "OFF"}</span></button>
      <button aria-pressed={turntable} onClick={() => setTurntable(!turntable)}>Turntable <span>{turntable ? "ON" : "OFF"}</span></button>
      <button aria-pressed={wireframe} onClick={() => setWireframe(!wireframe)}>Wireframe <span>{wireframe ? "ON" : "OFF"}</span></button>
      <button aria-pressed={inspection.night} onClick={() => setInspection({ ...inspection, night: !inspection.night })}>Night lighting <span>{inspection.night ? "ON" : "OFF"}</span></button>
      <label className="folio-setting">Livery<select value={inspection.livery} onChange={(e) => setInspection({ ...inspection, livery: e.target.value as Livery })}><option value="olive">Field olive</option><option value="sand">Desert sand</option><option value="arctic">Arctic ash</option></select></label>
      <label className="folio-setting">Turret traverse <output>{inspection.turret}°</output><input type="range" min="-75" max="75" value={inspection.turret} onChange={(e) => setInspection({ ...inspection, turret: +e.target.value })} /></label>
      <label className="folio-setting">Barrel elevation <output>{inspection.elevation}°</output><input type="range" min="-8" max="83" disabled={kind === "commander" || (kind === "stump" && inspection.legacy)} value={inspection.elevation} onChange={(e) => setInspection({ ...inspection, elevation: +e.target.value })} /></label>
      <label className="folio-setting">Battle damage <output>{inspection.damage}%</output><input type="range" min="0" max="100" value={inspection.damage} onChange={(e) => setInspection({ ...inspection, damage: +e.target.value })} /></label>
      <button aria-pressed={inspection.wreck} onClick={() => setInspection({ ...inspection, wreck: !inspection.wreck })}>Destroyed / wreck pose <span>{inspection.wreck ? "ON" : "OFF"}</span></button>
      <button disabled={kind !== "stump"} title="Original Stumpy model from Unit Workshop" aria-pressed={kind === "stump" && inspection.legacy} onClick={() => setInspection({ ...inspection, legacy: !inspection.legacy })}>Original model comparison <span>{kind === "stump" && inspection.legacy ? "ON" : "OFF"}</span></button>
      <button onClick={() => { setInspection({ ...DEFAULT_INSPECTION }); setTerrain(true); setView("rts"); setMotion(false); setShooting(false); setSelection(false); setTurntable(false); setWireframe(false); actions.current?.frame("rts"); }}>Restore study defaults <span>↺</span></button>
      <button onClick={() => actions.current?.frame(view)}>Reset camera <span>↺</span></button>
      <div className="folio-spec"><small>CATALOG ID</small><strong>{def.unitName}</strong><small>MODEL SOURCE</small><strong>{kind === "stump" && inspection.legacy ? "Original Stumpy comparison" : "Live battlefield asset"}</strong><small>STUDY</small><strong>Terrain & animation</strong></div>
    </aside>
  </section>;
}
