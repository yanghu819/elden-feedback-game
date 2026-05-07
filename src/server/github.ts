import type { FeedbackPayload } from "@/src/game/types";
import { cleanLabel, redactText } from "./redact";

type GitHubIssueResult = {
  issueUrl?: string;
  skippedReason?: string;
};

const DEFAULT_LABELS = ["source:user-feedback", "needs-triage"];

function getRepoConfig() {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.REPO_OWNER || process.env.GITHUB_REPOSITORY?.split("/")[0];
  const repo = process.env.REPO_NAME || process.env.GITHUB_REPOSITORY?.split("/")[1];
  return { token, owner, repo };
}

function buildIssueBody(payload: FeedbackPayload) {
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
    `- boss_phase: ${context.boss.phase}`,
    `- boss_move_at_feedback: ${context.boss.move}`,
    `- player_hp: ${Math.round(context.player.hp)} / ${context.player.maxHp}`,
    `- boss_hp: ${Math.round(context.boss.hp)} / ${context.boss.maxHp}`,
    `- dodge_count: ${context.metrics.dodgeCount}`,
    `- attacks: light=${context.metrics.lightThrown}, heavy=${context.metrics.heavyThrown}, hits=${context.metrics.hitsLanded}`,
    `- damage_taken: ${context.metrics.damageTaken}`,
    `- last_death_reason: ${context.metrics.lastDeathReason || "n/a"}`,
    `- fps: ${Math.round(context.metrics.fps)}`,
    "",
    "## Acceptance criteria",
    "- Reproduce or explain the combat feel issue from the context pack.",
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
  const body = buildIssueBody(payload);
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
