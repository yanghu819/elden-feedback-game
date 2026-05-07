import { describe, expect, it } from "vitest";
import {
  BOSS_SNAP_WINDOW_MS,
  BOSS_MAX,
  PLAYER_ATTACKS,
  PLAYER_MAX,
  applyDamage,
  chooseBossMove,
  getBossAttackPhase,
  isInsideArc,
  regenerateStamina,
  resetPosture,
  spendStamina
} from "@/src/game/combat";

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
});
