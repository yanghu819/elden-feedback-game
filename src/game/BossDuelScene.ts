import Phaser from "phaser";
import {
  ARENA,
  BOSS_MAX,
  BOSS_MOVES,
  COUNTER_STAGGER_MS,
  COUNTER_WINDOW_MS,
  PLAYER_ATTACKS,
  PLAYER_ATTACK_TIMINGS,
  PLAYER_MAX,
  applyDamage,
  applyCounterStaminaRefund,
  chooseBossMove,
  clampToArena,
  directionTo,
  distance,
  getBossPhase,
  getCounterPosture,
  getBossAttackPhase,
  isCounterDodgeCandidate,
  isInsideArc,
  isCounterWindowReady,
  makeRunId,
  normalize,
  regenerateStamina,
  resetPosture,
  spendStamina
} from "./combat";
import type { PlayerAttackKind } from "./combat";
import type { ActorVitals, BossAttackPhase, BossMoveId, CombatRunSummary, CombatSnapshot, PlayerActionState, Vec2 } from "./types";

type PlayerAttack = {
  kind: PlayerAttackKind;
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

type ImpactFx = {
  position: Vec2;
  startedAt: number;
  durationMs: number;
  color: number;
  radius: number;
  label: "player-hit" | "skill-hit" | "counter-hit" | "player-damaged" | "posture-break";
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
  skillThrown: number;
  hitsLanded: number;
  damageTaken: number;
  counterWindows: number;
  counterHits: number;
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
  private impactFx: ImpactFx[] = [];
  private hitStopUntil = 0;
  private counterUntil = 0;
  private counterAwardedForAttack: BossAttack | null = null;
  private counterFlashUntil = 0;
  private lastBossPhase: 1 | 2 = 1;
  private phaseSurgeUntil = 0;

  constructor() {
    super("BossDuelScene");
  }

  create() {
    this.arena = this.add.graphics();
    this.telegraphs = this.add.graphics();
    this.actors = this.add.graphics();
    this.effects = this.add.graphics();
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,SPACE,SHIFT,R,H,F,E,J,K") as Record<string, Phaser.Input.Keyboard.Key>;
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

    if (time < this.hitStopUntil) {
      this.draw(time);
      this.publishSnapshot(time);
      return;
    }

    this.updatePlayer(time, dt);
    this.updateBoss(time, dt);
    this.updateCounterWindow(time);
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
    this.impactFx = [];
    this.hitStopUntil = 0;
    this.counterUntil = 0;
    this.counterAwardedForAttack = null;
    this.counterFlashUntil = 0;
    this.lastBossPhase = 1;
    this.phaseSurgeUntil = 0;
    this.stats = {
      dodgeCount: 0,
      lightThrown: 0,
      heavyThrown: 0,
      skillThrown: 0,
      hitsLanded: 0,
      damageTaken: 0,
      counterWindows: 0,
      counterHits: 0,
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

    if (!attacking && !dodging) {
      if (Phaser.Input.Keyboard.JustDown(this.keys.E)) {
        this.startPlayerAttack("skill", time);
      } else if (Phaser.Input.Keyboard.JustDown(this.keys.J) || pointer.leftButtonDown()) {
        this.startPlayerAttack("light", time);
      } else if (Phaser.Input.Keyboard.JustDown(this.keys.K) || pointer.rightButtonDown()) {
        this.startPlayerAttack("heavy", time);
      }
    }
  }

  private updateBoss(time: number, dt: number) {
    this.boss.facing = directionTo(this.boss.position, this.player.position);
    const phase = this.getCurrentBossPhase(time);
    if (phase !== this.lastBossPhase) {
      this.lastBossPhase = phase;
      this.phaseSurgeUntil = time + 900;
    }
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

  private startPlayerAttack(kind: PlayerAttackKind, time: number) {
    const attack = PLAYER_ATTACKS[kind];
    if (!spendStamina(this.player.vitals, attack.staminaCost)) return;
    if (kind === "heavy") this.stats.heavyThrown += 1;
    else if (kind === "skill") this.stats.skillThrown += 1;
    else this.stats.lightThrown += 1;

    if (kind === "skill") {
      this.player.position = clampToArena({
        x: this.player.position.x + this.player.facing.x * 48,
        y: this.player.position.y + this.player.facing.y * 48
      });
    }

    const timing = PLAYER_ATTACK_TIMINGS[kind];
    this.playerAttack = {
      kind,
      activeAt: time + timing.activeDelayMs,
      endsAt: time + timing.activeDelayMs + timing.activeMs,
      recoveryEndsAt: time + timing.recoveryMs,
      resolved: false
    };
  }

  private startBossAttack(id: Exclude<BossMoveId, "watching" | "broken">, time: number) {
    const move = BOSS_MOVES[id];
    this.stats.bossMoveUses[id] = (this.stats.bossMoveUses[id] || 0) + 1;
    this.counterAwardedForAttack = null;
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
      const attack = PLAYER_ATTACKS[this.playerAttack.kind];
      const counterReady = this.isCounterReady(time);
      const posture = getCounterPosture(attack.posture, counterReady);
      const hit = isInsideArc(
        this.player.position,
        this.player.facing,
        this.boss.position,
        attack.range,
        attack.arcDegrees
      );
      this.playerAttack.resolved = true;
      if (hit) {
        this.stats.hitsLanded += 1;
        applyDamage(this.boss.vitals, attack.damage, posture);
        const hitLabel =
          counterReady ? "counter-hit" : this.playerAttack.kind === "heavy" ? "posture-break" : this.playerAttack.kind === "skill" ? "skill-hit" : "player-hit";
        const stopMs = counterReady ? 104 : this.playerAttack.kind === "heavy" ? 90 : this.playerAttack.kind === "skill" ? 76 : 58;
        this.addImpactFx(this.boss.position, time, hitLabel);
        this.hitStopUntil = Math.max(this.hitStopUntil, time + stopMs);
        if (counterReady) {
          this.stats.counterHits += 1;
          applyCounterStaminaRefund(this.player.vitals, counterReady);
          this.counterUntil = 0;
          this.counterFlashUntil = time + 320;
          this.bossAttack = null;
          this.nextBossDecisionAt = time + COUNTER_STAGGER_MS;
          this.phaseSurgeUntil = Math.max(this.phaseSurgeUntil, time + 520);
        }
        if (this.boss.vitals.posture >= this.boss.vitals.maxPosture) {
          applyDamage(this.boss.vitals, 42, 0);
          resetPosture(this.boss.vitals);
          this.bossAttack = null;
          this.nextBossDecisionAt = time + 1080;
          this.addImpactFx(this.boss.position, time, "posture-break");
          this.hitStopUntil = Math.max(this.hitStopUntil, time + 120);
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
      this.addImpactFx(this.player.position, time, "player-damaged");
      this.hitStopUntil = Math.max(this.hitStopUntil, time + 46);
    }
  }

  private updateCounterWindow(time: number) {
    if (!this.bossAttack || this.counterAwardedForAttack === this.bossAttack || time >= this.dodgeEndsAt) return;
    if (getBossAttackPhase(this.bossAttack, time) !== "active") return;

    const move = BOSS_MOVES[this.bossAttack.id];
    const counterCandidate = isCounterDodgeCandidate(
      this.boss.position,
      this.bossAttack.facing,
      this.player.position,
      move.range,
      move.arcDegrees
    );
    if (!counterCandidate) return;

    this.counterAwardedForAttack = this.bossAttack;
    this.counterUntil = time + COUNTER_WINDOW_MS;
    this.counterFlashUntil = time + 260;
    this.stats.counterWindows += 1;
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
    const attackPhase = getBossAttackPhase(this.bossAttack, time);
    if (attackPhase === "idle") return;

    if (attackPhase === "recovery") {
      this.telegraphs.fillStyle(0x7d8a74, 0.08);
      this.telegraphs.fillCircle(this.boss.position.x, this.boss.position.y, 58);
      this.telegraphs.lineStyle(3, 0x9fab8e, 0.52);
      this.telegraphs.strokeCircle(this.boss.position.x, this.boss.position.y, 58);
      this.telegraphs.lineStyle(1, 0xd8b25e, 0.28);
      this.telegraphs.strokeCircle(this.boss.position.x, this.boss.position.y, 72);
      return;
    }

    const charge = Math.min(1, Math.max(0, (time - this.bossAttack.startedAt) / (this.bossAttack.activeAt - this.bossAttack.startedAt)));
    const color = attackPhase === "active" ? 0xfff0b3 : attackPhase === "snap" ? 0xffd267 : 0xb53b35;
    const alpha = attackPhase === "active" ? 0.46 : attackPhase === "snap" ? 0.36 : 0.1 + charge * 0.14;

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

    this.drawDangerOutline(
      move.range,
      move.arcDegrees,
      color,
      attackPhase === "active" ? 1 : attackPhase === "snap" ? 0.88 : 0.34,
      attackPhase === "active" ? 6 : attackPhase === "snap" ? 4 : 2
    );

    this.drawMoveTell(this.bossAttack.id, move.range, move.arcDegrees, attackPhase, time);

    if (attackPhase === "snap") {
      const pulse = 1 + Math.sin(time / 26) * 0.07;
      this.drawDangerOutline(move.range * pulse, move.arcDegrees, 0xffffff, 0.72, 2);
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
    this.drawCounterReadiness(time);

    if (this.playerAttack) {
      const attack = PLAYER_ATTACKS[this.playerAttack.kind];
      const heavy = this.playerAttack.kind === "heavy";
      const skill = this.playerAttack.kind === "skill";
      const windup = time < this.playerAttack.activeAt;
      this.effects.lineStyle(skill ? 6 : heavy ? 7 : 5, windup ? 0x8d7660 : skill ? 0x8bd8d2 : 0xe8d38a, windup ? 0.5 : 0.88);
      this.effects.lineBetween(
        this.player.position.x,
        this.player.position.y,
        this.player.position.x + this.player.facing.x * (attack.range - 12),
        this.player.position.y + this.player.facing.y * (attack.range - 12)
      );
      if (skill) {
        this.effects.lineStyle(2, 0x8bd8d2, windup ? 0.36 : 0.72);
        this.effects.strokeCircle(
          this.player.position.x + this.player.facing.x * 62,
          this.player.position.y + this.player.facing.y * 62,
          windup ? 18 : 30
        );
      }
    }

    this.drawImpactFx(time);

    const phaseTwo = this.getCurrentBossPhase(time) === 2;
    const bossAttackPhase = getBossAttackPhase(this.bossAttack, time);
    const bossHitFlash = this.hasRecentBossHitFx(time);
    const bossColor = bossHitFlash ? 0xf5d889 : bossAttackPhase === "recovery" ? 0x2c312d : phaseTwo ? 0x6d2631 : 0x443d39;
    this.actors.fillStyle(bossColor, 1);
    this.actors.fillCircle(this.boss.position.x, this.boss.position.y, 35);
    if (bossAttackPhase === "recovery") {
      this.actors.lineStyle(3, 0x9fab8e, 0.62);
      this.actors.strokeCircle(this.boss.position.x, this.boss.position.y, 41);
    }
    if (bossHitFlash) {
      this.actors.lineStyle(4, 0xf5d889, 0.84);
      this.actors.strokeCircle(this.boss.position.x, this.boss.position.y, 42);
    }
    if (time < this.phaseSurgeUntil) {
      const progress = 1 - Math.max(0, this.phaseSurgeUntil - time) / 900;
      this.actors.lineStyle(4, 0xffd267, 0.5 * (1 - progress));
      this.actors.strokeCircle(this.boss.position.x, this.boss.position.y, 52 + progress * 34);
    }
    this.actors.fillStyle(0xd8b25e, 0.95);
    this.actors.fillCircle(
      this.boss.position.x + this.boss.facing.x * 17,
      this.boss.position.y + this.boss.facing.y * 17,
      7
    );
    this.actors.lineStyle(4, 0x151816, 1);
    this.actors.strokeCircle(this.boss.position.x, this.boss.position.y, 35);
    this.drawBossIntentIcon(time, bossAttackPhase);

    if (this.debugHitboxes) {
      this.actors.lineStyle(1, 0x8bd8d2, 0.9);
      this.actors.strokeCircle(this.player.position.x, this.player.position.y, 19);
      this.actors.lineStyle(1, 0xffd267, 0.9);
      this.actors.strokeCircle(this.boss.position.x, this.boss.position.y, 35);
    }
  }

  private drawDangerOutline(range: number, arcDegrees: number, color: number, alpha: number, width: number) {
    if (!this.bossAttack) return;
    this.telegraphs.lineStyle(width, color, alpha);
    if (arcDegrees >= 360) {
      this.telegraphs.strokeCircle(this.boss.position.x, this.boss.position.y, range);
      return;
    }

    const facingAngle = Math.atan2(this.bossAttack.facing.y, this.bossAttack.facing.x);
    const half = (arcDegrees * Math.PI) / 360;
    this.telegraphs.beginPath();
    this.telegraphs.arc(this.boss.position.x, this.boss.position.y, range, facingAngle - half, facingAngle + half, false);
    this.telegraphs.strokePath();
    this.telegraphs.lineBetween(
      this.boss.position.x,
      this.boss.position.y,
      this.boss.position.x + Math.cos(facingAngle - half) * range,
      this.boss.position.y + Math.sin(facingAngle - half) * range
    );
    this.telegraphs.lineBetween(
      this.boss.position.x,
      this.boss.position.y,
      this.boss.position.x + Math.cos(facingAngle + half) * range,
      this.boss.position.y + Math.sin(facingAngle + half) * range
    );
  }

  private drawMoveTell(
    id: Exclude<BossMoveId, "watching" | "broken">,
    range: number,
    arcDegrees: number,
    attackPhase: BossAttackPhase,
    time: number
  ) {
    if (!this.bossAttack) return;
    const facingAngle = Math.atan2(this.bossAttack.facing.y, this.bossAttack.facing.x);
    const pulse = attackPhase === "snap" ? 1 + Math.sin(time / 24) * 0.08 : 1;
    const alpha = attackPhase === "active" ? 0.94 : attackPhase === "snap" ? 0.82 : 0.5;
    const width = attackPhase === "active" ? 5 : attackPhase === "snap" ? 4 : 3;

    if (id === "delayed-lunge") {
      const normal = { x: -this.bossAttack.facing.y, y: this.bossAttack.facing.x };
      const lane = range * pulse;
      const rail = 18;
      this.telegraphs.lineStyle(width, 0x8bd8d2, alpha);
      this.telegraphs.lineBetween(
        this.boss.position.x,
        this.boss.position.y,
        this.boss.position.x + this.bossAttack.facing.x * lane,
        this.boss.position.y + this.bossAttack.facing.y * lane
      );
      this.telegraphs.lineStyle(2, 0x8bd8d2, alpha * 0.58);
      for (const side of [-1, 1]) {
        this.telegraphs.lineBetween(
          this.boss.position.x + normal.x * rail * side,
          this.boss.position.y + normal.y * rail * side,
          this.boss.position.x + this.bossAttack.facing.x * lane + normal.x * rail * side,
          this.boss.position.y + this.bossAttack.facing.y * lane + normal.y * rail * side
        );
      }
      return;
    }

    if (id === "grave-sweep") {
      const half = (arcDegrees * Math.PI) / 360;
      this.telegraphs.lineStyle(width, 0xf0a35a, alpha);
      this.telegraphs.beginPath();
      this.telegraphs.arc(this.boss.position.x, this.boss.position.y, range * 0.78 * pulse, facingAngle - half, facingAngle + half, false);
      this.telegraphs.strokePath();
      this.telegraphs.lineStyle(2, 0xf5d889, alpha * 0.56);
      this.telegraphs.beginPath();
      this.telegraphs.arc(this.boss.position.x, this.boss.position.y, range * 0.52 * pulse, facingAngle - half, facingAngle + half, false);
      this.telegraphs.strokePath();
      return;
    }

    this.telegraphs.lineStyle(width, 0xf5d889, alpha);
    this.telegraphs.strokeCircle(this.boss.position.x, this.boss.position.y, range * 0.54 * pulse);
    this.telegraphs.lineStyle(2, 0xffffff, alpha * 0.56);
    this.telegraphs.strokeCircle(this.boss.position.x, this.boss.position.y, range * 0.82 * pulse);
  }

  private drawBossIntentIcon(time: number, bossAttackPhase: BossAttackPhase) {
    if (!this.bossAttack || bossAttackPhase === "idle" || bossAttackPhase === "recovery") return;
    const alpha = bossAttackPhase === "snap" ? 0.95 : 0.64;
    const pulse = bossAttackPhase === "snap" ? 1 + Math.sin(time / 24) * 0.1 : 1;
    const center = {
      x: this.boss.position.x,
      y: this.boss.position.y - 2
    };

    if (this.bossAttack.id === "delayed-lunge") {
      this.actors.lineStyle(3, 0x8bd8d2, alpha);
      this.actors.lineBetween(
        center.x - this.bossAttack.facing.x * 16,
        center.y - this.bossAttack.facing.y * 16,
        center.x + this.bossAttack.facing.x * 27 * pulse,
        center.y + this.bossAttack.facing.y * 27 * pulse
      );
      return;
    }

    if (this.bossAttack.id === "grave-sweep") {
      const facingAngle = Math.atan2(this.bossAttack.facing.y, this.bossAttack.facing.x);
      this.actors.lineStyle(3, 0xf0a35a, alpha);
      this.actors.beginPath();
      this.actors.arc(center.x, center.y, 21 * pulse, facingAngle - 1.9, facingAngle + 1.9, false);
      this.actors.strokePath();
      return;
    }

    this.actors.lineStyle(3, 0xf5d889, alpha);
    this.actors.strokeCircle(center.x, center.y, 18 * pulse);
    this.actors.lineStyle(2, 0xffffff, alpha * 0.64);
    this.actors.strokeCircle(center.x, center.y, 27 * pulse);
  }

  private drawCounterReadiness(time: number) {
    const counterReady = this.isCounterReady(time);
    const flashing = time < this.counterFlashUntil;
    if (!counterReady && !flashing) return;

    const remaining = counterReady ? Math.max(0, this.counterUntil - time) / COUNTER_WINDOW_MS : 0;
    const pulse = 1 + Math.sin(time / 32) * 0.05;
    const radius = (counterReady ? 28 + remaining * 8 : 38) * pulse;
    const alpha = counterReady ? 0.28 + remaining * 0.32 : 0.26;
    this.effects.lineStyle(3, 0x8bd8d2, alpha);
    this.effects.strokeCircle(this.player.position.x, this.player.position.y, radius);
    this.effects.lineStyle(1, 0xffffff, alpha * 0.72);
    this.effects.strokeCircle(this.player.position.x, this.player.position.y, radius + 7);
  }

  private addImpactFx(position: Vec2, time: number, label: ImpactFx["label"]) {
    const config = {
      "player-hit": { color: 0xf5d889, radius: 34, durationMs: 240 },
      "skill-hit": { color: 0x8bd8d2, radius: 44, durationMs: 280 },
      "counter-hit": { color: 0x8bd8d2, radius: 54, durationMs: 360 },
      "player-damaged": { color: 0xff6c55, radius: 42, durationMs: 300 },
      "posture-break": { color: 0xffffff, radius: 58, durationMs: 340 }
    }[label];

    this.impactFx.push({
      position: { ...position },
      startedAt: time,
      label,
      ...config
    });
    this.impactFx = this.impactFx.slice(-10);
  }

  private drawImpactFx(time: number) {
    this.impactFx = this.impactFx.filter((effect) => time - effect.startedAt <= effect.durationMs);
    for (const effect of this.impactFx) {
      const progress = Math.min(1, Math.max(0, (time - effect.startedAt) / effect.durationMs));
      const radius = effect.radius * (0.35 + progress * 0.85);
      const alpha = 1 - progress;
      this.effects.lineStyle(effect.label === "posture-break" ? 5 : 3, effect.color, alpha);
      this.effects.strokeCircle(effect.position.x, effect.position.y, radius);
      this.effects.fillStyle(effect.color, alpha * 0.28);
      this.effects.fillCircle(effect.position.x, effect.position.y, radius * 0.45);
    }
  }

  private hasRecentBossHitFx(time: number) {
    return this.impactFx.some(
      (effect) =>
        (effect.label === "player-hit" || effect.label === "skill-hit" || effect.label === "counter-hit" || effect.label === "posture-break") &&
        time - effect.startedAt >= 0 &&
        time - effect.startedAt <= Math.min(160, effect.durationMs)
    );
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
      bossAttackPhase: getBossAttackPhase(this.bossAttack, time),
      playerActionState: this.getPlayerActionState(time),
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
        phase: this.getCurrentBossPhase(time),
        move: this.bossAttack?.id || "watching"
      },
      metrics: {
        fps: this.fps,
        dodgeCount: this.stats.dodgeCount,
        lightThrown: this.stats.lightThrown,
        heavyThrown: this.stats.heavyThrown,
        skillThrown: this.stats.skillThrown,
        hitsLanded: this.stats.hitsLanded,
        damageTaken: this.stats.damageTaken,
        counterWindows: this.stats.counterWindows,
        counterHits: this.stats.counterHits,
        counterReady: this.isCounterReady(time),
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

  private getPlayerActionState(time: number): PlayerActionState {
    if (this.status !== "running") return "idle";
    if (time < this.dodgeEndsAt) return "dodging";
    if (this.playerAttack) {
      if (time <= this.playerAttack.endsAt) return this.playerAttack.kind;
      if (time < this.playerAttack.recoveryEndsAt) return "recovering";
    }
    if (this.keys.W.isDown || this.keys.A.isDown || this.keys.S.isDown || this.keys.D.isDown) {
      return "moving";
    }
    return "idle";
  }

  private isCounterReady(time: number) {
    return this.counterUntil > 0 && isCounterWindowReady(this.counterUntil, time);
  }

  private getCurrentBossPhase(time: number): 1 | 2 {
    return getBossPhase(
      this.boss.vitals.hp,
      this.boss.vitals.maxHp,
      Math.max(0, time - this.runStartedAt),
      this.stats?.counterHits || 0
    );
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
