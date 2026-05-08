# Elden Feedback Game

Original 3D boss-duel web game with abstract, goofy modeling and an explicit feedback-to-issue loop.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Controls

- `WASD`: move
- Mouse: aim
- Left click or `J`: light attack
- Right click or `K`: heavy attack
- `E`: gap cut
- `Space` or `Shift`: dodge
- `R`: restart after death or victory
- `F`: feedback
- `H`: debug hitboxes

## Automation Shape

- `/api/telemetry` receives anonymous combat summaries.
- `/api/feedback` receives explicit player feedback with recent 3D combat trajectory and can create a GitHub issue when `GITHUB_TOKEN`, `FEEDBACK_GITHUB_OWNER`, and `FEEDBACK_GITHUB_REPO` are configured.
- Codex should work from high-quality GitHub issues, produce PRs, and leave merge/release approval to humans.
