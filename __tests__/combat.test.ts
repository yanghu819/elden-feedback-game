import { describe, expect, it } from "vitest";
import {
  BOSS_MAX,
  PLAYER_MAX,
  applyDamage,
  chooseBossMove,
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
