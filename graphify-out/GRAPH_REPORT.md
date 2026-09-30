# Graph Report - opencode-observer  (2026-09-30)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 164 nodes · 275 edges · 10 communities (9 shown, 1 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- package.json
- server.mjs
- App.tsx
- App
- compilerOptions
- arCountOf
- cx
- formatClock
- ToolBlock

## God Nodes (most connected - your core abstractions)
1. `cx()` - 15 edges
2. `compilerOptions` - 15 edges
3. `App()` - 14 edges
4. `server` - 13 edges
5. `arCountOf()` - 10 edges
6. `isRecord()` - 8 edges
7. `normalizeBlock()` - 8 edges
8. `asString()` - 7 edges
9. `normalizeDiffs()` - 7 edges
10. `normalizeMessage()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `App()` --calls--> `arCountOf()`  [EXTRACTED]
  src/App.tsx → src/App.tsx  _Bridges community 3 → community 5_
- `App()` --calls--> `cx()`  [EXTRACTED]
  src/App.tsx → src/App.tsx  _Bridges community 3 → community 6_
- `CodexNotes()` --calls--> `asNumber()`  [EXTRACTED]
  src/App.tsx → src/App.tsx  _Bridges community 3 → community 7_
- `ChangedFiles()` --calls--> `arCountOf()`  [EXTRACTED]
  src/App.tsx → src/App.tsx  _Bridges community 5 → community 6_
- `ToolBlock()` --calls--> `arCountOf()`  [EXTRACTED]
  src/App.tsx → src/App.tsx  _Bridges community 5 → community 8_

## Import Cycles
- None detected.

## Communities (10 total, 1 thin omitted)

### Community 0 - "package.json"
Cohesion: 0.06
Nodes (31): dependencies, lucide-react, react, react-dom, devDependencies, tailwindcss, @tailwindcss/vite, @types/react (+23 more)

### Community 1 - "server.mjs"
Cohesion: 0.11
Nodes (30): ref_node_child_process, ref_node_crypto, ref_node_fs, ref_node_http, ref_node_path, ref_node_url, appDirectory, appendRelayEvent() (+22 more)

### Community 2 - "App.tsx"
Cohesion: 0.07
Nodes (25): AR_MONTHS, Block, CATEGORY_LABEL, COMMAND_KEYS, DiffHunk, DiffLine, EVENT_KIND_LABEL, EVENT_ROLE_LABEL (+17 more)

### Community 3 - "App"
Cohesion: 0.16
Nodes (21): api(), ApiError, App(), asArray(), asNumber(), asString(), collectToolOutput(), errorMessage() (+13 more)

### Community 4 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, allowJs, allowSyntheticDefaultImports, esModuleInterop, isolatedModules, jsx, lib, module (+8 more)

### Community 5 - "arCountOf"
Cohesion: 0.31
Nodes (10): arCountOf(), arNoun(), clamp(), compactTokens(), Conversation(), formatDate(), formatRelative(), ResultSummary() (+2 more)

### Community 6 - "cx"
Cohesion: 0.22
Nodes (9): ChangedFiles(), cx(), DiffRow(), MetaRow(), PanelTabs(), Pill(), Spinner(), StepReceipt() (+1 more)

### Community 7 - "formatClock"
Cohesion: 0.50
Nodes (4): CodexNotes(), formatClock(), MessageRow(), shortId()

### Community 8 - "ToolBlock"
Cohesion: 0.50
Nodes (4): snippet(), splitLines(), TechnicalBlock(), ToolBlock()

## Knowledge Gaps
- **68 isolated node(s):** `Block`, `DiffHunk`, `DiffLine`, `FileDiff`, `HealthPayload` (+63 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 83 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `package.json` to `App.tsx`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._
- **Why does `lucide-react` connect `package.json` to `App.tsx`?**
  _High betweenness centrality (0.085) - this node is a cross-community bridge._
- **What connects `Block`, `DiffHunk`, `DiffLine` to the rest of the system?**
  _68 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.06417112299465241 - nodes in this community are weakly interconnected._
- **Should `server.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.10695187165775401 - nodes in this community are weakly interconnected._
- **Should `App.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.06896551724137931 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._