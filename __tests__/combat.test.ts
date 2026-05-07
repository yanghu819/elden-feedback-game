import { describe, expect, it } from "vitest";
import {
  BOSS_SNAP_WINDOW_MS,
  BOSS_MAX,
  BOSS_PRESSURE_PHASE_MS,
  COUNTER_POSTURE_BONUS,
  COUNTER_STAMINA_REFUND,
  COUNTER_WINDOW_MS,
  ATTACK_BUFFER_MS,
  LIGHT_CHAIN_RESET_MS,
  PLAYER_ATTACKS,
  PLAYER_ATTACK_TIMINGS,
  PLAYER_MAX,
  applyDamage,
  applyCounterStaminaRefund,
  chooseBossMove,
  getBossPhase,
  getCounterPosture,
  getBossAttackPhase,
  getNextLightChainStep,
  getPlayerAttackProfile,
  getPlayerAttackTiming,
  isInsideArc,
  isAttackInputBuffered,
  isCounterDodgeCandidate,
  isCounterWindowReady,
  regenerateStamina,
  resetPosture,
  spendStamina
} from "@/src/game/combat";
import { appendTrajectorySample } from "@/src/game/trajectory";
import type { CombatTrajectorySample } from "@/src/game/types";

function sample(overrides: Partial<CombatTrajectorySample>): CombatTrajectorySample {
  return {
    runId: "run_test",
    t: 0,
    status: "running",
    playerHp: 100,
    stamina: 100,
    bossHp: 260,
    bossPosture: 0,
    bossPhase: 1,
    bossMove: "watching",
    bossAttackPhase: "idle",
    playerActionState: "idle",
    dodges: 0,
    light: 0,
    heavy: 0,
    skill: 0,
    hits: 0,
    damageTaken: 0,
    counterWindows: 0,
    counterHits: 0,
    counterReady: false,
    lightChainStep: 0,
    maxLightChain: 0,
    deathReason: null,
    fps: 60,
    ...overrides
  };
}

describe("combat core", () => {
  it("spends and regenerates stamina with action pressure", () => {
    const player = { ...PLAYER_MAX };
    expect(spendStamina(player, 28)).toBe(true);
    expect(player.stamina).toBe(72);

    regenerateStamina(player, 1, true);
    expect(player.stamina).toBe(86);

    regenerateStamina(player, 1, false);
    expect(player.stamina).toBe(100);
  });

  it("does not allow actions when stamina is too low", () => {
    const player = { ...PLAYER_MAX, stamina: 12 };
    expect(spendStamina(player, 28)).toBe(false);
    expect(player.stamina).toBe(12);
  });

  it("resolves forward attack arcs", () => {
    const origin = { x: 100, y: 100 };
    const facing = { x: 1, y: 0 };
    expect(isInsideArc(origin, facing, { x: 170, y: 100 }, 90, 90)).toBe(true);
    expect(isInsideArc(origin, facing, { x: 100, y: 170 }, 90, 90)).toBe(false);
    expect(isInsideArc(origin, facing, { x: 220, y: 100 }, 90, 90)).toBe(false);
  });

  it("keeps the light attack forgiving without becoming unlimited", () => {
    const origin = { x: 100, y: 100 };
    const facing = { x: 1, y: 0 };
    expect(isInsideArc(origin, facing, { x: 100 + PLAYER_ATTACKS.light.range - 1, y: 100 }, PLAYER_ATTACKS.light.range, PLAYER_ATTACKS.light.arcDegrees)).toBe(true);
    expect(isInsideArc(origin, facing, { x: 100 + PLAYER_ATTACKS.light.range + 1, y: 100 }, PLAYER_ATTACKS.light.range, PLAYER_ATTACKS.light.arcDegrees)).toBe(false);
    expect(isInsideArc(origin, facing, { x: 150, y: 190 }, PLAYER_ATTACKS.light.range, PLAYER_ATTACKS.light.arcDegrees)).toBe(false);
  });

  it("adds a distinct skill attack without replacing heavy damage", () => {
    expect(PLAYER_ATTACKS.skill.range).toBeGreaterThan(PLAYER_ATTACKS.heavy.range);
    expect(PLAYER_ATTACKS.skill.arcDegrees).toBeLessThan(PLAYER_ATTACKS.light.arcDegrees);
    expect(PLAYER_ATTACKS.skill.damage).toBeLessThan(PLAYER_ATTACKS.heavy.damage);
    expect(PLAYER_ATTACK_TIMINGS.skill.recoveryMs).toBeLessThan(PLAYER_ATTACK_TIMINGS.heavy.recoveryMs);
  });

  it("buffers attack input briefly without making it permanent", () => {
    expect(isAttackInputBuffered(1000, 1000 + ATTACK_BUFFER_MS)).toBe(true);
    expect(isAttackInputBuffered(1000, 1000 + ATTACK_BUFFER_MS + 1)).toBe(false);
    expect(isAttackInputBuffered(null, 1000)).toBe(false);
  });

  it("advances and resets the light chain deterministically", () => {
    expect(getNextLightChainStep(0, 0, 1000)).toBe(1);
    expect(getNextLightChainStep(1, 1000 + LIGHT_CHAIN_RESET_MS, 1200)).toBe(2);
    expect(getNextLightChainStep(2, 1000 + LIGHT_CHAIN_RESET_MS, 1400)).toBe(3);
    expect(getNextLightChainStep(3, 1000 + LIGHT_CHAIN_RESET_MS, 1500)).toBe(3);
    expect(getNextLightChainStep(2, 1000 + LIGHT_CHAIN_RESET_MS, 1000 + LIGHT_CHAIN_RESET_MS + 1)).toBe(1);
  });

  it("makes the third light a posture finisher without replacing heavy damage", () => {
    const first = getPlayerAttackProfile("light", 1);
    const third = getPlayerAttackProfile("light", 3);

    expect(third.posture).toBeGreaterThan(first.posture);
    expect(third.range).toBeGreaterThan(first.range);
    expect(third.damage).toBeLessThan(PLAYER_ATTACKS.heavy.damage);
    expect(getPlayerAttackTiming("light", 3).recoveryMs).toBeGreaterThan(getPlayerAttackTiming("light", 2).recoveryMs);
  });

  it("classifies boss attack timing into windup, snap, active, and recovery", () => {
    const timing = {
      startedAt: 1000,
      activeAt: 1760,
      endsAt: 1910,
      recoveryEndsAt: 2430
    };

    expect(getBossAttackPhase(timing, 999)).toBe("idle");
    expect(getBossAttackPhase(timing, 1000)).toBe("windup");
    expect(getBossAttackPhase(timing, timing.activeAt - BOSS_SNAP_WINDOW_MS - 1)).toBe("windup");
    expect(getBossAttackPhase(timing, timing.activeAt - BOSS_SNAP_WINDOW_MS)).toBe("snap");
    expect(getBossAttackPhase(timing, 1759)).toBe("snap");
    expect(getBossAttackPhase(timing, 1760)).toBe("active");
    expect(getBossAttackPhase(timing, 1910)).toBe("active");
    expect(getBossAttackPhase(timing, 1911)).toBe("recovery");
    expect(getBossAttackPhase(timing, 2430)).toBe("recovery");
    expect(getBossAttackPhase(timing, 2431)).toBe("idle");
  });

  it("detects exact and narrow near-miss counter dodge candidates", () => {
    const origin = { x: 100, y: 100 };
    const facing = { x: 1, y: 0 };

    expect(isCounterDodgeCandidate(origin, facing, { x: 170, y: 100 }, 90, 90)).toBe(true);
    expect(isCounterDodgeCandidate(origin, facing, { x: 159, y: 168 }, 90, 90)).toBe(true);
    expect(isCounterDodgeCandidate(origin, facing, { x: 240, y: 100 }, 90, 90)).toBe(false);
    expect(isCounterDodgeCandidate(origin, facing, { x: 100, y: 218 }, 90, 90)).toBe(false);
  });

  it("expires counter windows at the configured timing boundary", () => {
    expect(isCounterWindowReady(1000 + COUNTER_WINDOW_MS, 1000 + COUNTER_WINDOW_MS)).toBe(true);
    expect(isCounterWindowReady(1000 + COUNTER_WINDOW_MS, 1000 + COUNTER_WINDOW_MS + 1)).toBe(false);
  });

  it("adds counter posture without changing hp damage math", () => {
    const boss = { ...BOSS_MAX };
    const posture = getCounterPosture(PLAYER_ATTACKS.light.posture, true);

    applyDamage(boss, PLAYER_ATTACKS.light.damage, posture);

    expect(posture).toBe(PLAYER_ATTACKS.light.posture + COUNTER_POSTURE_BONUS);
    expect(boss.hp).toBe(BOSS_MAX.hp - PLAYER_ATTACKS.light.damage);
    expect(getCounterPosture(PLAYER_ATTACKS.light.posture, false)).toBe(PLAYER_ATTACKS.light.posture);
  });

  it("refunds stamina on counter without exceeding max stamina", () => {
    const player = { ...PLAYER_MAX, stamina: 70 };
    expect(applyCounterStaminaRefund(player, true)).toBe(COUNTER_STAMINA_REFUND);
    expect(player.stamina).toBe(88);
    expect(applyCounterStaminaRefund(player, false)).toBe(0);
    expect(player.stamina).toBe(88);
    expect(applyCounterStaminaRefund(player, true)).toBe(12);
    expect(player.stamina).toBe(100);
  });

  it("moves the boss into pressure phase after time or counter success", () => {
    expect(getBossPhase(BOSS_MAX.hp, BOSS_MAX.maxHp, BOSS_PRESSURE_PHASE_MS - 1, 0)).toBe(1);
    expect(getBossPhase(BOSS_MAX.hp, BOSS_MAX.maxHp, BOSS_PRESSURE_PHASE_MS, 0)).toBe(2);
    expect(getBossPhase(BOSS_MAX.hp, BOSS_MAX.maxHp, 1000, 1)).toBe(2);
    expect(getBossPhase(BOSS_MAX.maxHp * 0.5, BOSS_MAX.maxHp, 1000, 0)).toBe(2);
  });

  it("applies damage and posture break reset", () => {
    const boss = { ...BOSS_MAX };
    applyDamage(boss, 34, 150);
    expect(boss.hp).toBe(226);
    expect(boss.posture).toBe(boss.maxPosture);
    resetPosture(boss);
    expect(boss.posture).toBe(0);
  });

  it("chooses a lunge when the player is far away", () => {
    expect(chooseBossMove(320, 1, 1)).toBe("delayed-lunge");
  });

  it("uses a tighter phase two pattern near the player", () => {
    expect(chooseBossMove(140, 2, 2)).toBe("ash-slam");
    expect(chooseBossMove(140, 2, 3)).toBe("grave-sweep");
  });

  it("keeps pre-death trajectory samples after terminal snapshots repeat", () => {
    let history: CombatTrajectorySample[] = [];
    history = appendTrajectorySample(history, sample({ t: 75_000, light: 12, hits: 4 }));
    history = appendTrajectorySample(history, sample({ t: 76_000, light: 13, hits: 5 }));
    history = appendTrajectorySample(
      history,
      sample({
        t: 88_000,
        status: "dead",
        playerHp: 0,
        bossMove: "grave-sweep",
        bossAttackPhase: "active",
        damageTaken: 110,
        deathReason: "grave-sweep"
      })
    );
    history = appendTrajectorySample(
      history,
      sample({
        t: 100_000,
        status: "dead",
        playerHp: 0,
        bossMove: "grave-sweep",
        damageTaken: 110,
        deathReason: "grave-sweep"
      })
    );

    expect(history.map((item) => item.t)).toEqual([76_000, 88_000]);
    expect(history.at(-1)?.bossAttackPhase).toBe("active");
  });
});
