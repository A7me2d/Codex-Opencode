# Open Zero

A local web app for chatting with Codex and handing implementation tasks to OpenCode. It includes project selection, model and reasoning controls, session permissions, and file-change summaries.

The **Auto** switch beside **Agent / IDE** enables visible automatic project previews. It opens a random source file and scrolls to a random position immediately, then every 30 seconds, using one reusable clean preview tab. Unsaved drafts pause navigation; switching to IDE or turning the switch off stops it. It starts disabled each launch, skips generated folders and common sensitive filenames, and does not edit files or capture screenshots.

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

The GitHub Actions workflow at `.github/workflows/publish-desktop.yml` builds and publishes a Windows installer only when code is pushed to `main`, including after merging a pull request. Pushing to development or feature branches does not create desktop releases. Installed copies check GitHub Releases after startup and every six hours, download updates automatically, and install them on exit (or restart immediately from the update notice). Share the **Open Zero Setup** installer from the latest GitHub Release; the portable executable does not support automatic updates.

Desktop release versions use decimal rollover of the workflow run number: run 9 is `1.0.9`, run 10 is `1.1.0`, run 99 is `1.9.9`, and run 100 is `2.0.0`. The same calculated version is used for the package, release tag and updater assets. Rerunning a workflow retains its version; failed runs can leave gaps in the numbering. Existing `1.0.59` installations can upgrade to the new numbering (for example, run 60 produces `1.6.0`).

## Commands

### Reviewing Codex changes

The sidebar's Git branch tab opens **Source Control** (`Ctrl+Shift+G`). **Changes**, **Staged Changes** and **Merge Changes** follow VS Code naming. Select a file to preview its diff, use **Stage Changes** / **Unstage Changes** per file or for a group, enter a message, and select **Commit**. Commit records only the staged snapshot; **Push** uploads the current branch to its upstream. Without an upstream, **Publish Branch** uses a configured remote. No force push, automatic staging, fetch, commit or upload runs when opening the view. Git must be installed and the selected folder must be the repository root. Push uses your existing Git authentication; Source Control does not store credentials. Saves in the editor must reach disk before staging.

The sparkle button **Generate Commit Message** uses the current Codex model (or the account default) and only the staged diff. It runs in a separate ephemeral read-only thread, with structured output and a one-minute generation timeout. Each generation consumes one licensed request using the existing message-ID accounting. It fills the editable message field, leaving Commit and Push as separate explicit actions. Generation errors preserve your existing draft; changed staging is rejected so the message is not applied to a different snapshot. The selected Codex chat's history, permissions and active turn are untouched.

File tabs use a solid VS Code Dark+ inspired editor palette with syntax highlighting, line numbers, selections, search matches and completion menus. The editor palette stays independent of Liquid Glass and the surrounding chat theme.

Opening a file in the Agent workspace keeps the current conversation in a movable, resizable floating panel. Drag its title bar, use **Pin beside editor** to dock it (below the editor in narrow layouts), or minimize it. **Show full conversation** returns to the main chat without closing file tabs. The conversation remains mounted across these modes, and the panel position, size and pin preference are remembered. **Add code to chat** fills the same draft and expands/focuses the panel while keeping the file open; it does not send a message. File editing inside the separate embedded IDE retains its existing behavior.

The editor toolbar's **Auto Save** switch is off by default and remembers your choice. When enabled, dirty file tabs save after an 800 ms typing pause, one request at a time. Edits typed during a save remain dirty and save next. Version checks prevent overwriting external edits; an automatic save failure pauses Auto Save and displays the error. The footer shows Draft, Saving or Saved.

Codex's changed-files list appears below the latest chat messages. **Accept changes** records the exact displayed completed edit IDs in local session metadata and hides them immediately and after reopening the app. New edits, including later changes to the same files, appear for review separately. Acceptance does not commit, revert, or modify project files, and does not consume a licensed message. The button stays disabled while Codex is working.

### Cline

Choose **Cline** as the **planner/reviewer** or **executor** in **Settings → Agents & roles**, select a model, save, and create a project conversation from the existing sidebar. Cline uses the main chat or its linked execution panel, with the same Send plan / Review reply actions; there is no independent Cline chat switcher. Both roles can use Cline with separate underlying sessions. Existing conversations retain their roles and history. The provider defaults to your **Cline** account and also supports **OpenRouter** and **Anthropic**. Install the global CLI with `npm i -g cline` and authenticate with `cline auth` if necessary. Existing CLI authentication is reused without changing global defaults. Credentials stay in process memory/environment and are excluded from app metadata, logs and HTTP responses.

Open Zero starts an owned native Cline process per bound role using ACP over stdio, with local execution and automatic tool approval disabled initially. The planner starts in Plan mode; the executor starts in Act mode. Advertised model/mode/approval controls and tool permission requests appear in the role's chat. **Reconnect** refreshes local authentication and restores that role's conversation/history without interrupting active work. Sending is license-gated once per workflow action, with stable message IDs and guards against executing/reviewing the same reply twice. Parent conversations use the existing rename, archive/restore, project filtering and activity sorting. File-editor selections target only the main planner draft. The chat initially shows the latest five messages and loads older history through the shared scrolling behavior.

Model choices come from the installed CLI's model catalog; models with zero input/output prices are shown first and marked **FREE**. This is catalog information, not verification of account entitlement, promotions, quota or billing. Select a model explicitly: an unavailable saved model blocks the connection instead of falling back to another model. Cline CLI is not bundled with the installer and must be installed/authenticated on each computer. Automated bridge/workflow tests use synthetic ACP peers, credentials and messages; build success does not prove live model access, OAuth renewal, real tool execution or session restoration with the installed CLI.

### Extensions and Nx Console

Choosing a project folder on Windows uses the modern Common Item Dialog in folder mode, with Explorer navigation, an address bar and search, instead of the legacy Browse for Folder tree. It starts at the current project; cancelling leaves the project unchanged.

The project explorer offers **File name** and **In files** search modes. In files performs case-insensitive literal text search over saved UTF-8 files, groups matching snippets by file, and opens a selected match at its line/column in the file editor. Existing unsaved drafts are preserved. Generated directories and dependencies are excluded, as are binary, unreadable and files over 2 MiB. Searches are cancellable and bounded to 1,000 matches, 20,000 files and eight seconds; partial results are indicated in the UI.

In the Windows desktop app, **Show Terminal** has independent **PowerShell** and **OpenCode** tabs. PowerShell opens in the selected project folder; type directly in the terminal or enter a command such as `npm install` in the command field and press Enter or **Run**. Ctrl+C interrupts and Ctrl+V pastes. OpenCode starts from its session-ID form. Switching tabs or hiding the panel preserves both processes and their output; input, resize and cleanup are routed to the corresponding tab. The native terminal remains available only in the desktop app.

The **Agent / IDE** switch opens conversations/editor or the extension manager. IDE provides **Marketplace**, **Installed**, **Install**, **Update**, **Uninstall**, **Enable**, and **Disable**. Packages are downloaded and extracted into the existing Open Zero extension directory; the personal VS Code profile is untouched. There is no VS Code Server download, embedded workbench, or setup/start requirement. Previous installed packages remain visible. Marketplace search sends only the query/pagination; extension installation downloads the selected VSIX.

The Agent CodeMirror editor reads enabled VS Code snippet contributions (JSON/JSONC), filters by file language, and expands snippets with Tab placeholders and common filename variables. Installed and enabled **bradlc.vscode-tailwindcss** activates the bundled official Tailwind CSS Language Server over local stdio; completion requests use the current unsaved document and selected project configuration. Tailwind requires a valid Tailwind project. Enable/Disable immediately reconfigures open editors without replacing their document, cursor or undo history. **Ctrl+Space** explicitly requests completions.

This is a native Agent integration, not a general VS Code API host. Extensions without snippet contributions or the Tailwind bridge are labeled unsupported and cannot be enabled. Nx Console currently requires unsupported VS Code APIs; installing it does not make it run in Agent. Arbitrary extension JavaScript is never executed by the manager. VSIX extraction rejects traversal, bounds download/expanded sizes, validates package identity, and stages before publishing. Legacy VS Code cache/data is preserved rather than deleted. Isolated tests verify package operations and protocol behavior; they do not prove activation/completions in a real user project.

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
