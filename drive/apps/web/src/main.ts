import '@fontsource/shrikhand/latin-400.css';
import '@fontsource/rubik/latin-400.css';
import '@fontsource/rubik/latin-500.css';
import '@fontsource/rubik/latin-600.css';
import '@fontsource/rubik/latin-700.css';
import '@fontsource/rubik/latin-800.css';
import './ui/theme.css';
import { ACESFilmicToneMapping, PerspectiveCamera, Quaternion, RenderPipeline, Scene, Vector3, WebGPURenderer } from 'three/webgpu';
import { fog, normalWorldGeometry, pass, positionWorldDirection, rangeFogFactor } from 'three/tsl';
import { CartAudio } from './audio/cartAudio';
import { ChaseCamera } from './camera/chase';
import { InputManager } from './core/input';
import { FixedStepper } from './core/loop';
import { readSettings, type ViewBookmark } from './core/settings';
import { Simulation } from './core/sim';
import { ColliderView } from './debug/colliderView';
import { TuningPanel } from './debug/tuningPanel';
import { WaterPanel } from './debug/waterPanel';
import { envConfig } from './env/envConfig';
import { addLights } from './env/lights';
import { createHoleFlags } from './env/holeFlags';
import { createTeeSigns } from './env/teeSigns';
import { createTrees } from './env/trees';
import { skyColor, waterUniforms } from './env/oceanWaves';
import { createWater } from './env/water';
import { Particles } from './fx/particles';
import { SkidMarks } from './fx/skidMarks';
import { httpReader, loadLevel } from './level/loadLevel';
import { MODES, nextMode, type ModeName } from './modes/modes';
import { FIXED_DT, physicsConfig } from './physics/physicsConfig';
import { createTerrainMeshes } from './terrain/chunks';
import { createHorizonMesh } from './terrain/horizon';
import { createTerrainMaterial, createTerrainWireframeMaterial } from './terrain/terrainMaterial';
import { Hud } from './ui/hud';
import { MenuFlow } from './ui/menuFlow';
import { Menus } from './ui/menus';
import { FrameStats } from './ui/stats';
import { CartView } from './vehicle/CartView';
import type { CartTuning } from './vehicle/cartTuning';
import type { Vec3, WheelState } from './vehicle/VehicleModel';

/** Read-only handle for smoke tests and the console. */
interface GcsHandle {
  ready: boolean;
  error?: string;
  backend?: string;
  levelId?: string;
  frames: number;
  speed(): number;
  position(): Vec3;
  wheels(): WheelState[];
  mode(): ModeName;
  setMode(name: ModeName): void;
  /** Reset at a qa pose and roll forward at a speed (smoke test). */
  launch(pose: 'driveStart' | 'waterEntry', speed: number): void;
  /** Skid quads laid and particles emitted so far. */
  fx(): { skids: number; particles: number };
  /** Mean water depth under the wheels, m. */
  water(): number;
  /** Which menu screen is up ('play' while driving). */
  screen(): string;
  stats(): { fps: number; frameMs: number; physicsMs: number; drawCalls: number; triangles: number };
}

declare global {
  interface Window {
    __gcs?: GcsHandle;
  }
}

async function main(): Promise<void> {
  // VITE_DEFAULT_QUERY bakes flags into a build for hosts that drop the query string (review links).
  const settings = readSettings(location.search || (import.meta.env.VITE_DEFAULT_QUERY ?? ''));
  const hudRoot = document.getElementById('hud')!;
  hudRoot.hidden = true;
  // The menus come up at once and cover the course load; Tee Off waits until it is ready.
  let onPlay: (ride: ModeName) => void = () => {};
  const flow = new MenuFlow(settings.mode, settings.menu, (ride) => onPlay(ride));
  const menus = new Menus(document.body, flow, settings.home);
  const handle: GcsHandle = {
    ready: false,
    frames: 0,
    speed: () => 0,
    position: () => ({ x: 0, y: 0, z: 0 }),
    wheels: () => [],
    mode: () => 'chill',
    setMode: () => {},
    launch: () => {},
    fx: () => ({ skids: 0, particles: 0 }),
    water: () => 0,
    screen: () => flow.screen,
    stats: () => ({ fps: 0, frameMs: 0, physicsMs: 0, drawCalls: 0, triangles: 0 }),
  };
  window.__gcs = handle;

  try {
    const level = await loadLevel(httpReader(`${import.meta.env.BASE_URL}levels/${settings.levelId}/`));
    const sim = await Simulation.create(level, settings.mode);

    const renderer = new WebGPURenderer({ antialias: true, forceWebGL: settings.forceWebGL });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, envConfig.maxPixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = envConfig.exposure;
    renderer.info.autoReset = false;
    document.getElementById('app')!.appendChild(renderer.domElement);
    await renderer.init();
    const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';

    const scene = new Scene();
    // The water shader's sky, so reflections match what is overhead; distant ground fades into it.
    scene.backgroundNode = skyColor(normalWorldGeometry).mul(waterUniforms.exposure);
    scene.fogNode = fog(
      skyColor(positionWorldDirection).mul(waterUniforms.exposure),
      rangeFogFactor(envConfig.fog.near, envConfig.fog.far),
    );
    addLights(scene);
    const terrainMaterial = createTerrainMaterial();
    scene.add(createTerrainMeshes(level, terrainMaterial));
    const horizon = createHorizonMesh(level, terrainMaterial);
    if (horizon) scene.add(horizon);
    scene.add(createWater(level));
    scene.add(createTrees(level, sim.heights));
    // A flag on every pin and a sign at every tee. Their faces fill in once fonts and the logo load.
    const holeFlags = createHoleFlags(level.holes.holes, sim.heights);
    const teeSigns = createTeeSigns(level.holes.holes, level.paths.paths, sim.heights, sim.paths);
    scene.add(holeFlags.group, teeSigns.group);
    void holeFlags.paintFaces();
    void teeSigns.paintFaces();
    // Free drive loads one level per page, so leaving the page is the level's teardown.
    window.addEventListener(
      'pagehide',
      () => {
        holeFlags.dispose();
        teeSigns.dispose();
      },
      { once: true },
    );
    if (settings.debug) scene.add(createTerrainMeshes(level, createTerrainWireframeMaterial()));

    const cart = sim.cart;
    const cartView = new CartView(cart.tuning, cart.mounts);
    if (settings.paint) cartView.setPaint(settings.paint.canopy, settings.paint.shirt);
    scene.add(cartView.root);
    const colliderView = settings.debug ? new ColliderView(cart.tuning, sim.heights) : null;
    if (colliderView) {
      cartView.root.add(colliderView.chassis);
      scene.add(colliderView.world);
    }

    const chase = new ChaseCamera(sim.mode.chase);
    const camera = new PerspectiveCamera(chase.fovDeg, window.innerWidth / window.innerHeight, chase.settings.near, chase.settings.far);
    const ground = (x: number, z: number) => sim.heights.heightAt(x, z);
    chase.snap(cart.position(), cart.forward(), ground);

    const view = settings.view ? viewPose(settings.view, ground) : null;

    const pipeline = new RenderPipeline(renderer, pass(scene, camera));
    const input = new InputManager(window);
    const stepper = new FixedStepper(FIXED_DT, physicsConfig.maxSubsteps);
    const stats = new FrameStats();
    const hud = new Hud(hudRoot, backend, settings.debug);
    const audio = new CartAudio(window);
    const particles = new Particles();
    scene.add(particles.mesh);
    let skids = new SkidMarks(sim.mode.skids);
    scene.add(skids.mesh);

    // Tuning-panel edits per mode; mode switches keep them for the session.
    const tuned: Partial<Record<ModeName, CartTuning>> = {};
    const panel = settings.tune
      ? new TuningPanel((mode, t) => {
          tuned[mode] = t;
          if (sim.mode.name === mode) sim.setMode(mode, t);
        })
      : null;
    panel?.show(sim.mode.name, sim.cart.tuning);
    if (settings.tune) new WaterPanel();

    const setMode = (name: ModeName) => {
      if (name === sim.mode.name) return;
      sim.setMode(name, tuned[name] ?? MODES[name].cart);
      chase.setSettings(sim.mode.chase);
      // Skid persistence differs per mode, so start a fresh ribbon buffer.
      scene.remove(skids.mesh);
      skids.dispose();
      skids = new SkidMarks(sim.mode.skids);
      scene.add(skids.mesh);
      panel?.show(name, sim.cart.tuning);
      flow.pick(name);
    };

    // Physics poses before and after the latest step, for render interpolation.
    const prevPos = new Vector3();
    const prevRot = new Quaternion();
    const curPos = new Vector3();
    const curRot = new Quaternion();
    const drawPos = new Vector3();
    const drawRot = new Quaternion();
    const capture = () => {
      prevPos.copy(curPos);
      prevRot.copy(curRot);
      const p = cart.position();
      const q = cart.quaternion();
      curPos.set(p.x, p.y, p.z);
      curRot.set(q.x, q.y, q.z, q.w);
    };
    capture();
    capture();
    const snapAll = () => {
      stepper.reset();
      capture();
      capture();
      chase.snap(cart.position(), cart.forward(), ground);
    };
    let wasWet = false;

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    let last = performance.now();
    onPlay = (ride) => {
      setMode(ride);
      hud.setVisible(true);
      hud.showKeys();
      stepper.reset();
      last = performance.now();
    };
    renderer.setAnimationLoop(() => {
      const now = performance.now();
      if (menus.visible) {
        // Paused under a menu: no physics, no 3D frame (the menu covers the whole window).
        hud.setVisible(false);
        last = now;
        return;
      }
      menus.pollPauseButton();
      const frameMs = now - last;
      // Cap the simulated time per frame; the stats still report the real frame time.
      const frameSeconds = Math.min(frameMs / 1000, 0.25);
      last = now;
      renderer.info.reset();

      const controls = input.poll();
      if (controls.mode) setMode(nextMode(sim.mode.name));
      if (controls.reset) {
        sim.reset();
        snapAll();
      }
      const steps = stepper.advance(frameSeconds);
      let physicsMs = 0;
      let landing = 0;
      let respawned = false;
      for (let i = 0; i < steps; i++) {
        sim.step(controls);
        physicsMs += sim.lastStepMs;
        landing = Math.max(landing, cart.events.landing ?? 0);
        respawned ||= sim.respawned;
        holeFlags.step(FIXED_DT, cart.position(), cart.body.linvel());
        capture();
      }
      if (respawned) snapAll();

      // Effects and audio react to the latest physics state.
      const dynamics = cart.dynamics();
      const wet = cart.waterState().depth > 0;
      if (wet && !wasWet) {
        audio.splash(Math.abs(cart.forwardSpeed()));
        const p = cart.position();
        particles.burst('spray', { x: p.x, y: cart.waterState().level ?? p.y, z: p.z }, 40, Math.abs(cart.forwardSpeed()));
      }
      wasWet = wet;
      if (landing > 0) {
        chase.addShake(landing);
        audio.thump(landing);
      }
      skids.update(frameSeconds, dynamics);
      particles.update(frameSeconds, dynamics, cart.body.linvel());
      audio.update({ speed: cart.forwardSpeed(), throttle: controls.throttle, wheels: dynamics });

      drawPos.lerpVectors(prevPos, curPos, stepper.alpha);
      drawRot.slerpQuaternions(prevRot, curRot, stepper.alpha);
      const wheels = cart.wheels();
      cartView.update(drawPos, drawRot, wheels);
      holeFlags.update();
      colliderView?.update(cart);
      const idle =
        controls.throttle === 0 && controls.brake === 0 && controls.steer === 0 && Math.abs(cart.forwardSpeed()) < 0.2;
      chase.update(frameSeconds, drawPos, cart.forward(), ground, { speed: cart.forwardSpeed(), idle });
      if (view) {
        camera.position.copy(view.position);
        camera.lookAt(view.target);
      } else {
        camera.position.set(chase.position.x, chase.position.y, chase.position.z);
        camera.lookAt(chase.target.x, chase.target.y, chase.target.z);
      }
      if (Math.abs(camera.fov - chase.fovDeg) > 0.01) {
        camera.fov = chase.fovDeg;
        camera.updateProjectionMatrix();
      }

      pipeline.render();
      stats.frame(now, frameMs, physicsMs, renderer.info.render.drawCalls, renderer.info.render.triangles);
      hud.update(frameSeconds, cart.forwardSpeed(), wheels, stats, {
        modeLabel: sim.mode.label,
        modeName: sim.mode.name,
        boost: cart.tuning.boost.enabled ? cart.boostMeter() : null,
        resetOffered: cart.resetSuggested(),
      });
      handle.frames++;
    });

    Object.assign(handle, {
      ready: true,
      backend,
      levelId: settings.levelId,
      speed: () => cart.forwardSpeed(),
      position: () => ({ ...cart.position() }),
      wheels: () => cart.wheels(),
      mode: () => sim.mode.name,
      setMode,
      launch: (pose: 'driveStart' | 'waterEntry', speed: number) => {
        const p = level.course.qa[pose];
        if (!p) throw new Error(`level has no qa.${pose}`);
        sim.launch(p, speed);
        snapAll();
      },
      fx: () => ({ skids: skids.laid, particles: particles.total }),
      water: () => cart.waterState().depth,
      stats: () => ({
        fps: stats.fps,
        frameMs: stats.frameMs,
        physicsMs: stats.physicsMs,
        drawCalls: stats.drawCalls,
        triangles: stats.triangles,
      }),
    });
    flow.setReady();
    console.info(`GolfCartSimulator: ${level.course.name} on ${backend}`);
  } catch (err) {
    const message = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
    handle.error = message;
    menus.hide();
    Hud.showError(hudRoot, message);
    console.error(err);
  }
}

/** World camera position and look target for a ?view bookmark. Compass heading: 0 = north (-Z), 90 = east (+X). */
function viewPose(v: ViewBookmark, ground: (x: number, z: number) => number): { position: Vector3; target: Vector3 } {
  const h = (v.headingDeg * Math.PI) / 180;
  const p = (v.pitchDeg * Math.PI) / 180;
  const position = new Vector3(v.x, ground(v.x, v.z) + v.height, v.z);
  const dir = new Vector3(Math.sin(h) * Math.cos(p), Math.sin(p), -Math.cos(h) * Math.cos(p));
  return { position, target: position.clone().add(dir) };
}

void main();
