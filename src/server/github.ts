import type { FeedbackPayload } from "@/src/game/types";
import { cleanLabel, redactText } from "./redact";

type GitHubIssueResult = {
  issueUrl?: string;
  skippedReason?: string;
};

const DEFAULT_LABELS = ["source:user-feedback", "needs-triage"];

function getRepoConfig() {
  const token = process.env.GITHUB_TOKEN;
  const owner =
    process.env.FEEDBACK_GITHUB_OWNER ||
    process.env.REPO_OWNER ||
    process.env.GITHUB_REPOSITORY?.split("/")[0];
  const repo =
    process.env.FEEDBACK_GITHUB_REPO ||
    process.env.REPO_NAME ||
    process.env.GITHUB_REPOSITORY?.split("/")[1];
  return { token, owner, repo };
}

function summarizeTrajectory(payload: FeedbackPayload) {
  const trajectory = payload.trajectory || [];
  const damageEvents = [];
  const hitEvents = [];
  const dodgeEvents = [];
  const attackEvents = [];
  const counterEvents = [];

  for (let index = 1; index < trajectory.length; index += 1) {
    const previous = trajectory[index - 1];
    const current = trajectory[index];
    const previousSkill = previous.skill ?? 0;
    const currentSkill = current.skill ?? 0;
    const previousCounterWindows = previous.counterWindows ?? 0;
    const currentCounterWindows = current.counterWindows ?? 0;
    const previousCounterHits = previous.counterHits ?? 0;
    const currentCounterHits = current.counterHits ?? 0;
    if (current.damageTaken > previous.damageTaken) {
      damageEvents.push(
        `- ${current.t}ms: +${current.damageTaken - previous.damageTaken} damage during ${current.bossMove}/${current.bossAttackPhase}, player HP ${current.playerHp}`
      );
    }
    if (current.hits > previous.hits) {
      hitEvents.push(`- ${current.t}ms: hit landed, boss HP ${current.bossHp}, posture ${current.bossPosture}`);
    }
    if (current.dodges > previous.dodges) {
      dodgeEvents.push(`- ${current.t}ms: dodge during ${current.bossMove}/${current.bossAttackPhase}, stamina ${current.stamina}`);
    }
    if (current.light > previous.light || current.heavy > previous.heavy || currentSkill > previousSkill) {
      attackEvents.push(
        `- ${current.t}ms: attacks light=${current.light}, heavy=${current.heavy}, skill=${currentSkill}, player state ${current.playerActionState}, stamina ${current.stamina}, boss ${current.bossMove}/${current.bossAttackPhase}`
      );
    }
    if (currentCounterWindows > previousCounterWindows) {
      counterEvents.push(`- ${current.t}ms: counter window armed during ${current.bossMove}/${current.bossAttackPhase}, player state ${current.playerActionState}`);
    }
    if (currentCounterHits > previousCounterHits) {
      counterEvents.push(`- ${current.t}ms: counter hit landed, boss posture ${current.bossPosture}`);
    }
  }

  const lastRows = trajectory.slice(-14).map((sample) =>
    `| ${sample.t} | ${sample.status} | ${sample.playerHp} | ${sample.stamina} | ${sample.bossHp} | ${sample.bossMove} | ${sample.bossAttackPhase} | ${sample.playerActionState} | ${sample.dodges} | ${sample.light} | ${sample.heavy} | ${sample.skill ?? 0} | ${sample.hits} | ${sample.damageTaken} | ${sample.counterReady ? "yes" : "no"} | ${sample.counterWindows ?? 0} | ${sample.counterHits ?? 0} |`
  );

  return [
    "## Recent trajectory",
    trajectory.length ? `Samples: ${trajectory.length}` : "No trajectory samples included.",
    "",
    "Damage events:",
    damageEvents.length ? damageEvents.join("\n") : "- None",
    "",
    "Hit events:",
    hitEvents.length ? hitEvents.join("\n") : "- None",
    "",
    "Dodge events:",
    dodgeEvents.length ? dodgeEvents.join("\n") : "- None",
    "",
    "Attack events:",
    attackEvents.length ? attackEvents.join("\n") : "- None",
    "",
    "Counter events:",
    counterEvents.length ? counterEvents.join("\n") : "- None",
    "",
    "| t(ms) | status | player HP | stamina | boss HP | boss move | boss phase | player state | dodges | light | heavy | skill | hits | damage | counter ready | counter windows | counter hits |",
    "| --- | --- | ---: | ---: | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |",
    ...(lastRows.length ? lastRows : ["| n/a | n/a | 0 | 0 | 0 | n/a | idle | idle | 0 | 0 | 0 | 0 | 0 | 0 | no | 0 | 0 |"])
  ].join("\n");
}

export function buildFeedbackIssueBody(payload: FeedbackPayload) {
  const context = payload.context;
  return [
    "## User signal",
    redactText(payload.message),
    "",
    "## Combat context",
    `- run_id: ${context.runId}`,
    `- route: ${payload.route}`,
    `- release_sha: ${context.releaseSha}`,
    `- status: ${context.status}`,
    `- elapsed_ms: ${Math.round(context.elapsedMs)}`,
    `- boss_attack_phase: ${context.bossAttackPhase}`,
    `- player_action_state: ${context.playerActionState}`,
    `- boss_phase: ${context.boss.phase}`,
    `- boss_move_at_feedback: ${context.boss.move}`,
    `- player_hp: ${Math.round(context.player.hp)} / ${context.player.maxHp}`,
    `- boss_hp: ${Math.round(context.boss.hp)} / ${context.boss.maxHp}`,
    `- dodge_count: ${context.metrics.dodgeCount}`,
    `- attacks: light=${context.metrics.lightThrown}, heavy=${context.metrics.heavyThrown}, skill=${context.metrics.skillThrown ?? 0}, hits=${context.metrics.hitsLanded}`,
    `- counters: windows=${context.metrics.counterWindows ?? 0}, hits=${context.metrics.counterHits ?? 0}, ready=${context.metrics.counterReady ? "yes" : "no"}`,
    `- damage_taken: ${context.metrics.damageTaken}`,
    `- last_death_reason: ${context.metrics.lastDeathReason || "n/a"}`,
    `- fps: ${Math.round(context.metrics.fps)}`,
    "",
    summarizeTrajectory(payload),
    "",
    "## Acceptance criteria",
    "- Reproduce or explain the combat feel issue from the context pack.",
    "- Use the recent trajectory to identify the timing or hit-confirm failure mode.",
    "- Prefer the smallest safe tuning or logic change.",
    "- Add or update focused regression tests when combat math changes.",
    "- Do not collect PII, screenshots, session replay, or unrelated telemetry.",
    "- Do not change unrelated UI or API shapes."
  ].join("\n");
}

export async function createFeedbackIssue(payload: FeedbackPayload): Promise<GitHubIssueResult> {
  const { token, owner, repo } = getRepoConfig();
  if (!token || !owner || !repo) {
    return { skippedReason: "GitHub issue creation is not configured." };
  }

  const labels = DEFAULT_LABELS.map(cleanLabel);
  const title = `Feedback: ${redactText(payload.message).replace(/\s+/g, " ").slice(0, 72)}`;
  const body = buildFeedbackIssueBody(payload);
  const url = `https://api.github.com/repos/${owner}/${repo}/issues`;

  const create = (issueLabels?: string[]) =>
    fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title,
        body,
        labels: issueLabels
      })
    });

  let response = await create(labels);
  if (response.status === 422) {
    response = await create();
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub issue creation failed: ${response.status} ${text.slice(0, 180)}`);
  }

  const data = (await response.json()) as { html_url?: string };
  return { issueUrl: data.html_url };
}
