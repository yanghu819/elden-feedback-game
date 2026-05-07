import Phaser from "phaser";
import {
  ARENA,
  BOSS_MAX,
  BOSS_MOVES,
  PLAYER_MAX,
  applyDamage,
  chooseBossMove,
  clampToArena,
  directionTo,
  distance,
  isInsideArc,
  makeRunId,
  normalize,
  regenerateStamina,
  resetPosture,
  spendStamina
} from "./combat";
import type { ActorVitals, BossMoveId, CombatRunSummary, CombatSnapshot, Vec2 } from "./types";

type AttackKind = "light" | "heavy";

type PlayerAttack = {
  kind: AttackKind;
  activeAt: number;
  endsAt: number;
  recoveryEndsAt: number;
  resolved: boolean;
};

type BossAttack = {
  id: Exclude<BossMoveId, "watching" | "broken">;
  startedAt: number;
  activeAt: number;
  endsAt: number;
  recoveryEndsAt: number;
  facing: Vec2;
  hitResolved: boolean;
  lunged: boolean;
};

type Fighter = {
  position: Vec2;
  facing: Vec2;
  vitals: ActorVitals;
};

type RunStats = {
  dodgeCount: number;
  lightThrown: number;
  heavyThrown: number;
  hitsLanded: number;
  damageTaken: number;
  lastDeathReason: string | null;
  bossMoveUses: Record<string, number>;
  bossMoveHits: Record<string, number>;
};

const RELEASE_SHA = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "local";

export class BossDuelScene extends Phaser.Scene {
  private arena!: Phaser.GameObjects.Graphics;
  private telegraphs!: Phaser.GameObjects.Graphics;
  private actors!: Phaser.GameObjects.Graphics;
  private effects!: Phaser.GameObjects.Graphics;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private player!: Fighter;
  private boss!: Fighter;
  private runId = makeRunId();
  private runStartedAt = 0;
  private status: CombatSnapshot["status"] = "loading";
  private playerAttack: PlayerAttack | null = null;
  private bossAttack: BossAttack | null = null;
  private dodgeEndsAt = 0;
  private invulnerableUntil = 0;
  private nextBossDecisionAt = 0;
  private bossMoveIndex = 0;
  private debugHitboxes = false;
  private stats!: RunStats;
  private fps = 60;
  private telemetrySent = false;

  constructor() {
    super("BossDuelScene");
  }

  create() {
    this.arena = this.add.graphics();
    this.telegraphs = this.add.graphics();
    this.actors = this.add.graphics();
    this.effects = this.add.graphics();
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,SPACE,SHIFT,R,H,F") as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.mouse?.disableContextMenu();
    this.restartRun();
  }

  update(time: number, delta: number) {
    const dt = Math.min(delta / 1000, 0.05);
    this.fps = this.fps * 0.92 + (1000 / Math.max(1, delta)) * 0.08;

    if (Phaser.Input.Keyboard.JustDown(this.keys.F)) {
      window.dispatchEvent(new CustomEvent("boss-duel:feedback"));
    }

    if (Phaser.Input.Keyboard.JustDown(this.keys.H)) {
      this.debugHitboxes = !this.debugHitboxes;
    }

    if ((this.status === "dead" || this.status === "victory") && Phaser.Input.Keyboard.JustDown(this.keys.R)) {
      this.restartRun();
      return;
    }

    if (this.status !== "running") {
      this.draw(time);
      this.publishSnapshot(time);
      return;
    }

    this.updatePlayer(time, dt);
    this.updateBoss(time, dt);
    this.resolvePlayerAttack(time);
    this.resolveBossAttack(time);
    this.checkEndState(time);
    this.draw(time);
    this.publishSnapshot(time);
  }

  private restartRun() {
    this.player = {
      position: { x: 360, y: ARENA.height / 2 },
      facing: { x: 1, y: 0 },
      vitals: { ...PLAYER_MAX }
    };
    this.boss = {
      position: { x: 820, y: ARENA.height / 2 },
      facing: { x: -1, y: 0 },
      vitals: { ...BOSS_MAX }
    };
    this.runId = makeRunId();
    this.runStartedAt = this.time.now;
    this.status = "running";
    this.playerAttack = null;
    this.bossAttack = null;
    this.dodgeEndsAt = 0;
    this.invulnerableUntil = 0;
    this.nextBossDecisionAt = this.time.now + 900;
    this.bossMoveIndex = 0;
    this.telemetrySent = false;
    this.stats = {
      dodgeCount: 0,
      lightThrown: 0,
      heavyThrown: 0,
      hitsLanded: 0,
      damageTaken: 0,
      lastDeathReason: null,
      bossMoveUses: {},
      bossMoveHits: {}
    };
  }

  private updatePlayer(time: number, dt: number) {
    const pointer = this.input.activePointer;
    const pointerWorld = this.scalePointer(pointer);
    this.player.facing = directionTo(this.player.position, pointerWorld);

    const attacking = Boolean(this.playerAttack && time < this.playerAttack.recoveryEndsAt);
    const dodging = time < this.dodgeEndsAt;
    regenerateStamina(this.player.vitals, dt, attacking || dodging);

    if (!attacking && !dodging) {
      const move = normalize({
        x: Number(this.keys.D.isDown) - Number(this.keys.A.isDown),
        y: Number(this.keys.S.isDown) - Number(this.keys.W.isDown)
      });
      const hasMoveInput = this.keys.W.isDown || this.keys.A.isDown || this.keys.S.isDown || this.keys.D.isDown;
      if (hasMoveInput) {
        this.player.position = clampToArena({
          x: this.player.position.x + move.x * 235 * dt,
          y: this.player.position.y + move.y * 235 * dt
        });
      }
    }

    if (!attacking && (Phaser.Input.Keyboard.JustDown(this.keys.SPACE) || Phaser.Input.Keyboard.JustDown(this.keys.SHIFT))) {
      if (spendStamina(this.player.vitals, 28)) {
        this.stats.dodgeCount += 1;
        this.dodgeEndsAt = time + 230;
        this.invulnerableUntil = time + 210;
        const dodgeDirection = this.getMoveDirection();
        this.player.position = clampToArena({
          x: this.player.position.x + dodgeDirection.x * 96,
          y: this.player.position.y + dodgeDirection.y * 96
        });
      }
    }

    if (!attacking && !dodging && pointer.leftButtonDown()) {
      this.startPlayerAttack("light", time);
    }

    if (!attacking && !dodging && pointer.rightButtonDown()) {
      this.startPlayerAttack("heavy", time);
    }
  }

  private updateBoss(time: number, dt: number) {
    this.boss.facing = directionTo(this.boss.position, this.player.position);
    const phase: 1 | 2 = this.boss.vitals.hp <= this.boss.vitals.maxHp * 0.5 ? 2 : 1;
    const speed = phase === 2 ? 84 : 66;

    if (!this.bossAttack && time >= this.nextBossDecisionAt) {
      const move = chooseBossMove(distance(this.boss.position, this.player.position), phase, this.bossMoveIndex);
      this.startBossAttack(move, time);
      this.bossMoveIndex += 1;
    }

    if (!this.bossAttack) {
      const dist = distance(this.boss.position, this.player.position);
      if (dist > 174) {
        this.boss.position = clampToArena({
          x: this.boss.position.x + this.boss.facing.x * speed * dt,
          y: this.boss.position.y + this.boss.facing.y * speed * dt
        });
      } else if (dist < 104) {
        this.boss.position = clampToArena({
          x: this.boss.position.x - this.boss.facing.x * speed * 0.45 * dt,
          y: this.boss.position.y - this.boss.facing.y * speed * 0.45 * dt
        });
      }
    }

    if (this.bossAttack && time >= this.bossAttack.activeAt && !this.bossAttack.lunged && this.bossAttack.id === "delayed-lunge") {
      this.bossAttack.lunged = true;
      this.boss.position = clampToArena({
        x: this.boss.position.x + this.bossAttack.facing.x * 118,
        y: this.boss.position.y + this.bossAttack.facing.y * 118
      });
    }

    if (this.bossAttack && time >= this.bossAttack.recoveryEndsAt) {
      this.bossAttack = null;
      this.nextBossDecisionAt = time + (phase === 2 ? 460 : 680);
    }
  }

  private startPlayerAttack(kind: AttackKind, time: number) {
    const heavy = kind === "heavy";
    const cost = heavy ? 34 : 18;
    if (!spendStamina(this.player.vitals, cost)) return;
    if (heavy) this.stats.heavyThrown += 1;
    else this.stats.lightThrown += 1;
    this.playerAttack = {
      kind,
      activeAt: time + (heavy ? 250 : 130),
      endsAt: time + (heavy ? 365 : 230),
      recoveryEndsAt: time + (heavy ? 640 : 390),
      resolved: false
    };
  }

  private startBossAttack(id: Exclude<BossMoveId, "watching" | "broken">, time: number) {
    const move = BOSS_MOVES[id];
    this.stats.bossMoveUses[id] = (this.stats.bossMoveUses[id] || 0) + 1;
    this.bossAttack = {
      id,
      startedAt: time,
      activeAt: time + move.telegraphMs,
      endsAt: time + move.telegraphMs + move.activeMs,
      recoveryEndsAt: time + move.telegraphMs + move.activeMs + move.recoveryMs,
      facing: this.boss.facing,
      hitResolved: false,
      lunged: false
    };
  }

  private resolvePlayerAttack(time: number) {
    if (!this.playerAttack) return;
    if (time >= this.playerAttack.activeAt && time <= this.playerAttack.endsAt && !this.playerAttack.resolved) {
      const heavy = this.playerAttack.kind === "heavy";
      const hit = isInsideArc(
        this.player.position,
        this.player.facing,
        this.boss.position,
        heavy ? 108 : 86,
        heavy ? 86 : 118
      );
      this.playerAttack.resolved = true;
      if (hit) {
        this.stats.hitsLanded += 1;
        applyDamage(this.boss.vitals, heavy ? 34 : 16, heavy ? 46 : 24);
        if (this.boss.vitals.posture >= this.boss.vitals.maxPosture) {
          applyDamage(this.boss.vitals, 42, 0);
          resetPosture(this.boss.vitals);
          this.bossAttack = null;
          this.nextBossDecisionAt = time + 1080;
        }
      }
    }

    if (time >= this.playerAttack.recoveryEndsAt) {
      this.playerAttack = null;
    }
  }

  private resolveBossAttack(time: number) {
    if (!this.bossAttack || this.bossAttack.hitResolved) return;
    if (time < this.bossAttack.activeAt || time > this.bossAttack.endsAt) return;

    const move = BOSS_MOVES[this.bossAttack.id];
    const hit = isInsideArc(this.boss.position, this.bossAttack.facing, this.player.position, move.range, move.arcDegrees);
    this.bossAttack.hitResolved = true;
    if (hit && time > this.invulnerableUntil) {
      applyDamage(this.player.vitals, move.damage, move.posture);
      this.stats.damageTaken += move.damage;
      this.stats.lastDeathReason = this.bossAttack.id;
      this.stats.bossMoveHits[this.bossAttack.id] = (this.stats.bossMoveHits[this.bossAttack.id] || 0) + 1;
    }
  }

  private checkEndState(time: number) {
    if (this.player.vitals.hp <= 0) {
      this.status = "dead";
      this.sendTelemetry("death", time);
    }
    if (this.boss.vitals.hp <= 0) {
      this.status = "victory";
      this.sendTelemetry("victory", time);
    }
  }

  private draw(time: number) {
    this.drawArena();
    this.drawTelegraphs(time);
    this.drawActors(time);
  }

  private drawArena() {
    this.arena.clear();
    this.arena.fillStyle(0x151816, 1);
    this.arena.fillRect(0, 0, ARENA.width, ARENA.height);
    this.arena.lineStyle(2, 0x5d6b5a, 0.7);
    this.arena.strokeRect(ARENA.margin, ARENA.margin, ARENA.width - ARENA.margin * 2, ARENA.height - ARENA.margin * 2);
    this.arena.lineStyle(1, 0x2f3831, 0.75);
    for (let x = 120; x < ARENA.width; x += 120) {
      this.arena.lineBetween(x, ARENA.margin, x, ARENA.height - ARENA.margin);
    }
    for (let y = 120; y < ARENA.height; y += 120) {
      this.arena.lineBetween(ARENA.margin, y, ARENA.width - ARENA.margin, y);
    }
    this.arena.fillStyle(0x20251f, 1);
    this.arena.fillCircle(ARENA.width / 2, ARENA.height / 2, 126);
    this.arena.lineStyle(1, 0x7d714f, 0.35);
    this.arena.strokeCircle(ARENA.width / 2, ARENA.height / 2, 126);
  }

  private drawTelegraphs(time: number) {
    this.telegraphs.clear();
    if (!this.bossAttack) return;

    const move = BOSS_MOVES[this.bossAttack.id];
    const active = time >= this.bossAttack.activeAt && time <= this.bossAttack.endsAt;
    const charge = Math.min(1, Math.max(0, (time - this.bossAttack.startedAt) / (this.bossAttack.activeAt - this.bossAttack.startedAt)));
    const color = active ? 0xffd267 : 0xc34b3d;
    const alpha = active ? 0.32 : 0.13 + charge * 0.18;

    this.telegraphs.fillStyle(color, alpha);
    if (move.arcDegrees >= 360) {
      this.telegraphs.fillCircle(this.boss.position.x, this.boss.position.y, move.range);
    } else {
      const facingAngle = Math.atan2(this.bossAttack.facing.y, this.bossAttack.facing.x);
      const half = (move.arcDegrees * Math.PI) / 360;
      this.telegraphs.slice(this.boss.position.x, this.boss.position.y, move.range, facingAngle - half, facingAngle + half, false);
      this.telegraphs.lineTo(this.boss.position.x, this.boss.position.y);
      this.telegraphs.closePath();
      this.telegraphs.fillPath();
    }

    if (this.debugHitboxes) {
      this.telegraphs.lineStyle(2, 0xffd267, 0.8);
      this.telegraphs.strokeCircle(this.boss.position.x, this.boss.position.y, move.range);
    }
  }

  private drawActors(time: number) {
    this.actors.clear();
    this.effects.clear();

    const invulnerable = time < this.invulnerableUntil;
    this.actors.fillStyle(invulnerable ? 0x8bd8d2 : 0xd8d2be, 1);
    this.actors.fillCircle(this.player.position.x, this.player.position.y, 19);
    this.actors.lineStyle(3, 0x1b1f1c, 1);
    this.actors.lineBetween(
      this.player.position.x,
      this.player.position.y,
      this.player.position.x + this.player.facing.x * 31,
      this.player.position.y + this.player.facing.y * 31
    );

    if (this.playerAttack) {
      const heavy = this.playerAttack.kind === "heavy";
      const windup = time < this.playerAttack.activeAt;
      this.effects.lineStyle(heavy ? 7 : 5, windup ? 0x8d7660 : 0xe8d38a, windup ? 0.5 : 0.88);
      this.effects.lineBetween(
        this.player.position.x,
        this.player.position.y,
        this.player.position.x + this.player.facing.x * (heavy ? 94 : 74),
        this.player.position.y + this.player.facing.y * (heavy ? 94 : 74)
      );
    }

    const phaseTwo = this.boss.vitals.hp <= this.boss.vitals.maxHp * 0.5;
    this.actors.fillStyle(phaseTwo ? 0x6d2631 : 0x443d39, 1);
    this.actors.fillCircle(this.boss.position.x, this.boss.position.y, 35);
    this.actors.fillStyle(0xd8b25e, 0.95);
    this.actors.fillCircle(
      this.boss.position.x + this.boss.facing.x * 17,
      this.boss.position.y + this.boss.facing.y * 17,
      7
    );
    this.actors.lineStyle(4, 0x151816, 1);
    this.actors.strokeCircle(this.boss.position.x, this.boss.position.y, 35);

    if (this.debugHitboxes) {
      this.actors.lineStyle(1, 0x8bd8d2, 0.9);
      this.actors.strokeCircle(this.player.position.x, this.player.position.y, 19);
      this.actors.lineStyle(1, 0xffd267, 0.9);
      this.actors.strokeCircle(this.boss.position.x, this.boss.position.y, 35);
    }
  }

  private publishSnapshot(time: number) {
    window.dispatchEvent(
      new CustomEvent<CombatSnapshot>("boss-duel:snapshot", {
        detail: this.snapshot(time)
      })
    );
  }

  private snapshot(time: number): CombatSnapshot {
    return {
      runId: this.runId,
      status: this.status,
      elapsedMs: Math.max(0, time - this.runStartedAt),
      releaseSha: RELEASE_SHA,
      player: {
        hp: this.player.vitals.hp,
        maxHp: this.player.vitals.maxHp,
        stamina: this.player.vitals.stamina,
        maxStamina: this.player.vitals.maxStamina,
        posture: this.player.vitals.posture,
        maxPosture: this.player.vitals.maxPosture
      },
      boss: {
        hp: this.boss.vitals.hp,
        maxHp: this.boss.vitals.maxHp,
        stamina: 0,
        maxStamina: 0,
        posture: this.boss.vitals.posture,
        maxPosture: this.boss.vitals.maxPosture,
        phase: this.boss.vitals.hp <= this.boss.vitals.maxHp * 0.5 ? 2 : 1,
        move: this.bossAttack?.id || "watching"
      },
      metrics: {
        fps: this.fps,
        dodgeCount: this.stats.dodgeCount,
        lightThrown: this.stats.lightThrown,
        heavyThrown: this.stats.heavyThrown,
        hitsLanded: this.stats.hitsLanded,
        damageTaken: this.stats.damageTaken,
        lastDeathReason: this.stats.lastDeathReason
      }
    };
  }

  private sendTelemetry(event: CombatRunSummary["event"], time: number) {
    if (this.telemetrySent) return;
    this.telemetrySent = true;
    const payload: CombatRunSummary = {
      ...this.snapshot(time),
      event,
      bossMoveUses: this.stats.bossMoveUses,
      bossMoveHits: this.stats.bossMoveHits
    };
    const body = JSON.stringify(payload);
    const blob = new Blob([body], { type: "application/json" });
    if (!navigator.sendBeacon("/api/telemetry", blob)) {
      fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true
      }).catch(() => undefined);
    }
  }

  private getMoveDirection() {
    const move = {
      x: Number(this.keys.D.isDown) - Number(this.keys.A.isDown),
      y: Number(this.keys.S.isDown) - Number(this.keys.W.isDown)
    };
    if (move.x === 0 && move.y === 0) return this.player.facing;
    return normalize(move);
  }

  private scalePointer(pointer: Phaser.Input.Pointer): Vec2 {
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const source = pointer.event && "clientX" in pointer.event ? pointer.event : null;
    const clientX = source?.clientX ?? pointer.x;
    const clientY = source?.clientY ?? pointer.y;
    const x = (clientX - rect.left) * (ARENA.width / rect.width);
    const y = (clientY - rect.top) * (ARENA.height / rect.height);
    return { x, y };
  }
}
