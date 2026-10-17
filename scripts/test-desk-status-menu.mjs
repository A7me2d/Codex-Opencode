import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * Isolated source-contract check for the collapsible desk status panel.
 *
 * This asserts the folding contract is present in the owned sources (a11y
 * attributes, Escape/outside-click wiring, preference key, single poller,
 * bounded scroll, reduced-motion, RTL/locales). It is a static check only —
 * no browser, no build, no visual or live verification.
 */

const component = await readFile('src/features/super-agent/DeskStatusPanel.tsx', 'utf8')
const stylesheet = await readFile('src/features/super-agent/desk-status-menu.css', 'utf8')

const outsideEffect = component.match(/useEffect\(\(\) => \{\s*if \(!open\) return[\s\S]*?\n  \}, \[open\]\)/)?.[0] || ''

// Public contract of the component is unchanged for its consumers.
for (const name of ['export type DeskStatus ', 'export type DeskStatusEntry', 'export type DeskStatusSummary', 'export type DeskStatusTeamRef', 'export function DeskStatusPanel']) {
  assert.ok(component.includes(name), `missing export: ${name.trim()}`)
}
assert.ok(component.includes('visible && team?.id ? () => api.superDeskStatus(team.id)'), 'polling must stay gated on the hidden-panel state')
assert.equal(component.match(/usePolling\(/g)?.length, 1, 'exactly one poller: folding must not add queries')
assert.ok(!/open \? \(\) => api\.superDeskStatus/.test(component), 'the poller must not depend on the open state')

// Toggle semantics: small labelled trigger with a count and aria state.
assert.ok(component.includes('data-desk-status-trigger'), 'trigger marker missing')
assert.ok(component.includes('aria-expanded={open}'), 'aria-expanded missing on the trigger')
assert.ok(component.includes('aria-controls={listId}'), 'aria-controls missing on the trigger')
assert.ok(/<List className/.test(component) && component.includes('ChevronDown'), 'trigger icon/chevron missing')
assert.ok(component.includes("ar ? 'حالة المكاتب' : 'Desk statuses'"), 'bilingual trigger label missing')
assert.ok(component.includes('{desks.length ?'), 'desk count badge missing')

// Preference persistence under an independent key, tolerant of unavailable storage.
assert.ok(component.includes("'openzero.super-agent.desk-status-open'"), 'independent preference key missing')
assert.ok(/try \{ return window\.localStorage\.getItem\(OPEN_PREFERENCE_KEY\)/.test(component), 'preference read must be guarded')
assert.ok(/try \{ window\.localStorage\.setItem\(OPEN_PREFERENCE_KEY/.test(component), 'preference write must be guarded')

// Escape closes the menu, stops propagation (so the workspace Escape does not fire too) and restores focus.
assert.ok(/event\.key !== 'Escape' \|\| !open\) return/.test(component.replace(/\n/g, ' ')), 'Escape must be handled only while open')
assert.ok(/event\.key !== 'Escape'[\s\S]{0,300}stopPropagation\(\)[\s\S]{0,60}close\(true\)/.test(component), 'Escape must stop propagation and refocus the trigger')

// Outside press closes without swallowing clicks: no preventDefault in the outside-click path.
assert.ok(outsideEffect.includes("document.addEventListener('pointerdown', outside)"), 'outside pointerdown listener missing')
assert.ok(outsideEffect.includes("document.removeEventListener('pointerdown', outside)"), 'outside listener cleanup missing')
assert.ok(!outsideEffect.includes('preventDefault') && !outsideEffect.includes('stopPropagation'), 'outside click must not be swallowed')

// The open list keeps the real statuses and desk-open links, bounded with scroll.
assert.ok(component.includes('max-h-64') && component.includes('overflow-y-auto'), 'menu must be height-bounded and scrollable')
assert.ok(component.includes('onOpenDesk(desk.id)'), 'desk-open links must be preserved')
assert.ok(component.includes('data-desk-status={desk.id}') && component.includes('data-status={desk.status}'), 'status markers must be preserved')
assert.ok(component.includes("summary.error ? { ...desk, status: 'unknown' }"), 'error-to-unknown mapping must be preserved')

// RTL/theme/locales: direction follows the locale, both languages present for the new copy.
assert.ok(component.includes('dir={direction()}'), 'RTL direction missing')
for (const copy of ['طي قائمة حالة المكاتب', 'فتح قائمة حالة المكاتب', 'Collapse desk statuses', 'Open desk statuses', 'حالة كل مكتب', 'Each desk status']) {
  assert.ok(component.includes(copy), `missing localized copy: ${copy}`)
}
assert.ok(component.includes("'openzero.super-agent.desk-status-open'") && !component.includes('style='), 'no inline styles: theme stays in CSS tokens')

// Folding chrome stylesheet: light chevron motion, reduced-motion off-switch.
assert.ok(stylesheet.includes('.desk-status-chevron { transition:'), 'chevron motion missing')
assert.ok(stylesheet.includes('[data-desk-status-open="true"] .desk-status-chevron'), 'open-state chevron rotation missing')
assert.ok(/@media \(prefers-reduced-motion: reduce\)/.test(stylesheet), 'reduced-motion opt-out missing')

console.log('Passed: desk status menu source contract (exports, one poller gated on visibility, aria-expanded/controls, Escape stop+refocus, outside click not swallowed, guarded preference key, bounded scrollable menu, preserved desk links/status mapping, RTL + bilingual copy, chevron motion with reduced-motion opt-out). Static check only: no browser, build, or visual verification.')
