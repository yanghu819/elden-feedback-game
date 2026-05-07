import { describe, expect, it } from "vitest";
import { buildFeedbackIssueBody } from "@/src/server/github";
import type { FeedbackPayload } from "@/src/game/types";

const payload: FeedbackPayload = {
  message: "Boss hit felt late",
  route: "/",
  createdAt: "2026-05-07T00:00:00.000Z",
  context: {
    runId: "run_test",
    status: "dead",
    elapsedMs: 8200,
    releaseSha: "test-sha",
    bossAttackPhase: "active",
    playerActionState: "idle",
    player: {
      hp: 0,
      maxHp: 100,
      stamina: 42,
      maxStamina: 100,
      posture: 0,
      maxPosture: 100
    },
    boss: {
      hp: 180,
      maxHp: 260,
      stamina: 0,
      maxStamina: 0,
      posture: 64,
      maxPosture: 140,
      phase: 2,
      move: "grave-sweep"
    },
    metrics: {
      fps: 60,
      dodgeCount: 1,
      lightThrown: 1,
      heavyThrown: 0,
      skillThrown: 1,
      hitsLanded: 1,
      damageTaken: 22,
      counterWindows: 1,
      counterHits: 1,
      counterReady: false,
      lastDeathReason: "grave-sweep"
    }
  },
  trajectory: [
    {
      runId: "run_test",
      t: 7000,
      status: "running",
      playerHp: 22,
      stamina: 84,
      bossHp: 202,
      bossPosture: 32,
      bossPhase: 2,
      bossMove: "grave-sweep",
      bossAttackPhase: "windup",
      playerActionState: "moving",
      dodges: 0,
      light: 1,
      heavy: 0,
      skill: 0,
      hits: 1,
      damageTaken: 0,
      counterWindows: 0,
      counterHits: 0,
      counterReady: false,
      deathReason: null,
      fps: 60
    },
    {
      runId: "run_test",
      t: 7350,
      status: "running",
      playerHp: 22,
      stamina: 42,
      bossHp: 180,
      bossPosture: 64,
      bossPhase: 2,
      bossMove: "grave-sweep",
      bossAttackPhase: "snap",
      playerActionState: "skill",
      dodges: 0,
      light: 1,
      heavy: 0,
      skill: 1,
      hits: 1,
      damageTaken: 0,
      counterWindows: 0,
      counterHits: 0,
      counterReady: false,
      deathReason: null,
      fps: 60
    },
    {
      runId: "run_test",
      t: 7800,
      status: "running",
      playerHp: 22,
      stamina: 48,
      bossHp: 180,
      bossPosture: 64,
      bossPhase: 2,
      bossMove: "grave-sweep",
      bossAttackPhase: "active",
      playerActionState: "dodging",
      dodges: 1,
      light: 1,
      heavy: 0,
      skill: 1,
      hits: 1,
      damageTaken: 0,
      counterWindows: 1,
      counterHits: 0,
      counterReady: true,
      deathReason: null,
      fps: 60
    },
    {
      runId: "run_test",
      t: 8200,
      status: "dead",
      playerHp: 0,
      stamina: 52,
      bossHp: 180,
      bossPosture: 64,
      bossPhase: 2,
      bossMove: "grave-sweep",
      bossAttackPhase: "active",
      playerActionState: "idle",
      dodges: 1,
      light: 1,
      heavy: 0,
      skill: 1,
      hits: 1,
      damageTaken: 22,
      counterWindows: 1,
      counterHits: 1,
      counterReady: false,
      deathReason: "grave-sweep",
      fps: 60
    }
  ]
};

describe("feedback issue body", () => {
  it("includes combat phase, player action, and skill context", () => {
    const body = buildFeedbackIssueBody(payload);

    expect(body).toContain("- boss_attack_phase: active");
    expect(body).toContain("- player_action_state: idle");
    expect(body).toContain("- attacks: light=1, heavy=0, skill=1, hits=1");
    expect(body).toContain("- counters: windows=1, hits=1, ready=no");
    expect(body).toContain("damage during grave-sweep/active");
    expect(body).toContain("dodge during grave-sweep/active");
    expect(body).toContain("skill=1, player state skill");
    expect(body).toContain("counter window armed during grave-sweep/active");
    expect(body).toContain("counter hit landed");
    expect(body).toContain("| t(ms) | status | player HP | stamina | boss HP | boss move | boss phase | player state | dodges | light | heavy | skill | hits | damage | counter ready | counter windows | counter hits |");
  });
});
