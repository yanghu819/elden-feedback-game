import type { CombatSnapshot, CombatTrajectorySample, GameStatus } from "./types";

const TERMINAL_STATUSES = new Set<GameStatus>(["dead", "victory"]);

function isTerminal(status: GameStatus) {
  return TERMINAL_STATUSES.has(status);
}

export function toTrajectorySample(snapshot: CombatSnapshot): CombatTrajectorySample {
  return {
    runId: snapshot.runId,
    t: Math.round(snapshot.elapsedMs),
    status: snapshot.status,
    bossAttackPhase: snapshot.bossAttackPhase,
    playerActionState: snapshot.playerActionState,
    playerHp: Math.round(snapshot.player.hp),
    stamina: Math.round(snapshot.player.stamina),
    bossHp: Math.round(snapshot.boss.hp),
    bossPosture: Math.round(snapshot.boss.posture),
    bossPhase: snapshot.boss.phase,
    bossMove: snapshot.boss.move,
    dodges: snapshot.metrics.dodgeCount,
    light: snapshot.metrics.lightThrown,
    heavy: snapshot.metrics.heavyThrown,
    skill: snapshot.metrics.skillThrown,
    hits: snapshot.metrics.hitsLanded,
    damageTaken: snapshot.metrics.damageTaken,
    deathReason: snapshot.metrics.lastDeathReason,
    fps: Math.round(snapshot.metrics.fps)
  };
}

export function shouldKeepTrajectorySample(previous: CombatTrajectorySample | undefined, next: CombatTrajectorySample) {
  if (!previous) return true;
  return (
    previous.runId !== next.runId ||
    next.t - previous.t >= 250 ||
    previous.status !== next.status ||
    previous.bossMove !== next.bossMove ||
    previous.bossAttackPhase !== next.bossAttackPhase ||
    previous.playerActionState !== next.playerActionState ||
    previous.playerHp !== next.playerHp ||
    previous.bossHp !== next.bossHp ||
    previous.dodges !== next.dodges ||
    previous.light !== next.light ||
    previous.heavy !== next.heavy ||
    previous.skill !== next.skill ||
    previous.hits !== next.hits ||
    previous.damageTaken !== next.damageTaken
  );
}

export function appendTrajectorySample(
  history: CombatTrajectorySample[],
  sample: CombatTrajectorySample,
  windowMs = 12_000,
  maxSamples = 80
) {
  let current = history;
  const previous = current.at(-1);

  if (previous && previous.runId !== sample.runId) {
    current = [];
  }

  const last = current.at(-1);
  if (!shouldKeepTrajectorySample(last, sample)) {
    return current;
  }

  if (last && last.runId === sample.runId && isTerminal(last.status) && isTerminal(sample.status)) {
    return current;
  }

  const next = [...current, sample];
  const terminalSample = next.find((item) => item.runId === sample.runId && isTerminal(item.status));
  const anchorTime = terminalSample?.t ?? sample.t;

  return next.filter((item) => item.runId === sample.runId && item.t >= anchorTime - windowMs).slice(-maxSamples);
}
