# Open Zero

A local web app for chatting with Codex and handing implementation tasks to OpenCode. It includes project selection, model and reasoning controls, session permissions, and file-change summaries.

## Requirements

- Windows for the project-folder picker and Explorer integration.
- Node.js 22.12+ and npm.
- Codex Desktop installed and signed in. Open Zero uses its local `codex.exe` and app-server.
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

## Desktop app and Windows EXE

Install the project dependencies once on the build machine, then create the Windows desktop packages:

```powershell
npm ci
npm run dist:win
```

The output is written to `release/`. It contains a Windows installer and a portable `.exe` that launches **Open Zero** directly. Both use the app's custom icon. The installed app adds Start Menu and desktop shortcuts. Closing the app asks its local API server to shut down; session links and app settings remain in the current Windows user's app data folder.

The installer does not include personal Codex or OpenCode accounts. Each computer still needs Codex Desktop signed in and the compatible OpenCode CLI installed and configured. No Node.js or npm installation is required on computers that only run the packaged app. Project builds target Windows x64.

## Use the app

1. Select your project folder before creating a new Codex conversation.
2. Click **محادثة** to create a conversation for that project. Existing conversations keep their own project folder.
3. Choose the Codex model, reasoning level, and session permissions. Permission changes take effect with the next message.
4. Choose the OpenCode execution model in the delegation panel before the first handoff.
5. Chat with Codex normally, or include `$opencode` to request implementation. For example: `$opencode fix the job-grade search in this project`.
6. Follow the OpenCode replies and file-change summaries in the delegation panel. Use the review button to ask Codex to review the reply or implementation.

OpenCode starts delegated work only when the request includes `$opencode`. Direct OpenCode chat is available when the Codex conversation has no linked delegation session.

## Workflow setup

Open **الإعدادات → Setup · توزيع الأدوار** to choose an agent and model independently for the planner/reviewer and implementer. Save the setup, then create a new conversation. Each conversation keeps its assigned roles when the default changes or the app restarts; older conversations keep their existing roles.

You can choose Codex for both roles, including different Codex models. The main Codex conversation plans and reviews with read-only access. When its plan is ready, use **أرسل آخر خطة إلى شات Codex للتنفيذ** to start a separate, writable Codex conversation with the selected implementation model. The new execution chat appears in the session list. OpenCode-to-OpenCode is not currently supported.

With **Codex planning → OpenCode implementation**, chat with Codex and use `$opencode` to request a handoff as usual.

With **OpenCode planning → Codex implementation**, the main chat is OpenCode and the side chat is Codex. Discuss the task with OpenCode, then click **أرسل الخطة إلى Codex للتنفيذ** to send its completed reply to the linked Codex session. Once Codex finishes, click **اطلب من OpenCode المراجعة** to send the implementation conversation back for review. Each plan can be sent once; active work blocks another handoff. New Codex implementation sessions start with workspace-write access to their project.

Open **الإعدادات → الثيمات** to choose **الأساسي**, **Tokyo Night**, **Tokyo Night Storm**, **LaserWave**, **Sea Green Theme**, **Pro hacker theme**, **Huacat Pink Theme**, or **Cyberpunk 2077**. The original light appearance remains the default. Theme changes apply immediately across the app and are saved in this browser, including after a reload. Tokyo Night colors are adapted from the [original palette](https://github.com/tokyo-night/tokyo-night-vscode-theme); the other themes use their matching [VS Code Themes](https://vscodethemes.com/) palettes, adapted for readable chat and control states. Each theme has a source link in the picker. Huacat Pink uses its light variant; Cyberpunk 2077 uses JW Sandeman's version.

Claude and GLM are listed as future integrations and cannot be selected yet. The server agent registry is in `server/workflow.mjs`; adding an available agent will also require implementing its execution adapter and chat UI.

## MCP controls

Open **أدوات MCP · Codex** or **أدوات MCP · OpenCode** in the corresponding chat pane to see that agent's configured servers and switch them on or off. The lists load only when opened and include a manual refresh button.

Codex changes are saved in its local user configuration and apply to loaded conversations with the next message. Plugin MCP switches target the individual server. `codex_apps` controls the default app-connector enablement. A project or managed configuration can override the user setting; Open Zero reports this rather than showing a successful toggle.

OpenCode switches disconnect or reconnect the server in the current project at runtime. They last until OpenCode restarts and do not rewrite its configuration or delete credentials. Wait for active work to finish before changing a switch.

## Desktop updates

The GitHub Actions workflow at `.github/workflows/publish-desktop.yml` builds and publishes a Windows installer whenever code is pushed to `main` or `new-models`. Installed copies check GitHub Releases after startup and every six hours, download updates automatically, and install them on exit (or restart immediately from the update notice). Share the **Open Zero Setup** installer from the latest GitHub Release; the portable executable does not support automatic updates.

## Commands

### Reviewing Codex changes

Codex's changed-files list appears below the latest chat messages. **Accept changes** records the exact displayed completed edit IDs in local session metadata and hides them immediately and after reopening the app. New edits, including later changes to the same files, appear for review separately. Acceptance does not commit, revert, or modify project files, and does not consume a licensed message. The button stays disabled while Codex is working.

### Extensions and Nx Console

The project explorer offers **File name** and **In files** search modes. In files performs case-insensitive literal text search over saved UTF-8 files, groups matching snippets by file, and opens a selected match at its line/column in the file editor. Existing unsaved drafts are preserved. Generated directories and dependencies are excluded, as are binary, unreadable and files over 2 MiB. Searches are cancellable and bounded to 1,000 matches, 20,000 files and eight seconds; partial results are indicated in the UI.

In the Windows desktop app, **Show Terminal** has independent **PowerShell** and **OpenCode** tabs. PowerShell opens in the selected project folder; type directly in the terminal or enter a command such as `npm install` in the command field and press Enter or **Run**. Ctrl+C interrupts and Ctrl+V pastes. OpenCode starts from its session-ID form. Switching tabs or hiding the panel preserves both processes and their output; input, resize and cleanup are routed to the corresponding tab. The native terminal remains available only in the desktop app.

The **Agent / IDE** switch in the title bar replaces the main workspace: Agent displays conversations, while IDE displays the full-width editor and extensions. Switching preserves conversations, file drafts and the mounted IDE. **Settings → Extensions & Nx Console** also selects IDE mode. This workspace hosts local VS Code with its real Node extension host. Install VS Code on the computer first; on Windows Open Zero discovers `bin/code-tunnel.exe`, or you can set `VSCODE_CLI_EXE`. No editor runtime launches until you select **Start extension workspace**. The first launch requires accepting Microsoft's VS Code Server terms and downloads the server from Microsoft. The runtime listens on loopback with a generated connection token; Open Zero proxies HTTP and WebSocket connections under the same origin, preserving VS Code's frame policy. Runtime output and authentication URLs are not logged.

Wait for the embedded editor to load, then click **Install Nx Console**. Installation uses the downloaded server's own Node and extension CLI, targets `nrwl.angular-console`, and verifies its installed manifest. Open your Nx workspace folder and use the Nx sidebar inside the embedded editor. Other extensions can be searched, installed, enabled, or removed in VS Code's **Extensions** view (`Ctrl+Shift+X`). Extension files and VS Code settings stay under `.relay-state/extension-workbench/` (or the desktop's existing state directory), separate from the user's normal VS Code profile. Chat and CodeMirror drafts remain mounted while switching tabs. Reload file tabs after editing the same files in the embedded workbench; existing version checks protect unsaved drafts against overwriting newer disk edits.

Open Zero probes the editor after the CLI opens its port, triggering the initial download and keeping the iframe hidden until the real editor responds. The Extensions workspace shows download/setup state and vendor-reported percentages when available. Setup errors and a ten-minute timeout offer **Retry setup**, which restarts the owned host without deleting saved extensions. Incomplete staging folders are excluded from runtime discovery. The proxy authenticates HTTP and WebSocket requests with the server's token cookie instead of repeatedly adding a query token that causes root-page redirects.

The Stop button and application shutdown terminate the owned runtime. Switching tabs preserves it; switching project folders opens the new folder without discarding installed extensions. A folder without `nx.json` displays guidance instead of modifying it or installing Nx into the project. Build and isolated automated bridge checks do not prove Nx activation, generator behavior, or the embedded interface at runtime; those manual checks remain with the user.

In **Project conversations**, use the pencil beside a conversation to rename it inline (Enter to save, Escape to cancel). The archive icon moves an idle conversation to **Archived**; restore it there to reopen the same history and links. Running work must finish before archiving. Both current and archived lists show the newest conversation activity first, with provider timestamps normalized to milliseconds. Renaming does not overwrite the local message-activity timestamp. These controls use Codex's metadata/archive APIs and do not send an agent message or consume a licensed request.

| Command | Purpose |
| --- | --- |
| `npm run dev:all` | Frontend and API together, with automatic reload. |
| `npm run dev` | Vite frontend only; requires the API running separately. |
| `npm run dev:api` | API only, with Node watch mode. |
| `npm run build` | Type-check and build the frontend into `dist/`. |
| `npm run start` | API and built frontend, without watch mode. |

When running the development servers separately with a custom API port, set `OPENCODE_OBSERVER_PORT` in both terminals so Vite's proxy targets the correct port. `dev:all` shares the `.env` settings automatically.

## Troubleshooting

The Codex composer floats without an outer background. Model, reasoning and permissions are icon menus inside the input; hover or focus an icon to see its current value. The gauge shows the remaining weekly Codex allowance from `account/rateLimits/read`; an adjacent clock marked **5h** shows the remaining five-hour allowance when supplied. Both reuse the same request and shared server cache, refreshed at most once per minute. A dash means the account did not supply a seven-day quota; the five-hour indicator is hidden when unavailable. Sending resumes automatic streaming scroll; scrolling upward pauses following until you send again or jump to the latest message.

### Diagnose old Codex role instructions

Transcript and settings GET requests do not resume a thread or claim writer ownership. A conversation open in Codex Desktop or another app-server can still be read through persisted item pagination. Sending remains a writer operation; if another application owns that session, the API reports an explicit conflict (409) without interrupting it or replacing its ID/history. Role instruction refresh is performed when preparing a write, rather than as a side effect of reading messages.

`GET /api/codex/threads/<threadId>/instructions` reports the saved role's selected instruction source, its expected text, and the last actual `thread/start` or `thread/resume` request observed by this API process. Reading this endpoint does not start Codex, resume a thread, change permissions, or interrupt a turn. `rpc-accepted` means Codex acknowledged the request; `effectiveInstructions: "unverified"` deliberately does not claim that the model's context was replaced.

New instruction requests are also recorded in `.relay-state/codex-instructions.jsonl` (or `RELAY_STATE_DIR`). These records contain generated role instructions and RPC metadata, without prompts, tokens, or response bodies. An `auditWriteError` indicates that the disk audit could not be written. Requests made before this feature was installed cannot be reconstructed from that log.

Run `node scripts/audit-codex-instructions.mjs <threadId>` to compare the captured request with developer messages in the saved Codex rollout. Omit the ID to inspect all locally registered threads. This reads local files only and outputs hashes, timestamps, and restriction matches instead of message contents. A historical restriction or a missing replacement in the rollout is evidence about persistence, not proof of the current model context, particularly after compaction. Keep the same session and use the next normal user turn for behavioral confirmation.

### General issues

| Symptom | What to check |
| --- | --- |
| Edits do not appear | Use `npm run dev:all` and the Vite URL. `start` serves the last build. |
| API connection fails | Ensure the API is running on the configured port. Check the terminal for errors. |
| Executable not found | Set `CODEX_EXE` or `OPENCODE_EXE` to an existing executable and restart. |
| `codex-code-mode-host.exe` is missing | Update or repair Codex Desktop. Remove an override pointing to an incomplete installation, or point it to the complete installation. |
| An old Codex chat cannot use the Relay tool | Create a new conversation inside Open Zero and provide the task context. |
| A new chat uses the wrong folder | Check the sidebar project folder and any `WATCH_ROOT` override before creating the chat. |
| Port already in use | Stop the previous Open Zero terminal, or change `OPENCODE_OBSERVER_PORT` and restart. |

Settings are documented in [.env.example](.env.example). Local session links and the selected project are saved in `.relay-state/`. Keep that folder to retain the links after restarting. `.env`, `.relay-state/`, and `dist/` are ignored by Git. Do not put secrets in `VITE_` variables; they are exposed to the browser.

Network polling slows down when agents are idle: turn status checks every 5 seconds, transcripts and handoffs every 15 seconds, and file diffs every 60 seconds. Active conversations use faster updates. Session lists and health checks have a minimum interval of 30 seconds; model catalogs have a minimum interval of 5 minutes. Requests wait for the previous response before scheduling the next poll, and automatic polling pauses in hidden tabs. Codex file changes reuse the transcript response instead of fetching it separately. The **تحديث** button refreshes the session lists and health information immediately.
