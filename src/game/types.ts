export type GameStatus = "loading" | "running" | "dead" | "victory" | "paused";

export type BossMoveId = "watching" | "delayed-lunge" | "grave-sweep" | "ash-slam" | "broken";

export type Vec2 = {
  x: number;
  y: number;
};

export type ActorVitals = {
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  posture: number;
  maxPosture: number;
};

export type CombatSnapshot = {
  runId: string;
  status: GameStatus;
  elapsedMs: number;
  releaseSha: string;
  player: ActorVitals;
  boss: ActorVitals & {
    phase: 1 | 2;
    move: BossMoveId;
  };
  metrics: {
    fps: number;
    dodgeCount: number;
    lightThrown: number;
    heavyThrown: number;
    hitsLanded: number;
    damageTaken: number;
    lastDeathReason: string | null;
  };
};

export type CombatRunSummary = CombatSnapshot & {
  event: "death" | "victory" | "manual-feedback" | "heartbeat";
  bossMoveUses: Record<string, number>;
  bossMoveHits: Record<string, number>;
};

export type CombatTrajectorySample = {
  runId: string;
  t: number;
  status: GameStatus;
  playerHp: number;
  stamina: number;
  bossHp: number;
  bossPosture: number;
  bossPhase: 1 | 2;
  bossMove: BossMoveId;
  dodges: number;
  light: number;
  heavy: number;
  hits: number;
  damageTaken: number;
  deathReason: string | null;
  fps: number;
};

export type FeedbackPayload = {
  message: string;
  context: CombatSnapshot;
  trajectory?: CombatTrajectorySample[];
  route: string;
  createdAt: string;
};
