# Relay Room

A local web app for chatting with Codex and handing implementation tasks to OpenCode. It includes project selection, model and reasoning controls, session permissions, and file-change summaries.

## Requirements

- Windows for the project-folder picker and Explorer integration.
- Node.js 22.12+ and npm.
- Codex Desktop installed and signed in. Relay Room uses its local `codex.exe` and app-server.
- An installed, configured OpenCode CLI that supports `opencode api GET /api/model`. The app requires this API command; a CLI without it is not compatible with the current integration.
- Access to the models you want to use through your Codex and OpenCode accounts.

## First-time setup

Open PowerShell in the repository folder:

```powershell
cd D:\opencode-observer
npm ci
Copy-Item .env.example .env
```

Copy the example only if you do not already have a `.env` file. Edit `.env` to set the initial project folder:

```dotenv
WATCH_ROOT=D:\path\to\your-project
OPENCODE_OBSERVER_PORT=4280
OPENCODE_MODEL=opencode/big-pickle
```

The folder must exist. You can also select a project later using **فتح مجلد مشروع جديد** in the sidebar. That selection is saved across restarts; an explicit `WATCH_ROOT` takes precedence at startup.

If executable detection fails, set the absolute paths in `.env`:

```dotenv
CODEX_EXE=C:\path\to\codex.exe
OPENCODE_EXE=C:\path\to\opencode.exe
```

For Codex, select a complete installation containing `codex-code-mode-host.exe` alongside `codex.exe`. Use the real executables rather than npm `.cmd` or PowerShell `.ps1` wrappers.

## Run with automatic reload

```powershell
npm run dev:all
```

Open **http://localhost:5173/**, or the URL printed by Vite if that port is occupied. This command starts both servers:

- Vite updates the browser when frontend files change.
- Node watch mode restarts the API when its source changes.

Keep the terminal open. Press **Ctrl+C** to stop both servers. Restart the command after changing `.env`.

## Run the built app

```powershell
npm run build
npm run start
```

Open **http://localhost:4280/**. The API serves the built files from `dist/`.

`npm run start` does not rebuild the frontend or enable automatic reload. After source changes, run `npm run build` again and refresh the browser; restart the server for backend changes. Use `dev:all` while developing.

## Use the app

1. Select your project folder before creating a new Codex conversation.
2. Click **محادثة** to create a conversation for that project. Existing conversations keep their own project folder.
3. Choose the Codex model, reasoning level, and session permissions. Permission changes take effect with the next message.
4. Choose the OpenCode execution model in the delegation panel before the first handoff.
5. Chat with Codex normally, or include `$opencode` to request implementation. For example: `$opencode fix the job-grade search in this project`.
6. Follow the OpenCode replies and file-change summaries in the delegation panel. Use the review button to ask Codex to review the reply or implementation.

OpenCode starts delegated work only when the request includes `$opencode`. Direct OpenCode chat is available when the Codex conversation has no linked delegation session.

## MCP controls

Open **أدوات MCP · Codex** or **أدوات MCP · OpenCode** in the corresponding chat pane to see that agent's configured servers and switch them on or off. The lists load only when opened and include a manual refresh button.

Codex changes are saved in its local user configuration and apply to loaded conversations with the next message. Plugin MCP switches target the individual server. `codex_apps` controls the default app-connector enablement. A project or managed configuration can override the user setting; Relay Room reports this rather than showing a successful toggle.

OpenCode switches disconnect or reconnect the server in the current project at runtime. They last until OpenCode restarts and do not rewrite its configuration or delete credentials. Wait for active work to finish before changing a switch.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev:all` | Frontend and API together, with automatic reload. |
| `npm run dev` | Vite frontend only; requires the API running separately. |
| `npm run dev:api` | API only, with Node watch mode. |
| `npm run build` | Type-check and build the frontend into `dist/`. |
| `npm run start` | API and built frontend, without watch mode. |

When running the development servers separately with a custom API port, set `OPENCODE_OBSERVER_PORT` in both terminals so Vite's proxy targets the correct port. `dev:all` shares the `.env` settings automatically.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Edits do not appear | Use `npm run dev:all` and the Vite URL. `start` serves the last build. |
| API connection fails | Ensure the API is running on the configured port. Check the terminal for errors. |
| Executable not found | Set `CODEX_EXE` or `OPENCODE_EXE` to an existing executable and restart. |
| `codex-code-mode-host.exe` is missing | Update or repair Codex Desktop. Remove an override pointing to an incomplete installation, or point it to the complete installation. |
| An old Codex chat cannot use the Relay tool | Create a new conversation inside Relay Room and provide the task context. |
| A new chat uses the wrong folder | Check the sidebar project folder and any `WATCH_ROOT` override before creating the chat. |
| Port already in use | Stop the previous Relay Room terminal, or change `OPENCODE_OBSERVER_PORT` and restart. |

Settings are documented in [.env.example](.env.example). Local session links and the selected project are saved in `.relay-state/`. Keep that folder to retain the links after restarting. `.env`, `.relay-state/`, and `dist/` are ignored by Git. Do not put secrets in `VITE_` variables; they are exposed to the browser.

Network polling slows down when agents are idle: turn status checks every 5 seconds, transcripts and handoffs every 15 seconds, and file diffs every 60 seconds. Active conversations use faster updates. Session lists and health checks have a minimum interval of 30 seconds; model catalogs have a minimum interval of 5 minutes. Requests wait for the previous response before scheduling the next poll, and automatic polling pauses in hidden tabs. Codex file changes reuse the transcript response instead of fetching it separately. The **تحديث** button refreshes the session lists and health information immediately.
