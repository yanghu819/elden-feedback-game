import { NextResponse } from "next/server";
import type { FeedbackPayload } from "@/src/game/types";
import { createFeedbackIssue } from "@/src/server/github";
import { redactText } from "@/src/server/redact";

export async function POST(request: Request) {
  let payload: FeedbackPayload;
  try {
    payload = (await request.json()) as FeedbackPayload;
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 });
  }

  const message = typeof payload.message === "string" ? redactText(payload.message.trim()) : "";
  if (message.length < 3) {
    return NextResponse.json({ message: "Feedback message is required." }, { status: 400 });
  }
  if (!payload.context?.runId || !payload.context?.player || !payload.context?.boss) {
    return NextResponse.json({ message: "Combat context is required." }, { status: 400 });
  }

  const safePayload = {
    ...payload,
    message,
    route: typeof payload.route === "string" ? payload.route.slice(0, 120) : "/",
    createdAt: payload.createdAt || new Date().toISOString()
  };

  const issue = await createFeedbackIssue(safePayload);
  return NextResponse.json({
    ok: true,
    issueUrl: issue.issueUrl,
    message: issue.skippedReason || "Feedback captured."
  });
}
