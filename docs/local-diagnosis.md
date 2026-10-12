# Local inspection, 2026-10-12

The working tree was clean before this change. No agent turns were sent, no running sessions were resumed or interrupted, and no external databases were queried or changed.

## Components

- `src/App.tsx` composes the workspace, editor, terminal, and activation gate.
- `src/features/codex/CodexConversation.tsx`, `Composer.tsx`, and `CodexSettingsPicker.tsx` render Codex messages, input, and model/reasoning/permission controls.
- `src/features/opencode/` contains direct chat, planner chat, handoff display, and message-level changes.
- `src/components/ProjectEditor.tsx` provides the chat/file tabs and editor actions.
- `server.mjs` hosts the local API, Codex app-server transport, OpenCode routing, licensing checks, and saved session links. `server/workflow.mjs` supplies role instructions.
- `electron/main.mjs` owns the desktop window, encrypted activation storage, and updater.

## Licensing and storage found in code

`D:\coding-room-licensing` exists. Its README, `server/pg-store.mjs`, `server/schema.postgres.sql`, `server/vercel-api.mjs`, and local store show PostgreSQL for Vercel and SQLite for local development. PostgreSQL connections use `DATABASE_URL`; the code does not establish the database hosting vendor. Connection credentials were not printed.

The schema defines `licenses`, `activations`, `daily_usage`, `consumed_messages`, `support_threads`, and `support_messages`. Open Zero calls the hosted `/api/license/activate`, `/entitlement`, and `/consume` endpoints. Consumption uses a message ID; the PostgreSQL store locks the license row and checks `consumed_messages` for duplicates before increasing daily usage. The existing client responds to the remaining-quota header and polls entitlement every 45 seconds. The implemented quota is daily, resetting at midnight UTC. Some older README statements about the desktop not yet being connected are stale relative to the actual client code.

This is a static integration map. Hosted schema state, device blocking, production request accounting, and UI lock behavior were not exercised. No migrations or data operations were performed.

## Old Codex instructions

The saved workflow and workflow role choose one of four instruction sources. The current source no longer includes `Do not write or edit implementation code in this thread.`. The existing resume path already defers during a running turn and unsubscribes an idle loaded thread before requesting resume with changed instructions; it preserves the ID and does not pass sandbox or approval-policy overrides.

A read-only scan found the exact old restriction in four registered sessions' historical developer messages, including a rollout dated 2026-10-12. This proves the restriction was persisted. It does not establish whether it remains in the effective context of the next model request. The previous local `threadInstructions` cache only represented the requested string after an acknowledged RPC, so it could not prove replacement.

The new transport audit records the exact role instructions sent, the request method, time, thread ID, permission-override flag, and RPC outcome. The read-only diagnostic endpoint distinguishes expected instructions, last captured request, cache update status, and busy deferral. The offline audit compares those captures with persisted developer messages without exposing message text. Both explicitly leave effective model context unverified.

To close the remaining evidence gap, inspect the capture after the next normal interaction with the affected existing session and compare its response and persisted rollout. No diagnostic model message is necessary. The application process must load the updated server code before new transport captures exist; it was not restarted during this work.

## Liquid Glass change

The chat treatment follows the two images on the [Liquid Glass reference page](https://liquidglassdesign.com/gallery/liquid-glass-tab-bar-ui): a dark capsule, fine silver edges, a separate circular send/stop control, and rounded selected tabs. Styling is scoped to `data-theme="liquid-glass"`. Attachment, delegation-tag insertion, send, queue, and stop handlers remain intact. Message surfaces add no backdrop blur. No microphone or audio buttons were added.

The frontend build and local bridge regression checks passed. Visual/manual interaction testing is left to the user as requested. The build reported the existing category of warning about chunks exceeding 500 kB; it completed successfully.

## Changed files and checks

- Diagnostics: `server.mjs`, `scripts/audit-codex-instructions.mjs`, `scripts/test-codex-resume.mjs`.
- Chat styling and hooks: `src/index.css`, `src/components/MessageBubble.tsx`, `src/components/ProjectEditor.tsx`, `src/features/codex/CodexConversation.tsx`, `src/features/codex/CodexSettingsPicker.tsx`, `src/features/codex/Composer.tsx`, `src/features/opencode/HandoffRail.tsx`, `src/features/opencode/OpenCodeChat.tsx`, `src/features/opencode/PlannerConversation.tsx`.
- Documentation: `README.md`, `docs/local-diagnosis.md`.

Verified: `npm run build` (including TypeScript), `node --check server.mjs`, `node --check scripts/audit-codex-instructions.mjs`, `node scripts/test-codex-resume.mjs`, `node scripts/test-codex-messages.mjs`, and `git diff --check`. The offline audit also successfully read the most recent registered rollout containing the old restriction, with no pre-existing outbound audit capture available. The bridge tests use mocks and isolated temporary storage, not real model turns.
