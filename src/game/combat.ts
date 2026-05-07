import type { ActorVitals, BossAttackPhase, BossMoveId, Vec2 } from "./types";

export const ARENA = {
  width: 1200,
  height: 720,
  margin: 44
};

export const PLAYER_MAX: ActorVitals = {
  hp: 100,
  maxHp: 100,
  stamina: 100,
  maxStamina: 100,
  posture: 0,
  maxPosture: 100
};

export const BOSS_SNAP_WINDOW_MS = 150;
export const COUNTER_WINDOW_MS = 850;
export const COUNTER_POSTURE_BONUS = 18;
export const COUNTER_NEAR_MISS_RANGE_PADDING = 28;
export const COUNTER_NEAR_MISS_ARC_PADDING_DEGREES = 10;
export const COUNTER_STAMINA_REFUND = 18;
export const COUNTER_STAGGER_MS = 920;
export const BOSS_PRESSURE_PHASE_MS = 12_000;
export const ATTACK_BUFFER_MS = 220;
export const LIGHT_CHAIN_RESET_MS = 760;

export const PLAYER_ATTACKS = {
  light: {
    range: 98,
    arcDegrees: 126,
    damage: 16,
    posture: 24,
    staminaCost: 18
  },
  heavy: {
    range: 108,
    arcDegrees: 86,
    damage: 34,
    posture: 46,
    staminaCost: 34
  },
  skill: {
    range: 132,
    arcDegrees: 68,
    damage: 22,
    posture: 32,
    staminaCost: 42
  }
} as const;

export type PlayerAttackKind = keyof typeof PLAYER_ATTACKS;

export type AttackProfile = {
  range: number;
  arcDegrees: number;
  damage: number;
  posture: number;
  staminaCost: number;
};

export const PLAYER_ATTACK_TIMINGS: Record<
  PlayerAttackKind,
  {
    activeDelayMs: number;
    activeMs: number;
    recoveryMs: number;
  }
> = {
  light: {
    activeDelayMs: 130,
    activeMs: 100,
    recoveryMs: 390
  },
  heavy: {
    activeDelayMs: 250,
    activeMs: 115,
    recoveryMs: 640
  },
  skill: {
    activeDelayMs: 170,
    activeMs: 135,
    recoveryMs: 520
  }
};

export const LIGHT_CHAIN_PROFILES: Record<1 | 2 | 3, AttackProfile> = {
  1: PLAYER_ATTACKS.light,
  2: {
    ...PLAYER_ATTACKS.light,
    range: PLAYER_ATTACKS.light.range + 8,
    arcDegrees: PLAYER_ATTACKS.light.arcDegrees + 8,
    damage: PLAYER_ATTACKS.light.damage + 2,
    posture: PLAYER_ATTACKS.light.posture + 6
  },
  3: {
    ...PLAYER_ATTACKS.light,
    range: PLAYER_ATTACKS.light.range + 14,
    arcDegrees: PLAYER_ATTACKS.light.arcDegrees + 4,
    damage: PLAYER_ATTACKS.light.damage + 6,
    posture: PLAYER_ATTACKS.light.posture + 16,
    staminaCost: PLAYER_ATTACKS.light.staminaCost + 4
  }
};

export const LIGHT_CHAIN_TIMINGS: Record<1 | 2 | 3, (typeof PLAYER_ATTACK_TIMINGS)["light"]> = {
  1: PLAYER_ATTACK_TIMINGS.light,
  2: {
    activeDelayMs: 110,
    activeMs: 110,
    recoveryMs: 350
  },
  3: {
    activeDelayMs: 165,
    activeMs: 130,
    recoveryMs: 480
  }
};

export const BOSS_MAX: ActorVitals = {
  hp: 260,
  maxHp: 260,
  stamina: 0,
  maxStamina: 0,
  posture: 0,
  maxPosture: 140
};

export const BOSS_MOVES: Record<
  Exclude<BossMoveId, "watching" | "broken">,
  {
    label: BossMoveId;
    telegraphMs: number;
    activeMs: number;
    recoveryMs: number;
    range: number;
    arcDegrees: number;
    damage: number;
    posture: number;
  }
> = {
  "delayed-lunge": {
    label: "delayed-lunge",
    telegraphMs: 760,
    activeMs: 150,
    recoveryMs: 520,
    range: 188,
    arcDegrees: 42,
    damage: 28,
    posture: 34
  },
  "grave-sweep": {
    label: "grave-sweep",
    telegraphMs: 620,
    activeMs: 220,
    recoveryMs: 600,
    range: 158,
    arcDegrees: 132,
    damage: 22,
    posture: 26
  },
  "ash-slam": {
    label: "ash-slam",
    telegraphMs: 920,
    activeMs: 180,
    recoveryMs: 760,
    range: 118,
    arcDegrees: 360,
    damage: 38,
    posture: 48
  }
};

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function distance(a: Vec2, b: Vec2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function normalize(vec: Vec2): Vec2 {
  const length = Math.hypot(vec.x, vec.y);
  if (length < 0.0001) return { x: 1, y: 0 };
  return { x: vec.x / length, y: vec.y / length };
}

export function directionTo(from: Vec2, to: Vec2): Vec2 {
  return normalize({ x: to.x - from.x, y: to.y - from.y });
}

export function dot(a: Vec2, b: Vec2) {
  return a.x * b.x + a.y * b.y;
}

export function isInsideArc(origin: Vec2, facing: Vec2, target: Vec2, range: number, arcDegrees: number) {
  const toTarget = { x: target.x - origin.x, y: target.y - origin.y };
  const length = Math.hypot(toTarget.x, toTarget.y);
  if (length > range) return false;
  if (arcDegrees >= 360) return true;
  const facingNorm = normalize(facing);
  const targetNorm = normalize(toTarget);
  const halfRadians = (arcDegrees * Math.PI) / 360;
  return dot(facingNorm, targetNorm) >= Math.cos(halfRadians);
}

export function isCounterDodgeCandidate(origin: Vec2, facing: Vec2, target: Vec2, range: number, arcDegrees: number) {
  return isInsideArc(
    origin,
    facing,
    target,
    range + COUNTER_NEAR_MISS_RANGE_PADDING,
    Math.min(360, arcDegrees + COUNTER_NEAR_MISS_ARC_PADDING_DEGREES)
  );
}

export function getCounterPosture(basePosture: number, counterReady: boolean) {
  return counterReady ? basePosture + COUNTER_POSTURE_BONUS : basePosture;
}

export function applyCounterStaminaRefund(vitals: ActorVitals, counterReady: boolean) {
  if (!counterReady) return 0;
  const before = vitals.stamina;
  vitals.stamina = clamp(vitals.stamina + COUNTER_STAMINA_REFUND, 0, vitals.maxStamina);
  return vitals.stamina - before;
}

export function isCounterWindowReady(counterUntil: number, time: number) {
  return time <= counterUntil;
}

export function getBossPhase(hp: number, maxHp: number, elapsedMs: number, counterHits: number): 1 | 2 {
  if (hp <= maxHp * 0.5 || elapsedMs >= BOSS_PRESSURE_PHASE_MS || counterHits > 0) return 2;
  return 1;
}

export function isAttackInputBuffered(queuedAt: number | null | undefined, time: number) {
  return queuedAt != null && time - queuedAt <= ATTACK_BUFFER_MS;
}

export function getNextLightChainStep(currentStep: number, chainExpiresAt: number, time: number): 1 | 2 | 3 {
  if (currentStep <= 0 || time > chainExpiresAt) return 1;
  return Math.min(3, currentStep + 1) as 1 | 2 | 3;
}

export function getPlayerAttackProfile(kind: PlayerAttackKind, lightChainStep: number): AttackProfile {
  if (kind !== "light") return PLAYER_ATTACKS[kind];
  const step = clamp(Math.round(lightChainStep), 1, 3) as 1 | 2 | 3;
  return LIGHT_CHAIN_PROFILES[step];
}

export function getPlayerAttackTiming(kind: PlayerAttackKind, lightChainStep: number) {
  if (kind !== "light") return PLAYER_ATTACK_TIMINGS[kind];
  const step = clamp(Math.round(lightChainStep), 1, 3) as 1 | 2 | 3;
  return LIGHT_CHAIN_TIMINGS[step];
}

export function getBossAttackPhase(
  timing:
    | {
        startedAt: number;
        activeAt: number;
        endsAt: number;
        recoveryEndsAt: number;
      }
    | null
    | undefined,
  time: number
): BossAttackPhase {
  if (!timing || time < timing.startedAt || time > timing.recoveryEndsAt) return "idle";
  if (time < timing.activeAt - BOSS_SNAP_WINDOW_MS) return "windup";
  if (time < timing.activeAt) return "snap";
  if (time <= timing.endsAt) return "active";
  return "recovery";
}

export function spendStamina(vitals: ActorVitals, cost: number) {
  if (vitals.stamina < cost) return false;
  vitals.stamina = clamp(vitals.stamina - cost, 0, vitals.maxStamina);
  return true;
}

export function regenerateStamina(vitals: ActorVitals, dtSeconds: number, locked: boolean) {
  const rate = locked ? 14 : 34;
  vitals.stamina = clamp(vitals.stamina + rate * dtSeconds, 0, vitals.maxStamina);
}

export function applyDamage(vitals: ActorVitals, damage: number, posture: number) {
  vitals.hp = clamp(vitals.hp - damage, 0, vitals.maxHp);
  vitals.posture = clamp(vitals.posture + posture, 0, vitals.maxPosture);
}

export function resetPosture(vitals: ActorVitals) {
  vitals.posture = 0;
}

export function clampToArena(position: Vec2) {
  return {
    x: clamp(position.x, ARENA.margin, ARENA.width - ARENA.margin),
    y: clamp(position.y, ARENA.margin, ARENA.height - ARENA.margin)
  };
}

export function chooseBossMove(distanceToPlayer: number, phase: 1 | 2, moveIndex: number): Exclude<BossMoveId, "watching" | "broken"> {
  if (distanceToPlayer > 250) return "delayed-lunge";
  const phaseTwoPattern: Array<Exclude<BossMoveId, "watching" | "broken">> = [
    "grave-sweep",
    "delayed-lunge",
    "ash-slam",
    "grave-sweep"
  ];
  const phaseOnePattern: Array<Exclude<BossMoveId, "watching" | "broken">> = [
    "grave-sweep",
    "delayed-lunge",
    "ash-slam"
  ];
  const pattern = phase === 2 ? phaseTwoPattern : phaseOnePattern;
  return pattern[moveIndex % pattern.length];
}

export function makeRunId() {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
