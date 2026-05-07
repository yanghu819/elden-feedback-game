"use client";

import { useEffect, useMemo, useState } from "react";
import type { CombatSnapshot, FeedbackPayload } from "@/src/game/types";

const emptySnapshot: CombatSnapshot = {
  runId: "boot",
  status: "loading",
  elapsedMs: 0,
  releaseSha: "local",
  player: {
    hp: 100,
    maxHp: 100,
    stamina: 100,
    maxStamina: 100,
    posture: 0,
    maxPosture: 100
  },
  boss: {
    hp: 260,
    maxHp: 260,
    stamina: 0,
    maxStamina: 0,
    posture: 0,
    maxPosture: 140,
    phase: 1,
    move: "watching"
  },
  metrics: {
    fps: 60,
    dodgeCount: 0,
    lightThrown: 0,
    heavyThrown: 0,
    hitsLanded: 0,
    damageTaken: 0,
    lastDeathReason: null
  }
};

function percent(value: number, max: number) {
  return `${Math.max(0, Math.min(100, (value / max) * 100)).toFixed(1)}%`;
}

function formatSeconds(ms: number) {
  return `${Math.floor(ms / 1000)}s`;
}

export default function GameExperience() {
  const [snapshot, setSnapshot] = useState<CombatSnapshot>(emptySnapshot);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let disposeGame: (() => void) | undefined;
    let mounted = true;

    const onSnapshot = (event: Event) => {
      const detail = (event as CustomEvent<CombatSnapshot>).detail;
      setSnapshot(detail);
    };

    window.addEventListener("boss-duel:snapshot", onSnapshot);
    window.addEventListener("boss-duel:feedback", () => setFeedbackOpen(true));

    import("@/src/game/mountBossDuel").then(({ mountBossDuel }) => {
      if (mounted) {
        disposeGame = mountBossDuel("game-root");
      }
    });

    return () => {
      mounted = false;
      window.removeEventListener("boss-duel:snapshot", onSnapshot);
      disposeGame?.();
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const statusText = useMemo(() => {
    if (snapshot.status === "loading") return "Loading arena";
    if (snapshot.status === "dead") return "You died";
    if (snapshot.status === "victory") return "Boss felled";
    if (snapshot.status === "paused") return "Paused";
    return "";
  }, [snapshot.status]);

  async function submitFeedback() {
    const trimmed = message.trim();
    if (!trimmed) return;

    const payload: FeedbackPayload = {
      message: trimmed,
      context: snapshot,
      route: "/",
      createdAt: new Date().toISOString()
    };

    setSubmitting(true);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = (await response.json()) as { issueUrl?: string; message?: string };
      if (!response.ok) {
        throw new Error(result.message || "Feedback failed");
      }
      setMessage("");
      setFeedbackOpen(false);
      setToast(result.issueUrl ? `Issue created: ${result.issueUrl}` : "Feedback captured");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Feedback failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="game-page">
      <div id="game-root" className="game-stage" />

      <section className="hud" aria-live="polite">
        <div className="top-row">
          <div className="stat-stack">
            <div className="name-row">
              <span>Warden</span>
              <span>{Math.ceil(snapshot.player.hp)} / {snapshot.player.maxHp}</span>
            </div>
            <div className="bar" aria-label="player health">
              <div className="bar-fill hp" style={{ "--value": percent(snapshot.player.hp, snapshot.player.maxHp) } as React.CSSProperties} />
            </div>
            <div className="bar" aria-label="player stamina">
              <div className="bar-fill stamina" style={{ "--value": percent(snapshot.player.stamina, snapshot.player.maxStamina) } as React.CSSProperties} />
            </div>
            <div className="metric-row">
              <span>Dodges {snapshot.metrics.dodgeCount}</span>
              <span>Hits {snapshot.metrics.hitsLanded}</span>
              <span>FPS {Math.round(snapshot.metrics.fps)}</span>
            </div>
          </div>

          <div className="stat-stack boss-stack">
            <div className="name-row">
              <span>Ashen Magistrate</span>
              <span>Phase {snapshot.boss.phase}</span>
            </div>
            <div className="bar" aria-label="boss health">
              <div className="bar-fill boss-hp" style={{ "--value": percent(snapshot.boss.hp, snapshot.boss.maxHp) } as React.CSSProperties} />
            </div>
            <div className="bar" aria-label="boss posture">
              <div className="bar-fill boss-posture" style={{ "--value": percent(snapshot.boss.posture, snapshot.boss.maxPosture) } as React.CSSProperties} />
            </div>
            <div className="metric-row">
              <span>{snapshot.boss.move}</span>
              <span>{formatSeconds(snapshot.elapsedMs)}</span>
            </div>
          </div>
        </div>

        {statusText ? (
          <div className="status-line">
            {statusText}
            <span>{snapshot.status === "dead" ? "Press R to retry" : "Press R to fight again"}</span>
          </div>
        ) : (
          <div />
        )}

        <div className="bottom-row">
          <div className="hint-row">
            <span className="key">WASD move</span>
            <span className="key">Mouse aim</span>
            <span className="key">LMB light</span>
            <span className="key">RMB heavy</span>
            <span className="key">Space dodge</span>
            <span className="key">R retry</span>
            <span className="key">H hitboxes</span>
          </div>
          <button className="feedback-button" type="button" onClick={() => setFeedbackOpen(true)}>
            Feedback
          </button>
        </div>
      </section>

      {feedbackOpen ? (
        <div className="modal-backdrop">
          <section className="feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
            <div className="modal-header">
              <h2 id="feedback-title">Combat feedback</h2>
              <button type="button" aria-label="Close feedback" onClick={() => setFeedbackOpen(false)}>
                x
              </button>
            </div>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={1000}
              placeholder="What felt unfair, boring, confusing, or satisfying?"
            />
            <p className="modal-note">
              Sends your text plus anonymous combat metrics: version, run time, death reason, boss move stats, FPS, and damage summary.
            </p>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setFeedbackOpen(false)}>
                Cancel
              </button>
              <button className="primary-button" type="button" disabled={submitting || !message.trim()} onClick={submitFeedback}>
                {submitting ? "Sending..." : "Send feedback"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </main>
  );
}
