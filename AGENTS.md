# AGENTS.md

## Setup
- Install dependencies: `npm install`
- Run dev server: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Unit tests: `npm run test`
- Browser smoke: `npm run e2e`

## Product Rules
- This is an original browser boss-duel game. Do not use Elden Ring names, assets, lore, maps, or protected material.
- First-screen experience must be the playable game, not a landing page.
- Keep the core feel focused: readable boss tells, stamina pressure, dodge timing, attack commitment, posture break, quick retry.
- Prefer small combat tuning changes over adding content.
- Do not add build systems, UI libraries, or game engines unless the issue explicitly asks for it.

## Code Rules
- Keep combat math deterministic and testable in `src/game/combat.ts`.
- Keep Phaser rendering/input code separate from combat helpers.
- Add or update focused regression tests for bug fixes and tuning changes.
- Do not change API shapes unless the issue explicitly allows it.
- Avoid unrelated UI, formatting, dependency, or asset churn.

## Privacy Rules
- Never log or store PII.
- Feedback collection is explicit opt-in only.
- Do not add session replay, screenshots, DOM capture, request bodies, tokens, emails, payment data, or private text capture without a dedicated privacy review.

## Review Guidelines
- Flag changes that make boss attacks less readable without adding a compensating tell.
- Flag missing tests for combat timing, hit detection, stamina, or telemetry changes.
- Flag any workflow that auto-merges or deploys agent-generated PRs.
