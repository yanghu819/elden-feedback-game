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

export const DANGER_FRAME_FLASH = {
  "delayed-lunge": {
    edgeColor: 0xff4444,
    edgeAlpha: 0.92,
    edgeWidth: 8,
    fillAlpha: 0.32,
    pulseSpeed: 18
  },
  "grave-sweep": {
    edgeColor: 0xff6622,
    edgeAlpha: 0.88,
    edgeWidth: 7,
    fillAlpha: 0.28,
    pulseSpeed: 22
  },
  "ash-slam": {
    edgeColor: 0xffaa33,
    edgeAlpha: 0.85,
    edgeWidth: 7,
    fillAlpha: 0.26,
    pulseSpeed: 20
  }
} as const satisfies Record<
  Exclude<BossMoveId, "watching" | "broken">,
  {
    edgeColor: number;
    edgeAlpha: number;
    edgeWidth: number;
    fillAlpha: number;
    pulseSpeed: number;
  }
>;

export const HIT_CONFIRM = {
  light: { shakeIntensity: 1.5, shakeDurationMs: 80, flashRadius: 40, flashDurationMs: 200 },
  heavy: { shakeIntensity: 3.0, shakeDurationMs: 120, flashRadius: 52, flashDurationMs: 260 },
  skill: { shakeIntensity: 2.0, shakeDurationMs: 100, flashRadius: 48, flashDurationMs: 240 }
} as const satisfies Record<
  PlayerAttackKind,
  {
    shakeIntensity: number;
    shakeDurationMs: number;
    flashRadius: number;
    flashDurationMs: number;
  }
>;

export function makeRunId() {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
