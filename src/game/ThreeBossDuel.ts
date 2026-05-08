import * as THREE from "three";
import {
  ARENA,
  BOSS_MAX,
  BOSS_MOVES,
  COUNTER_STAGGER_MS,
  COUNTER_WINDOW_MS,
  LIGHT_CHAIN_RESET_MS,
  PLAYER_MAX,
  applyDamage,
  applyCounterStaminaRefund,
  chooseBossMove,
  clampToArena,
  directionTo,
  distance,
  getBossAttackPhase,
  getBossPhase,
  getCounterPosture,
  getNextLightChainStep,
  getPlayerAttackProfile,
  getPlayerAttackTiming,
  isAttackInputBuffered,
  isCounterDodgeCandidate,
  isCounterWindowReady,
  isInsideArc,
  makeRunId,
  normalize,
  regenerateStamina,
  resetPosture,
  spendStamina
} from "./combat";
import type { PlayerAttackKind } from "./combat";
import type { ActorVitals, BossMoveId, CombatRunSummary, CombatSnapshot, PlayerActionState, Vec2 } from "./types";

type Fighter = {
  position: Vec2;
  facing: Vec2;
  vitals: ActorVitals;
};

type PlayerAttack = {
  kind: PlayerAttackKind;
  lightChainStep: number;
  activeAt: number;
  endsAt: number;
  recoveryEndsAt: number;
  resolved: boolean;
};

type QueuedAttack = {
  kind: PlayerAttackKind;
  queuedAt: number;
};

type BossAttack = {
  id: Exclude<BossMoveId, "watching" | "broken">;
  startedAt: number;
  activeAt: number;
  endsAt: number;
  recoveryEndsAt: number;
  facing: Vec2;
  hitResolved: boolean;
  lunged: boolean;
};

type ImpactFx = {
  position: Vec2;
  startedAt: number;
  durationMs: number;
  color: number;
  radius: number;
  label: "player-hit" | "skill-hit" | "chain-hit" | "counter-hit" | "player-damaged" | "posture-break" | "boss-phase";
};

type RunStats = {
  dodgeCount: number;
  lightThrown: number;
  heavyThrown: number;
  skillThrown: number;
  hitsLanded: number;
  damageTaken: number;
  counterWindows: number;
  counterHits: number;
  maxLightChain: number;
  lastDeathReason: string | null;
  bossMoveUses: Record<string, number>;
  bossMoveHits: Record<string, number>;
};

const RELEASE_SHA = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "local";
const CAMERA_LERP = 0.085;
const PLAYER_HEIGHT = 46;
const BOSS_HEIGHT = 92;

function toVector3(position: Vec2, y = 0) {
  return new THREE.Vector3(position.x, y, position.y);
}

function facingYaw(facing: Vec2) {
  return Math.atan2(facing.x, facing.y);
}

function disposeObject(object: THREE.Object3D) {
  const mesh = object as THREE.Mesh;
  if (mesh.geometry) {
    mesh.geometry.dispose();
  }
  const material = mesh.material;
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose());
  } else if (material) {
    material.dispose();
  }
}

function clearGroup(group: THREE.Object3D) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse(disposeObject);
  }
}

function createSectorMesh(origin: Vec2, facing: Vec2, radius: number, arcDegrees: number, color: number, opacity: number, y = 0.08) {
  if (arcDegrees >= 360) {
    const geometry = new THREE.CircleGeometry(radius, 72);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(origin.x, y, origin.y);
    return mesh;
  }

  const segments = Math.max(16, Math.ceil(arcDegrees / 4));
  const center = facingYaw(facing);
  const half = (arcDegrees * Math.PI) / 360;
  const vertices = [0, 0, 0];
  const indices = [];

  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const angle = center - half + t * half * 2;
    vertices.push(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
    if (index > 0) {
      indices.push(0, index, index + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(origin.x, y, origin.y);
  return mesh;
}

function createSectorLine(origin: Vec2, facing: Vec2, radius: number, arcDegrees: number, color: number, opacity: number, y = 0.14) {
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  if (arcDegrees >= 360) {
    const points = [];
    for (let index = 0; index <= 96; index += 1) {
      const angle = (index / 96) * Math.PI * 2;
      points.push(new THREE.Vector3(origin.x + Math.sin(angle) * radius, y, origin.y + Math.cos(angle) * radius));
    }
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
  }

  const segments = Math.max(16, Math.ceil(arcDegrees / 4));
  const center = facingYaw(facing);
  const half = (arcDegrees * Math.PI) / 360;
  const points = [];
  const firstAngle = center - half;
  points.push(new THREE.Vector3(origin.x, y, origin.y));
  points.push(new THREE.Vector3(origin.x + Math.sin(firstAngle) * radius, y, origin.y + Math.cos(firstAngle) * radius));
  for (let index = 0; index <= segments; index += 1) {
    const angle = center - half + (index / segments) * half * 2;
    points.push(new THREE.Vector3(origin.x + Math.sin(angle) * radius, y, origin.y + Math.cos(angle) * radius));
  }
  const lastAngle = center + half;
  points.push(new THREE.Vector3(origin.x, y, origin.y));
  points.push(new THREE.Vector3(origin.x + Math.sin(lastAngle) * radius, y, origin.y + Math.cos(lastAngle) * radius));
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
}

function createRing(position: Vec2, radius: number, thickness: number, color: number, opacity: number, y = 1.2) {
  const geometry = new THREE.RingGeometry(Math.max(0.5, radius - thickness), radius + thickness, 72);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position.x, y, position.y);
  return mesh;
}

export class ThreeBossDuel {
  private parent: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private animationFrame = 0;
  private lastFrameTime = 0;
  private runStartedAt = 0;
  private status: CombatSnapshot["status"] = "loading";
  private player!: Fighter;
  private boss!: Fighter;
  private runId = makeRunId();
  private playerAttack: PlayerAttack | null = null;
  private bossAttack: BossAttack | null = null;
  private queuedAttack: QueuedAttack | null = null;
  private dodgeEndsAt = 0;
  private invulnerableUntil = 0;
  private nextBossDecisionAt = 0;
  private bossMoveIndex = 0;
  private debugHitboxes = false;
  private stats!: RunStats;
  private fps = 60;
  private telemetrySent = false;
  private hitStopUntil = 0;
  private shakeUntil = 0;
  private counterUntil = 0;
  private counterAwardedForAttack: BossAttack | null = null;
  private counterFlashUntil = 0;
  private lastBossPhase: 1 | 2 = 1;
  private phaseSurgeUntil = 0;
  private lightChainStep = 0;
  private lightChainExpiresAt = 0;
  private chainFlashUntil = 0;
  private impactFx: ImpactFx[] = [];
  private keysDown = new Set<string>();
  private keysPressed = new Set<string>();
  private mousePressed = new Set<number>();
  private cameraTarget = new THREE.Vector3(ARENA.width / 2, 70, ARENA.height / 2);
  private cameraPosition = new THREE.Vector3(260, 250, 630);

  private playerGroup!: THREE.Group;
  private bossGroup!: THREE.Group;
  private telegraphGroup = new THREE.Group();
  private strikeGroup = new THREE.Group();
  private effectGroup = new THREE.Group();
  private playerMaterial!: THREE.MeshStandardMaterial;
  private playerCloakMaterial!: THREE.MeshStandardMaterial;
  private bossMaterial!: THREE.MeshStandardMaterial;
  private bossCoreMaterial!: THREE.MeshStandardMaterial;
  private playerAura!: THREE.Mesh;
  private chainAura!: THREE.Mesh;
  private bossWeapon!: THREE.Mesh;

  constructor(parent: HTMLElement) {
    this.parent = parent;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true
    });
    this.renderer.setClearColor(0x0f1210, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("aria-label", "3D boss duel arena");
    this.parent.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(47, 1, 1, 2600);
    this.scene.fog = new THREE.FogExp2(0x101311, 0.00155);
    this.scene.add(this.telegraphGroup, this.strikeGroup, this.effectGroup);

    this.buildWorld();
    this.buildActors();
    this.bindEvents();
    this.resize();
    this.restartRun();
    this.animationFrame = window.requestAnimationFrame(this.animate);
  }

  destroy() {
    window.cancelAnimationFrame(this.animationFrame);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.renderer.domElement.removeEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.removeEventListener("contextmenu", this.onContextMenu);
    clearGroup(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private bindEvents() {
    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.renderer.domElement.addEventListener("contextmenu", this.onContextMenu);
  }

  private resize = () => {
    const width = Math.max(320, this.parent.clientWidth || window.innerWidth);
    const height = Math.max(320, this.parent.clientHeight || window.innerHeight);
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.camera.aspect = width / height;
    this.camera.fov = width < height ? 55 : 47;
    this.camera.updateProjectionMatrix();
  };

  private onKeyDown = (event: KeyboardEvent) => {
    if (!event.repeat) {
      this.keysPressed.add(event.code);
    }
    this.keysDown.add(event.code);
    if (["Space", "ShiftLeft", "ShiftRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
      event.preventDefault();
    }
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.keysDown.delete(event.code);
  };

  private onBlur = () => {
    this.keysDown.clear();
    this.keysPressed.clear();
    this.mousePressed.clear();
  };

  private onPointerDown = (event: PointerEvent) => {
    this.renderer.domElement.focus();
    this.mousePressed.add(event.button);
    event.preventDefault();
  };

  private onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  private buildWorld() {
    const hemi = new THREE.HemisphereLight(0xb8d4c4, 0x16100d, 1.35);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff0ca, 2.6);
    keyLight.position.set(230, 520, 180);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 80;
    keyLight.shadow.camera.far = 1100;
    keyLight.shadow.camera.left = -650;
    keyLight.shadow.camera.right = 650;
    keyLight.shadow.camera.top = 460;
    keyLight.shadow.camera.bottom = -460;
    this.scene.add(keyLight);

    const rim = new THREE.PointLight(0x8bd8d2, 1.45, 720);
    rim.position.set(1020, 170, 120);
    this.scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA.width, ARENA.height, 8, 8),
      new THREE.MeshStandardMaterial({
        color: 0x1a211c,
        roughness: 0.88,
        metalness: 0.04
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(ARENA.width / 2, -0.02, ARENA.height / 2);
    floor.receiveShadow = true;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(ARENA.width, 24, 0x4b5c4d, 0x253026);
    grid.position.set(ARENA.width / 2, 0.05, ARENA.height / 2);
    this.scene.add(grid);

    const boundaryPoints = [
      new THREE.Vector3(ARENA.margin, 1, ARENA.margin),
      new THREE.Vector3(ARENA.width - ARENA.margin, 1, ARENA.margin),
      new THREE.Vector3(ARENA.width - ARENA.margin, 1, ARENA.height - ARENA.margin),
      new THREE.Vector3(ARENA.margin, 1, ARENA.height - ARENA.margin)
    ];
    const boundary = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(boundaryPoints),
      new THREE.LineBasicMaterial({ color: 0xd8b25e, transparent: true, opacity: 0.48 })
    );
    this.scene.add(boundary);

    const centerSigil = createRing({ x: ARENA.width / 2, y: ARENA.height / 2 }, 128, 2, 0xd8b25e, 0.22, 0.1);
    this.scene.add(centerSigil);

    const ruinMaterial = new THREE.MeshStandardMaterial({ color: 0x30372f, roughness: 0.92 });
    const goldMaterial = new THREE.MeshStandardMaterial({ color: 0x6d5a34, roughness: 0.84 });
    const candyMaterial = new THREE.MeshStandardMaterial({ color: 0x4d7f77, roughness: 0.74 });
    const ruins = [
      { x: 120, z: 92, w: 48, h: 92, d: 38 },
      { x: 220, z: 620, w: 72, h: 54, d: 36 },
      { x: 1060, z: 110, w: 62, h: 70, d: 42 },
      { x: 1000, z: 622, w: 86, h: 82, d: 44 },
      { x: 600, z: 76, w: 120, h: 26, d: 28 },
      { x: 580, z: 650, w: 90, h: 38, d: 34 }
    ];
    for (const ruin of ruins) {
      const block = new THREE.Mesh(new THREE.BoxGeometry(ruin.w, ruin.h, ruin.d), ruinMaterial.clone());
      block.position.set(ruin.x, ruin.h / 2, ruin.z);
      block.rotation.y = ((ruin.x + ruin.z) % 11) * 0.035;
      block.castShadow = true;
      block.receiveShadow = true;
      this.scene.add(block);
    }

    for (const marker of [
      { x: 322, z: 94, s: 17 },
      { x: 876, z: 628, s: 22 },
      { x: 1034, z: 368, s: 14 }
    ]) {
      const pebble = new THREE.Mesh(new THREE.IcosahedronGeometry(marker.s, 0), candyMaterial.clone());
      pebble.position.set(marker.x, marker.s * 0.72, marker.z);
      pebble.rotation.set(marker.s * 0.07, marker.s * 0.03, marker.s * 0.05);
      pebble.castShadow = true;
      this.scene.add(pebble);
    }

    for (const corner of [
      { x: 82, z: 82 },
      { x: ARENA.width - 82, z: 82 },
      { x: 82, z: ARENA.height - 82 },
      { x: ARENA.width - 82, z: ARENA.height - 82 }
    ]) {
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(14, 18, 22, 8), goldMaterial.clone());
      plinth.position.set(corner.x, 11, corner.z);
      this.scene.add(plinth);
      const flame = new THREE.PointLight(0xff8a4b, 1.15, 190);
      flame.position.set(corner.x, 42, corner.z);
      this.scene.add(flame);
      const ember = new THREE.Mesh(
        new THREE.SphereGeometry(7, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xff8a4b, transparent: true, opacity: 0.72 })
      );
      ember.position.set(corner.x, 32, corner.z);
      this.scene.add(ember);
    }
  }

  private buildActors() {
    this.playerGroup = new THREE.Group();
    this.playerMaterial = new THREE.MeshStandardMaterial({ color: 0xf2c58d, roughness: 0.72 });
    this.playerCloakMaterial = new THREE.MeshStandardMaterial({ color: 0x425852, roughness: 0.86 });
    const playerShadow = new THREE.Mesh(
      new THREE.CircleGeometry(29, 36),
      new THREE.MeshBasicMaterial({ color: 0x050706, transparent: true, opacity: 0.34, depthWrite: false })
    );
    playerShadow.rotation.x = -Math.PI / 2;
    playerShadow.position.y = 0.08;
    this.playerGroup.add(playerShadow);
    const playerBody = new THREE.Mesh(new THREE.CylinderGeometry(15, 19, PLAYER_HEIGHT, 18), this.playerMaterial);
    playerBody.position.y = PLAYER_HEIGHT / 2;
    playerBody.castShadow = true;
    this.playerGroup.add(playerBody);
    const playerCloak = new THREE.Mesh(new THREE.BoxGeometry(24, 28, 8), this.playerCloakMaterial);
    playerCloak.position.set(0, 25, -13);
    playerCloak.castShadow = true;
    this.playerGroup.add(playerCloak);
    const playerHead = new THREE.Mesh(new THREE.SphereGeometry(12, 18, 12), this.playerMaterial);
    playerHead.position.y = 53;
    playerHead.castShadow = true;
    this.playerGroup.add(playerHead);

    const playerEyeMaterial = new THREE.MeshBasicMaterial({ color: 0x111312 });
    for (const x of [-4.5, 4.5]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(1.9, 8, 6), playerEyeMaterial);
      eye.position.set(x, 56, 10);
      this.playerGroup.add(eye);
    }
    const hat = new THREE.Mesh(
      new THREE.CylinderGeometry(13, 16, 9, 12),
      new THREE.MeshStandardMaterial({ color: 0xd8b25e, roughness: 0.64 })
    );
    hat.position.set(-3, 67, -1);
    hat.rotation.z = 0.16;
    hat.castShadow = true;
    this.playerGroup.add(hat);

    const playerSword = new THREE.Mesh(
      new THREE.BoxGeometry(10, 7, 78),
      new THREE.MeshStandardMaterial({ color: 0xf5d889, metalness: 0.18, roughness: 0.48 })
    );
    playerSword.position.set(12, 32, 43);
    playerSword.castShadow = true;
    this.playerGroup.add(playerSword);

    this.playerAura = new THREE.Mesh(
      new THREE.TorusGeometry(29, 1.5, 8, 56),
      new THREE.MeshBasicMaterial({ color: 0x8bd8d2, transparent: true, opacity: 0.62, depthWrite: false })
    );
    this.playerAura.rotation.x = Math.PI / 2;
    this.playerAura.visible = false;
    this.playerAura.position.y = 1.5;
    this.playerGroup.add(this.playerAura);

    this.chainAura = new THREE.Mesh(
      new THREE.TorusGeometry(35, 1.4, 8, 56),
      new THREE.MeshBasicMaterial({ color: 0xfff0b3, transparent: true, opacity: 0.48, depthWrite: false })
    );
    this.chainAura.rotation.x = Math.PI / 2;
    this.chainAura.visible = false;
    this.chainAura.position.y = 3;
    this.playerGroup.add(this.chainAura);

    this.scene.add(this.playerGroup);

    this.bossGroup = new THREE.Group();
    this.bossMaterial = new THREE.MeshStandardMaterial({ color: 0x7b4b66, roughness: 0.78 });
    this.bossCoreMaterial = new THREE.MeshStandardMaterial({ color: 0xd8b25e, emissive: 0x241904, roughness: 0.62 });
    const bossShadow = new THREE.Mesh(
      new THREE.CircleGeometry(52, 44),
      new THREE.MeshBasicMaterial({ color: 0x050706, transparent: true, opacity: 0.42, depthWrite: false })
    );
    bossShadow.rotation.x = -Math.PI / 2;
    bossShadow.position.y = 0.08;
    this.bossGroup.add(bossShadow);
    const bossBody = new THREE.Mesh(new THREE.CylinderGeometry(34, 48, BOSS_HEIGHT, 24), this.bossMaterial);
    bossBody.position.y = BOSS_HEIGHT / 2;
    bossBody.scale.set(1.1, 1, 0.86);
    bossBody.castShadow = true;
    this.bossGroup.add(bossBody);
    const bossBelly = new THREE.Mesh(new THREE.SphereGeometry(38, 22, 14), this.bossMaterial);
    bossBelly.position.set(0, 38, 8);
    bossBelly.scale.set(1.22, 0.86, 0.92);
    bossBelly.castShadow = true;
    this.bossGroup.add(bossBelly);
    const bossHead = new THREE.Mesh(new THREE.SphereGeometry(24, 20, 14), this.bossMaterial);
    bossHead.position.y = 108;
    bossHead.scale.set(1.18, 0.78, 1.0);
    bossHead.castShadow = true;
    this.bossGroup.add(bossHead);
    const eyeWhite = new THREE.MeshBasicMaterial({ color: 0xf8f3de });
    const pupil = new THREE.MeshBasicMaterial({ color: 0x151816 });
    for (const x of [-10, 10]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(6.5, 12, 8), eyeWhite);
      eye.position.set(x, 113, 22);
      this.bossGroup.add(eye);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(2.5, 8, 6), pupil);
      dot.position.set(x + 1.8, 112, 27.2);
      this.bossGroup.add(dot);
    }
    const crownBase = new THREE.Mesh(
      new THREE.CylinderGeometry(22, 25, 9, 14),
      new THREE.MeshStandardMaterial({ color: 0xffd267, roughness: 0.54 })
    );
    crownBase.position.set(5, 129, -3);
    crownBase.rotation.z = -0.18;
    this.bossGroup.add(crownBase);
    for (const x of [-14, 0, 14]) {
      const crownSpike = new THREE.Mesh(
        new THREE.ConeGeometry(6, 18, 8),
        new THREE.MeshStandardMaterial({ color: 0xfff0b3, roughness: 0.5 })
      );
      crownSpike.position.set(x + 5, 143, -3);
      crownSpike.rotation.z = -0.18 + x * 0.004;
      this.bossGroup.add(crownSpike);
    }
    const bossCore = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 10), this.bossCoreMaterial);
    bossCore.position.set(0, 66, 31);
    this.bossGroup.add(bossCore);
    this.bossWeapon = new THREE.Mesh(
      new THREE.BoxGeometry(16, 12, 150),
      new THREE.MeshStandardMaterial({ color: 0x221d19, metalness: 0.28, roughness: 0.56 })
    );
    this.bossWeapon.position.set(-58, 70, 42);
    this.bossWeapon.rotation.z = 0.42;
    this.bossWeapon.castShadow = true;
    this.bossGroup.add(this.bossWeapon);
    const stampHead = new THREE.Mesh(
      new THREE.BoxGeometry(48, 34, 28),
      new THREE.MeshStandardMaterial({ color: 0x8bd8d2, roughness: 0.66 })
    );
    stampHead.position.set(-78, 70, 112);
    stampHead.rotation.z = 0.42;
    stampHead.castShadow = true;
    this.bossGroup.add(stampHead);
    this.scene.add(this.bossGroup);
  }

  private restartRun() {
    this.player = {
      position: { x: 360, y: ARENA.height / 2 },
      facing: { x: 1, y: 0 },
      vitals: { ...PLAYER_MAX }
    };
    this.boss = {
      position: { x: 820, y: ARENA.height / 2 },
      facing: { x: -1, y: 0 },
      vitals: { ...BOSS_MAX }
    };
    this.runId = makeRunId();
    this.runStartedAt = performance.now();
    this.status = "running";
    this.playerAttack = null;
    this.bossAttack = null;
    this.queuedAttack = null;
    this.dodgeEndsAt = 0;
    this.invulnerableUntil = 0;
    this.nextBossDecisionAt = performance.now() + 850;
    this.bossMoveIndex = 0;
    this.telemetrySent = false;
    this.hitStopUntil = 0;
    this.shakeUntil = 0;
    this.counterUntil = 0;
    this.counterAwardedForAttack = null;
    this.counterFlashUntil = 0;
    this.lastBossPhase = 1;
    this.phaseSurgeUntil = 0;
    this.lightChainStep = 0;
    this.lightChainExpiresAt = 0;
    this.chainFlashUntil = 0;
    this.impactFx = [];
    this.stats = {
      dodgeCount: 0,
      lightThrown: 0,
      heavyThrown: 0,
      skillThrown: 0,
      hitsLanded: 0,
      damageTaken: 0,
      counterWindows: 0,
      counterHits: 0,
      maxLightChain: 0,
      lastDeathReason: null,
      bossMoveUses: {},
      bossMoveHits: {}
    };
  }

  private animate = (time: number) => {
    const delta = this.lastFrameTime ? time - this.lastFrameTime : 16.67;
    this.lastFrameTime = time;
    this.update(time, Math.min(delta / 1000, 0.05));
    this.animationFrame = window.requestAnimationFrame(this.animate);
  };

  private update(time: number, dt: number) {
    this.fps = this.fps * 0.92 + (1000 / Math.max(1, dt * 1000)) * 0.08;

    if (this.keysPressed.has("KeyF")) {
      window.dispatchEvent(new CustomEvent("boss-duel:feedback"));
    }
    if (this.keysPressed.has("KeyH")) {
      this.debugHitboxes = !this.debugHitboxes;
    }
    if ((this.status === "dead" || this.status === "victory") && this.keysPressed.has("KeyR")) {
      this.restartRun();
    }

    if (this.status === "running" && time >= this.hitStopUntil) {
      this.updatePlayer(time, dt);
      this.updateBoss(time, dt);
      this.updateCounterWindow(time);
      this.resolvePlayerAttack(time);
      this.resolveBossAttack(time);
      this.keepActorsSeparated();
      this.checkEndState(time);
    }

    this.renderFrame(time);
    this.publishSnapshot(time);
    this.keysPressed.clear();
    this.mousePressed.clear();
  }

  private updatePlayer(time: number, dt: number) {
    this.updateFacingFromBoss();

    const attacking = Boolean(this.playerAttack && time < this.playerAttack.recoveryEndsAt);
    const dodging = time < this.dodgeEndsAt;
    const attackInput = this.readAttackInput();
    if (attackInput) {
      this.queuedAttack = { kind: attackInput, queuedAt: time };
    }

    regenerateStamina(this.player.vitals, dt, attacking || dodging);

    if (!attacking && !dodging) {
      const move = this.getMoveDirection();
      if (move.x !== 0 || move.y !== 0) {
        this.player.position = clampToArena({
          x: this.player.position.x + move.x * 250 * dt,
          y: this.player.position.y + move.y * 250 * dt
        });
      }
    }

    if (!attacking && (this.keysPressed.has("Space") || this.keysPressed.has("ShiftLeft") || this.keysPressed.has("ShiftRight"))) {
      if (spendStamina(this.player.vitals, 28)) {
        this.stats.dodgeCount += 1;
        this.dodgeEndsAt = time + 230;
        this.invulnerableUntil = time + 210;
        const dodgeDirection = this.getMoveDirection();
        const direction = dodgeDirection.x === 0 && dodgeDirection.y === 0 ? this.player.facing : dodgeDirection;
        this.player.position = clampToArena({
          x: this.player.position.x + direction.x * 106,
          y: this.player.position.y + direction.y * 106
        });
        this.addImpactFx(this.player.position, time, "counter-hit", 0.58);
      }
    }

    if (!attacking && !dodging) {
      const queuedAttack = this.queuedAttack && isAttackInputBuffered(this.queuedAttack.queuedAt, time) ? this.queuedAttack.kind : null;
      if (queuedAttack && this.startPlayerAttack(queuedAttack, time)) {
        this.queuedAttack = null;
      }
    }
  }

  private updateBoss(time: number, dt: number) {
    this.boss.facing = directionTo(this.boss.position, this.player.position);
    const phase = this.getCurrentBossPhase(time);
    if (phase !== this.lastBossPhase) {
      this.lastBossPhase = phase;
      this.phaseSurgeUntil = time + 900;
      this.addImpactFx(this.boss.position, time, "boss-phase", 0.7);
    }

    if (!this.bossAttack && time >= this.nextBossDecisionAt) {
      const move = chooseBossMove(distance(this.boss.position, this.player.position), phase, this.bossMoveIndex);
      this.startBossAttack(move, time);
      this.bossMoveIndex += 1;
    }

    if (!this.bossAttack) {
      const speed = phase === 2 ? 92 : 72;
      const dist = distance(this.boss.position, this.player.position);
      if (dist > 178) {
        this.boss.position = clampToArena({
          x: this.boss.position.x + this.boss.facing.x * speed * dt,
          y: this.boss.position.y + this.boss.facing.y * speed * dt
        });
      } else if (dist < 104) {
        this.boss.position = clampToArena({
          x: this.boss.position.x - this.boss.facing.x * speed * 0.48 * dt,
          y: this.boss.position.y - this.boss.facing.y * speed * 0.48 * dt
        });
      }
    }

    if (this.bossAttack && time >= this.bossAttack.activeAt && !this.bossAttack.lunged && this.bossAttack.id === "delayed-lunge") {
      this.bossAttack.lunged = true;
      this.boss.position = clampToArena({
        x: this.boss.position.x + this.bossAttack.facing.x * 126,
        y: this.boss.position.y + this.bossAttack.facing.y * 126
      });
    }

    if (this.bossAttack && time >= this.bossAttack.recoveryEndsAt) {
      this.bossAttack = null;
      this.nextBossDecisionAt = time + (phase === 2 ? 430 : 650);
    }
  }

  private startPlayerAttack(kind: PlayerAttackKind, time: number) {
    const lightChainStep = kind === "light" ? getNextLightChainStep(this.lightChainStep, this.lightChainExpiresAt, time) : 0;
    const attack = getPlayerAttackProfile(kind, lightChainStep);
    if (!spendStamina(this.player.vitals, attack.staminaCost)) return false;

    if (kind === "heavy") this.stats.heavyThrown += 1;
    else if (kind === "skill") this.stats.skillThrown += 1;
    else {
      this.stats.lightThrown += 1;
      this.lightChainStep = lightChainStep;
      this.lightChainExpiresAt = time + LIGHT_CHAIN_RESET_MS;
      this.stats.maxLightChain = Math.max(this.stats.maxLightChain, lightChainStep);
    }

    if (kind !== "light") {
      this.lightChainStep = 0;
      this.lightChainExpiresAt = 0;
    }

    if (kind === "skill") {
      this.player.position = clampToArena({
        x: this.player.position.x + this.player.facing.x * 54,
        y: this.player.position.y + this.player.facing.y * 54
      });
    }

    const timing = getPlayerAttackTiming(kind, lightChainStep);
    this.playerAttack = {
      kind,
      lightChainStep,
      activeAt: time + timing.activeDelayMs,
      endsAt: time + timing.activeDelayMs + timing.activeMs,
      recoveryEndsAt: time + timing.recoveryMs,
      resolved: false
    };
    return true;
  }

  private startBossAttack(id: Exclude<BossMoveId, "watching" | "broken">, time: number) {
    const move = BOSS_MOVES[id];
    this.stats.bossMoveUses[id] = (this.stats.bossMoveUses[id] || 0) + 1;
    this.counterAwardedForAttack = null;
    this.bossAttack = {
      id,
      startedAt: time,
      activeAt: time + move.telegraphMs,
      endsAt: time + move.telegraphMs + move.activeMs,
      recoveryEndsAt: time + move.telegraphMs + move.activeMs + move.recoveryMs,
      facing: this.boss.facing,
      hitResolved: false,
      lunged: false
    };
  }

  private resolvePlayerAttack(time: number) {
    if (!this.playerAttack) return;
    if (time >= this.playerAttack.activeAt && time <= this.playerAttack.endsAt && !this.playerAttack.resolved) {
      const attack = getPlayerAttackProfile(this.playerAttack.kind, this.playerAttack.lightChainStep);
      const counterReady = this.isCounterReady(time);
      const posture = getCounterPosture(attack.posture, counterReady);
      const hit = isInsideArc(this.player.position, this.player.facing, this.boss.position, attack.range, attack.arcDegrees);
      this.playerAttack.resolved = true;

      if (hit) {
        this.stats.hitsLanded += 1;
        applyDamage(this.boss.vitals, attack.damage, posture);
        const chainFinisher = this.playerAttack.kind === "light" && this.playerAttack.lightChainStep === 3;
        const label =
          counterReady ? "counter-hit" : chainFinisher ? "chain-hit" : this.playerAttack.kind === "heavy" ? "posture-break" : this.playerAttack.kind === "skill" ? "skill-hit" : "player-hit";
        const stopMs = counterReady ? 112 : chainFinisher ? 90 : this.playerAttack.kind === "heavy" ? 96 : this.playerAttack.kind === "skill" ? 82 : 58;
        this.addImpactFx(this.boss.position, time, label);
        this.hitStopUntil = Math.max(this.hitStopUntil, time + stopMs);
        this.shakeUntil = Math.max(this.shakeUntil, time + stopMs + 130);

        if (chainFinisher) {
          this.chainFlashUntil = time + 280;
        }
        if (counterReady) {
          this.stats.counterHits += 1;
          applyCounterStaminaRefund(this.player.vitals, true);
          this.counterUntil = 0;
          this.counterFlashUntil = time + 340;
          this.bossAttack = null;
          this.nextBossDecisionAt = time + COUNTER_STAGGER_MS;
          this.phaseSurgeUntil = Math.max(this.phaseSurgeUntil, time + 560);
        }
        if (this.boss.vitals.posture >= this.boss.vitals.maxPosture) {
          applyDamage(this.boss.vitals, 42, 0);
          resetPosture(this.boss.vitals);
          this.bossAttack = null;
          this.nextBossDecisionAt = time + 1120;
          this.addImpactFx(this.boss.position, time, "posture-break");
          this.hitStopUntil = Math.max(this.hitStopUntil, time + 135);
          this.shakeUntil = Math.max(this.shakeUntil, time + 340);
        }
      }
    }

    if (time >= this.playerAttack.recoveryEndsAt) {
      this.playerAttack = null;
    }
  }

  private resolveBossAttack(time: number) {
    if (!this.bossAttack || this.bossAttack.hitResolved) return;
    if (time < this.bossAttack.activeAt || time > this.bossAttack.endsAt) return;

    const move = BOSS_MOVES[this.bossAttack.id];
    const hit = isInsideArc(this.boss.position, this.bossAttack.facing, this.player.position, move.range, move.arcDegrees);
    this.bossAttack.hitResolved = true;
    if (hit && time > this.invulnerableUntil) {
      applyDamage(this.player.vitals, move.damage, move.posture);
      this.stats.damageTaken += move.damage;
      this.stats.lastDeathReason = this.bossAttack.id;
      this.stats.bossMoveHits[this.bossAttack.id] = (this.stats.bossMoveHits[this.bossAttack.id] || 0) + 1;
      this.addImpactFx(this.player.position, time, "player-damaged");
      this.hitStopUntil = Math.max(this.hitStopUntil, time + 54);
      this.shakeUntil = Math.max(this.shakeUntil, time + 230);
    }
  }

  private updateCounterWindow(time: number) {
    if (!this.bossAttack || this.counterAwardedForAttack === this.bossAttack || time >= this.dodgeEndsAt) return;
    if (getBossAttackPhase(this.bossAttack, time) !== "active") return;
    const move = BOSS_MOVES[this.bossAttack.id];
    const counterCandidate = isCounterDodgeCandidate(this.boss.position, this.bossAttack.facing, this.player.position, move.range, move.arcDegrees);
    if (!counterCandidate) return;
    this.counterAwardedForAttack = this.bossAttack;
    this.counterUntil = time + COUNTER_WINDOW_MS;
    this.counterFlashUntil = time + 280;
    this.stats.counterWindows += 1;
  }

  private checkEndState(time: number) {
    if (this.player.vitals.hp <= 0) {
      this.status = "dead";
      this.sendTelemetry("death", time);
    }
    if (this.boss.vitals.hp <= 0) {
      this.status = "victory";
      this.sendTelemetry("victory", time);
    }
  }

  private renderFrame(time: number) {
    this.updateCamera(time);
    this.updateActorMeshes(time);
    this.drawTelegraphs(time);
    this.drawStrikePreview(time);
    this.drawImpactFx(time);
    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(time: number) {
    const bossDir = directionTo(this.boss.position, this.player.position);
    const narrowViewport = this.camera.aspect < 0.8;
    const target = new THREE.Vector3(
      this.player.position.x * 0.58 + this.boss.position.x * 0.42,
      72,
      this.player.position.y * 0.58 + this.boss.position.y * 0.42
    );
    const desired = new THREE.Vector3(
      this.player.position.x + bossDir.x * (narrowViewport ? 390 : 245),
      narrowViewport ? 292 : 214,
      this.player.position.y + bossDir.y * (narrowViewport ? 390 : 245)
    );
    const dist = distance(this.player.position, this.boss.position);
    desired.y += Math.max(0, Math.min(70, (dist - 160) * 0.22));

    if (time < this.shakeUntil) {
      const shake = (this.shakeUntil - time) / 300;
      desired.x += Math.sin(time * 0.12) * 8 * shake;
      desired.y += Math.cos(time * 0.17) * 5 * shake;
      desired.z += Math.sin(time * 0.1 + 2) * 8 * shake;
    }

    this.cameraTarget.lerp(target, CAMERA_LERP);
    this.cameraPosition.lerp(desired, CAMERA_LERP);
    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.cameraTarget);
  }

  private updateActorMeshes(time: number) {
    const invulnerable = time < this.invulnerableUntil;
    const counterReady = this.isCounterReady(time);
    const chainActive = time <= this.lightChainExpiresAt || time < this.chainFlashUntil;
    const bossPhase = this.getCurrentBossPhase(time);
    const attackPhase = getBossAttackPhase(this.bossAttack, time);
    const bossHitFlash = this.hasRecentBossHitFx(time);

    const playerWobble = Math.sin(time / 86) * 0.025;
    this.playerGroup.position.copy(toVector3(this.player.position));
    this.playerGroup.rotation.y = facingYaw(this.player.facing);
    const playerBaseScale = invulnerable ? 1.04 + Math.sin(time / 38) * 0.02 : 1;
    this.playerGroup.scale.set(playerBaseScale * (1 + playerWobble), playerBaseScale * (1 - playerWobble * 0.5), playerBaseScale * (1 - playerWobble));
    this.playerMaterial.color.setHex(invulnerable ? 0x8bd8d2 : 0xf2c58d);
    this.playerCloakMaterial.color.setHex(counterReady ? 0x295d5b : 0x425852);
    this.playerAura.visible = counterReady || time < this.counterFlashUntil;
    if (this.playerAura.visible) {
      const remaining = counterReady ? Math.max(0, this.counterUntil - time) / COUNTER_WINDOW_MS : 0;
      const pulse = 1 + Math.sin(time / 35) * 0.06;
      this.playerAura.scale.setScalar((1.08 + remaining * 0.24) * pulse);
    }
    this.chainAura.visible = chainActive;
    if (this.chainAura.visible) {
      const step = Math.max(1, this.lightChainStep);
      const pulse = 1 + Math.sin(time / 44) * 0.04;
      this.chainAura.scale.setScalar((0.9 + step * 0.11) * pulse);
    }

    this.bossGroup.position.copy(toVector3(this.boss.position));
    this.bossGroup.rotation.y = facingYaw(this.boss.facing);
    const recovery = attackPhase === "recovery";
    const bossColor = bossHitFlash ? 0xf5d889 : recovery ? 0x2c312d : bossPhase === 2 ? 0x9c4051 : 0x7b4b66;
    this.bossMaterial.color.setHex(bossColor);
    this.bossMaterial.emissive.setHex(bossPhase === 2 && !recovery ? 0x210609 : 0x000000);
    this.bossCoreMaterial.emissiveIntensity = attackPhase === "snap" ? 1.8 : attackPhase === "active" ? 2.4 : bossPhase === 2 ? 1.1 : 0.7;
    const bossBaseScale = attackPhase === "snap" ? 1.03 + Math.sin(time / 24) * 0.02 : 1;
    const bossWobble = Math.sin(time / 105) * 0.035;
    this.bossGroup.scale.set(bossBaseScale * (1 + bossWobble), bossBaseScale * (1 - bossWobble * 0.35), bossBaseScale * (1 - bossWobble));
    this.bossWeapon.rotation.x = attackPhase === "snap" ? -0.2 : attackPhase === "active" ? -0.46 : recovery ? 0.24 : 0.02;
    this.bossWeapon.rotation.y = Math.sin(time / 130) * 0.08;
  }

  private drawTelegraphs(time: number) {
    clearGroup(this.telegraphGroup);
    if (!this.bossAttack) return;
    const attackPhase = getBossAttackPhase(this.bossAttack, time);
    if (attackPhase === "idle") return;
    const move = BOSS_MOVES[this.bossAttack.id];

    if (attackPhase === "recovery") {
      this.telegraphGroup.add(createRing(this.boss.position, 58, 2.2, 0x9fab8e, 0.34));
      this.telegraphGroup.add(createRing(this.boss.position, 74, 1.2, 0xd8b25e, 0.18));
      return;
    }

    const charge = Math.min(1, Math.max(0, (time - this.bossAttack.startedAt) / (this.bossAttack.activeAt - this.bossAttack.startedAt)));
    const color = attackPhase === "active" ? 0xfff0b3 : attackPhase === "snap" ? 0xffd267 : 0xb53b35;
    const fillAlpha = attackPhase === "active" ? 0.44 : attackPhase === "snap" ? 0.36 : 0.1 + charge * 0.14;
    const edgeAlpha = attackPhase === "active" ? 1 : attackPhase === "snap" ? 0.86 : 0.34;
    const pulse = attackPhase === "snap" ? 1 + Math.sin(time / 24) * 0.05 : 1;
    this.telegraphGroup.add(createSectorMesh(this.boss.position, this.bossAttack.facing, move.range * pulse, move.arcDegrees, color, fillAlpha));
    this.telegraphGroup.add(createSectorLine(this.boss.position, this.bossAttack.facing, move.range * pulse, move.arcDegrees, color, edgeAlpha));
    if (attackPhase === "active") {
      this.telegraphGroup.add(createSectorLine(this.boss.position, this.bossAttack.facing, move.range + 5, move.arcDegrees, 0xffffff, 0.72, 0.24));
    }
    if (attackPhase === "snap") {
      this.telegraphGroup.add(createSectorLine(this.boss.position, this.bossAttack.facing, move.range * 1.05, move.arcDegrees, 0xffffff, 0.64, 0.24));
    }
    if (this.debugHitboxes) {
      this.telegraphGroup.add(createSectorLine(this.boss.position, this.bossAttack.facing, move.range, move.arcDegrees, 0x8bd8d2, 0.9, 0.32));
    }
  }

  private drawStrikePreview(time: number) {
    clearGroup(this.strikeGroup);
    if (!this.playerAttack) return;
    const attack = getPlayerAttackProfile(this.playerAttack.kind, this.playerAttack.lightChainStep);
    const windup = time < this.playerAttack.activeAt;
    const chainFinisher = this.playerAttack.kind === "light" && this.playerAttack.lightChainStep === 3;
    const color = this.playerAttack.kind === "skill" ? 0x8bd8d2 : chainFinisher ? 0xfff0b3 : this.playerAttack.kind === "heavy" ? 0xffffff : 0xe8d38a;
    const alpha = windup ? 0.16 : 0.34;
    this.strikeGroup.add(createSectorMesh(this.player.position, this.player.facing, attack.range, attack.arcDegrees, color, alpha, 0.18));
    this.strikeGroup.add(createSectorLine(this.player.position, this.player.facing, attack.range, attack.arcDegrees, color, windup ? 0.32 : 0.72, 0.28));
    if (chainFinisher) {
      this.strikeGroup.add(createRing(this.player.position, 42, 1.8, 0xfff0b3, windup ? 0.22 : 0.42, 1.8));
    }
    if (this.playerAttack.kind === "skill") {
      const focusPoint = {
        x: this.player.position.x + this.player.facing.x * 64,
        y: this.player.position.y + this.player.facing.y * 64
      };
      this.strikeGroup.add(createRing(focusPoint, 26, 1.6, 0x8bd8d2, windup ? 0.2 : 0.46, 2.2));
    }
  }

  private addImpactFx(position: Vec2, time: number, label: ImpactFx["label"], opacityScale = 1) {
    const config = {
      "player-hit": { color: 0xf5d889, radius: 34, durationMs: 240 },
      "skill-hit": { color: 0x8bd8d2, radius: 46, durationMs: 290 },
      "chain-hit": { color: 0xfff0b3, radius: 54, durationMs: 330 },
      "counter-hit": { color: 0x8bd8d2, radius: 60, durationMs: 380 },
      "player-damaged": { color: 0xff6c55, radius: 45, durationMs: 310 },
      "posture-break": { color: 0xffffff, radius: 82, durationMs: 420 },
      "boss-phase": { color: 0xffd267, radius: 88, durationMs: 460 }
    }[label];
    this.impactFx.push({
      position: { ...position },
      startedAt: time,
      label,
      color: config.color,
      radius: config.radius * opacityScale,
      durationMs: config.durationMs
    });
    this.impactFx = this.impactFx.slice(-14);
  }

  private drawImpactFx(time: number) {
    clearGroup(this.effectGroup);
    this.impactFx = this.impactFx.filter((effect) => time - effect.startedAt <= effect.durationMs);
    for (const effect of this.impactFx) {
      const progress = Math.min(1, Math.max(0, (time - effect.startedAt) / effect.durationMs));
      const radius = effect.radius * (0.28 + progress * 0.95);
      const opacity = (1 - progress) * (effect.label === "boss-phase" ? 0.5 : 0.82);
      this.effectGroup.add(createRing(effect.position, radius, effect.label === "posture-break" ? 4 : 2.2, effect.color, opacity, effect.label === "player-damaged" ? 9 : 5));
      if (effect.label === "posture-break" || effect.label === "counter-hit" || effect.label === "chain-hit") {
        const spark = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(5, radius * 0.12), 16, 10),
          new THREE.MeshBasicMaterial({ color: effect.color, transparent: true, opacity: opacity * 0.58, depthWrite: false })
        );
        spark.position.copy(toVector3(effect.position, 44 + progress * 18));
        this.effectGroup.add(spark);
      }
    }
  }

  private publishSnapshot(time: number) {
    window.dispatchEvent(
      new CustomEvent<CombatSnapshot>("boss-duel:snapshot", {
        detail: this.snapshot(time)
      })
    );
  }

  private snapshot(time: number): CombatSnapshot {
    return {
      runId: this.runId,
      status: this.status,
      elapsedMs: Math.max(0, time - this.runStartedAt),
      releaseSha: RELEASE_SHA,
      bossAttackPhase: getBossAttackPhase(this.bossAttack, time),
      playerActionState: this.getPlayerActionState(time),
      player: {
        hp: this.player.vitals.hp,
        maxHp: this.player.vitals.maxHp,
        stamina: this.player.vitals.stamina,
        maxStamina: this.player.vitals.maxStamina,
        posture: this.player.vitals.posture,
        maxPosture: this.player.vitals.maxPosture
      },
      boss: {
        hp: this.boss.vitals.hp,
        maxHp: this.boss.vitals.maxHp,
        stamina: 0,
        maxStamina: 0,
        posture: this.boss.vitals.posture,
        maxPosture: this.boss.vitals.maxPosture,
        phase: this.getCurrentBossPhase(time),
        move: this.bossAttack?.id || "watching"
      },
      metrics: {
        fps: this.fps,
        dodgeCount: this.stats.dodgeCount,
        lightThrown: this.stats.lightThrown,
        heavyThrown: this.stats.heavyThrown,
        skillThrown: this.stats.skillThrown,
        hitsLanded: this.stats.hitsLanded,
        damageTaken: this.stats.damageTaken,
        counterWindows: this.stats.counterWindows,
        counterHits: this.stats.counterHits,
        counterReady: this.isCounterReady(time),
        lightChainStep: time <= this.lightChainExpiresAt ? this.lightChainStep : 0,
        maxLightChain: this.stats.maxLightChain,
        lastDeathReason: this.stats.lastDeathReason
      }
    };
  }

  private sendTelemetry(event: CombatRunSummary["event"], time: number) {
    if (this.telemetrySent) return;
    this.telemetrySent = true;
    const payload: CombatRunSummary = {
      ...this.snapshot(time),
      event,
      bossMoveUses: this.stats.bossMoveUses,
      bossMoveHits: this.stats.bossMoveHits
    };
    const body = JSON.stringify(payload);
    const blob = new Blob([body], { type: "application/json" });
    if (!navigator.sendBeacon("/api/telemetry", blob)) {
      fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true
      }).catch(() => undefined);
    }
  }

  private updateFacingFromBoss() {
    this.player.facing = directionTo(this.player.position, this.boss.position);
  }

  private getMoveDirection() {
    const forward = directionTo(this.player.position, this.boss.position);
    const right = normalize({ x: forward.y, y: -forward.x });
    const move = {
      x:
        Number(this.keysDown.has("KeyW")) * forward.x -
        Number(this.keysDown.has("KeyS")) * forward.x +
        Number(this.keysDown.has("KeyD")) * right.x -
        Number(this.keysDown.has("KeyA")) * right.x,
      y:
        Number(this.keysDown.has("KeyW")) * forward.y -
        Number(this.keysDown.has("KeyS")) * forward.y +
        Number(this.keysDown.has("KeyD")) * right.y -
        Number(this.keysDown.has("KeyA")) * right.y
    };
    return normalize(move);
  }

  private keepActorsSeparated() {
    const minDistance = 112;
    const between = {
      x: this.player.position.x - this.boss.position.x,
      y: this.player.position.y - this.boss.position.y
    };
    const current = Math.hypot(between.x, between.y);
    if (current >= minDistance) return;

    const direction = current < 0.0001 ? { x: -this.boss.facing.x, y: -this.boss.facing.y } : { x: between.x / current, y: between.y / current };
    const push = minDistance - current;
    this.player.position = clampToArena({
      x: this.player.position.x + direction.x * push,
      y: this.player.position.y + direction.y * push
    });
  }

  private readAttackInput(): PlayerAttackKind | null {
    if (this.keysPressed.has("KeyE")) return "skill";
    if (this.keysPressed.has("KeyK") || this.mousePressed.has(2)) return "heavy";
    if (this.keysPressed.has("KeyJ") || this.mousePressed.has(0)) return "light";
    return null;
  }

  private getPlayerActionState(time: number): PlayerActionState {
    if (this.status !== "running") return "idle";
    if (time < this.dodgeEndsAt) return "dodging";
    if (this.playerAttack) {
      if (time <= this.playerAttack.endsAt) return this.playerAttack.kind;
      if (time < this.playerAttack.recoveryEndsAt) return "recovering";
    }
    const moving = this.keysDown.has("KeyW") || this.keysDown.has("KeyA") || this.keysDown.has("KeyS") || this.keysDown.has("KeyD");
    return moving ? "moving" : "idle";
  }

  private isCounterReady(time: number) {
    return this.counterUntil > 0 && isCounterWindowReady(this.counterUntil, time);
  }

  private getCurrentBossPhase(time: number): 1 | 2 {
    return getBossPhase(
      this.boss.vitals.hp,
      this.boss.vitals.maxHp,
      Math.max(0, time - this.runStartedAt),
      this.stats?.counterHits || 0
    );
  }

  private hasRecentBossHitFx(time: number) {
    return this.impactFx.some(
      (effect) =>
        (effect.label === "player-hit" || effect.label === "skill-hit" || effect.label === "chain-hit" || effect.label === "counter-hit" || effect.label === "posture-break") &&
        time - effect.startedAt >= 0 &&
        time - effect.startedAt <= Math.min(170, effect.durationMs)
    );
  }
}
