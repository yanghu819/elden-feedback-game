import { NextResponse } from "next/server";
import type { CombatRunSummary } from "@/src/game/types";

export async function POST(request: Request) {
  let payload: CombatRunSummary;
  try {
    payload = (await request.json()) as CombatRunSummary;
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 });
  }

  if (!payload.runId || !payload.event || !payload.metrics) {
    return NextResponse.json({ message: "Invalid telemetry payload." }, { status: 400 });
  }

  console.info("combat telemetry", {
    runId: payload.runId,
    event: payload.event,
    releaseSha: payload.releaseSha,
    elapsedMs: Math.round(payload.elapsedMs),
    status: payload.status,
    bossAttackPhase: payload.bossAttackPhase,
    playerActionState: payload.playerActionState,
    lastDeathReason: payload.metrics.lastDeathReason,
    dodgeCount: payload.metrics.dodgeCount,
    hitsLanded: payload.metrics.hitsLanded,
    skillThrown: payload.metrics.skillThrown,
    counterWindows: payload.metrics.counterWindows,
    counterHits: payload.metrics.counterHits,
    counterReady: payload.metrics.counterReady,
    damageTaken: payload.metrics.damageTaken
  });

  return NextResponse.json({ ok: true });
}
