/**
 * The panel's stylesheet, injected once when the panel mounts.
 *
 * Two things this replaces, and why:
 *
 * The colours were a hardcoded dark palette. DeepSeek Harness publishes its
 * design tokens as `--dsw-alias-*` custom properties on `body`, swapped under
 * `body[data-ds-dark-theme]`, so reading them is all it takes to follow the
 * light/dark theme the operator actually chose — a dark modal over a light
 * Harness was the panel announcing it was bolted on.
 *
 * The layout was inline style objects, which cannot express `:hover`,
 * `:focus-visible`, transitions, hairline borders, or media queries. Apple's
 * interface language is mostly in those places: a control that responds to the
 * pointer, a 0.5px divider that stays 0.5px on a Retina display, a blurred
 * translucent surface, and motion on the standard easing curve. So the panel
 * gets a real stylesheet, and inline styles are left only for values that are
 * genuinely per-render.
 *
 * Every selector is prefixed `lab-` and scoped under `.lab-root`, because this
 * sheet is injected into the Harness document and must not reach anything else.
 */

/** Class-name prefix; also the scope root. */
export const CLASS_PREFIX = 'lab'

export const PANEL_STYLES = `
.lab-root {
  /* Bridge the Harness tokens into short local names. Anything the theme does
     not define falls back to a value that still reads correctly, so the panel
     survives a Harness that renames a token. */
  --lab-bg: var(--dsw-alias-bg-base, #fff);
  --lab-surface: var(--dsw-alias-bg-layer-1, #fff);
  --lab-raised: var(--dsw-alias-bg-layer-2, #fafafa);
  --lab-sunken: var(--dsw-alias-bg-layer-3, #f5f5f7);

  --lab-text: var(--dsw-alias-label-primary, #0f1115);
  --lab-text-2: var(--dsw-alias-label-secondary, #61666b);
  --lab-text-3: var(--dsw-alias-label-tertiary, #81858c);
  --lab-caption: var(--dsw-alias-label-caption, #81858c);

  /* Harness light mode paints bg-base, layer-1, layer-2 and layer-3 all pure
     white — it separates surfaces with hairlines and whitespace, not with tone,
     and only dark mode has a real tonal stack. Large containers therefore use
     the layer tokens directly (matching the rest of the Harness), while small
     emphasis surfaces — the operator's own message, a tool row, a chip — mix a
     few percent of the text colour into the background. That reads as a faint
     grey on white and a faint light on near-black, so the same rule holds in
     both themes instead of vanishing in one of them. */
  --lab-fill: color-mix(in srgb, var(--lab-text) 5%, transparent);
  --lab-fill-strong: color-mix(in srgb, var(--lab-text) 8%, transparent);
  --lab-line: var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));
  --lab-line-strong: var(--dsw-alias-border-l3, rgba(0, 0, 0, .12));
  --lab-hover: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06));
  --lab-active: var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, .1));
  --lab-accent: var(--dsw-alias-button-primary-fill, #0f1115);
  --lab-accent-hover: var(--dsw-alias-button-primary-hover, #232733);
  --lab-on-accent: var(--dsw-alias-label-primary-inverted, #fff);
  --lab-danger: var(--dsw-alias-state-error-primary, #ec1313);
  --lab-warn: var(--dsw-alias-state-warn-label, #dd8629);
  --lab-success: var(--dsw-alias-state-success-primary, #22c55e);

  /* Apple's system font stack, then the Harness family as a fallback. */
  --lab-font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue',
    'Segoe UI', system-ui, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  --lab-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;

  /* HIG-ish radii: containers rounder than controls, controls rounder than chips. */
  --lab-r-window: 14px;
  --lab-r-card: 12px;
  --lab-r-control: 9px;
  --lab-r-chip: 999px;

  /* One easing curve for everything, Apple's standard decelerate. */
  --lab-ease: cubic-bezier(.32, .72, 0, 1);
  --lab-fast: .16s;
  --lab-slow: .28s;

  font-family: var(--lab-font);
  color: var(--lab-text);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  font-feature-settings: 'cv11', 'ss01';
}

/* A true hairline: 1 physical pixel, so it does not fatten on Retina. */
@media (min-resolution: 2dppx) {
  .lab-root { --lab-hairline: .5px; }
}
.lab-root { --lab-hairline: 1px; }

/* ---------------------------------------------------------------- trigger */

.lab-trigger {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 36px;
  min-height: 36px;
  padding: 6px 8px;
  border-radius: var(--lab-r-control);
  font: inherit;
  transition: background var(--lab-fast) var(--lab-ease);
}
.lab-trigger:hover { background: var(--lab-hover); }
.lab-trigger:active { background: var(--lab-active); }

/* ------------------------------------------------------------ scrim + window */

.lab-scrim {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 20px;
  /* Vibrancy rather than a flat dim: the Harness stays legible underneath,
     which is what makes the panel read as a sheet over the app. */
  background: color-mix(in srgb, var(--lab-bg) 55%, transparent);
  backdrop-filter: saturate(180%) blur(24px);
  -webkit-backdrop-filter: saturate(180%) blur(24px);
  animation: lab-scrim-in var(--lab-slow) var(--lab-ease);
}
@keyframes lab-scrim-in { from { opacity: 0 } to { opacity: 1 } }

.lab-window {
  width: min(1320px, 100%);
  height: min(860px, 100%);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: var(--lab-surface);
  border: var(--lab-hairline) solid var(--lab-line);
  border-radius: var(--lab-r-window);
  overflow: hidden;
  /* Positioning context for the nested directory sheet. */
  position: relative;
  /* Layered, soft, slightly cool — an Apple sheet shadow rather than a drop. */
  box-shadow:
    0 0 0 .5px rgba(0, 0, 0, .04),
    0 12px 24px -8px rgba(0, 0, 0, .12),
    0 40px 80px -24px rgba(0, 0, 0, .28);
  animation: lab-window-in var(--lab-slow) var(--lab-ease);
}
@keyframes lab-window-in {
  from { opacity: 0; transform: scale(.98) translateY(8px) }
  to { opacity: 1; transform: none }
}
@media (prefers-reduced-motion: reduce) {
  .lab-scrim, .lab-window { animation: none }
}

/* -------------------------------------------------------------------- header */

.lab-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px 14px 20px;
  border-bottom: var(--lab-hairline) solid var(--lab-line);
  background: var(--lab-surface);
}
.lab-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -.01em;
}
.lab-subtitle {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--lab-text-3);
}
.lab-titlebar-actions { display: flex; gap: 6px; }

/* ---------------------------------------------------------------------- body */

.lab-body {
  min-height: 0;
  display: grid;
  /* One variable drives the whole layout: the main column is 1fr, so it takes
     back exactly what the sidebar gives up and nothing has to be told twice. */
  grid-template-columns: var(--lab-aside-width, 288px) minmax(0, 1fr);
  transition: grid-template-columns var(--lab-slow) var(--lab-ease);
}
@media (prefers-reduced-motion: reduce) {
  .lab-body { transition: none }
}
/* Collapsed: an icon rail. Narrow enough to be a rail, wide enough for a 32px
   control plus its breathing room. */
.lab-body--collapsed { --lab-aside-width: 52px; }
.lab-body--collapsed .lab-aside { padding: 10px 9px; align-items: center; }
/* Everything except the rail's own buttons is out, not merely hidden, so the
   collapsed rail cannot scroll or catch focus. */
.lab-body--collapsed .lab-aside > *:not(.lab-rail) { display: none; }
.lab-rail { display: none; }
.lab-body--collapsed .lab-rail { display: grid; gap: 6px; }
.lab-aside {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-right: var(--lab-hairline) solid var(--lab-line);
  /* Layered in dark mode, a whisper of fill in light mode where every layer
     token is the same white. */
  background: color-mix(in srgb, var(--lab-raised) 100%, transparent);
  background-image: linear-gradient(var(--lab-fill), var(--lab-fill));
}
.lab-main {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: var(--lab-bg);
}

/* --------------------------------------------------------------------- cards */

.lab-card {
  border: var(--lab-hairline) solid var(--lab-line);
  border-radius: var(--lab-r-card);
  background: var(--lab-surface);
  padding: 12px;
}
.lab-card-title {
  margin: 0 0 2px;
  font-size: 13px;
  font-weight: 600;
}
.lab-card-hint {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--lab-text-3);
}
.lab-card--attention { border-color: color-mix(in srgb, var(--lab-warn) 45%, var(--lab-line)); }
.lab-card--attention .lab-card-title { color: var(--lab-warn); }

.lab-section-label {
  margin: 2px 2px 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--lab-caption);
}

/* Every single-column grid in the panel declares minmax(0, 1fr). A bare grid
   sizes its implicit column to max-content, so one long session title widened
   the track past the sidebar and pushed the status chip out of view — the
   default refuses to shrink below the content, and hiding the overflow would
   only have hidden the symptom. */
.lab-field { display: grid; grid-template-columns: minmax(0, 1fr); gap: 5px; }
.lab-field-label { font-size: 12px; color: var(--lab-text-2); }
.lab-stack { display: grid; grid-template-columns: minmax(0, 1fr); gap: 9px; }
.lab-row { display: flex; gap: 8px; }
.lab-row > .lab-grow { flex: 1; }

/* ------------------------------------------------------------------ controls */

.lab-input,
.lab-select,
.lab-textarea {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  font-size: 13px;
  color: var(--lab-text);
  background: var(--lab-bg);
  border: var(--lab-hairline) solid var(--lab-line-strong);
  border-radius: var(--lab-r-control);
  padding: 7px 10px;
  outline: none;
  transition: border-color var(--lab-fast) var(--lab-ease), box-shadow var(--lab-fast) var(--lab-ease);
}
.lab-select { appearance: none; padding-right: 28px; cursor: pointer;
  /* Chevron drawn in CSS so it inherits the text colour in both themes. */
  background-image: linear-gradient(45deg, transparent 50%, currentColor 50%),
    linear-gradient(135deg, currentColor 50%, transparent 50%);
  background-position: calc(100% - 15px) calc(50% + 1px), calc(100% - 11px) calc(50% + 1px);
  background-size: 4px 4px, 4px 4px;
  background-repeat: no-repeat;
}
.lab-textarea { min-height: 62px; resize: vertical; line-height: 1.5; }
.lab-input:focus-visible,
.lab-select:focus-visible,
.lab-textarea:focus-visible {
  border-color: color-mix(in srgb, var(--lab-accent) 55%, transparent);
  box-shadow: 0 0 0 3.5px color-mix(in srgb, var(--lab-accent) 16%, transparent);
}
.lab-input:disabled, .lab-select:disabled, .lab-textarea:disabled { opacity: .5; cursor: default; }
.lab-input::placeholder, .lab-textarea::placeholder { color: var(--lab-text-3); }

.lab-btn {
  appearance: none;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--lab-text);
  background: var(--lab-surface);
  border: var(--lab-hairline) solid var(--lab-line-strong);
  border-radius: var(--lab-r-control);
  padding: 7px 12px;
  min-height: 32px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  white-space: nowrap;
  transition: background var(--lab-fast) var(--lab-ease),
    border-color var(--lab-fast) var(--lab-ease),
    transform var(--lab-fast) var(--lab-ease);
}
.lab-btn:hover:not(:disabled) { background: var(--lab-hover); }
/* A small, quick press: the control acknowledges the pointer, HIG-style. */
.lab-btn:active:not(:disabled) { transform: scale(.975); background: var(--lab-active); }
.lab-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px color-mix(in srgb, var(--lab-accent) 16%, transparent);
}
.lab-btn:disabled { opacity: .42; cursor: default; }
/* A disabled primary keeps its shape but drops the solid fill, so it does not
   read as an enabled grey button. */
.lab-btn--primary:disabled {
  opacity: 1;
  color: var(--lab-text-3);
  background: var(--lab-fill);
  border-color: transparent;
}

.lab-btn--primary {
  color: var(--lab-on-accent);
  background: var(--lab-accent);
  border-color: transparent;
  font-weight: 600;
}
.lab-btn--primary:hover:not(:disabled) { background: var(--lab-accent-hover); }
.lab-btn--primary:active:not(:disabled) { background: var(--lab-accent-hover); }

.lab-btn--danger { color: var(--lab-danger); border-color: color-mix(in srgb, var(--lab-danger) 32%, var(--lab-line)); }
.lab-btn--danger:hover:not(:disabled) { background: color-mix(in srgb, var(--lab-danger) 8%, transparent); }

.lab-btn--icon { padding: 0; width: 32px; min-height: 32px; }

/* ------------------------------------------------------------ session list */

.lab-sessions { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
.lab-session {
  appearance: none;
  font: inherit;
  text-align: left;
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 3px;
  padding: 9px 10px;
  color: var(--lab-text);
  background: transparent;
  border: var(--lab-hairline) solid transparent;
  border-radius: var(--lab-r-control);
  cursor: pointer;
  transition: background var(--lab-fast) var(--lab-ease);
}
.lab-session:hover { background: var(--lab-hover); }
.lab-session[aria-current='true'] {
  background: var(--lab-surface);
  border-color: var(--lab-line-strong);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .04);
}
.lab-session-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; }
.lab-session-name {
  font-size: 13px;
  font-weight: 500;
  /* Without min-width a flex item refuses to shrink below its content, which
     pushed the status chip outside the card. */
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lab-session-meta { font-size: 11px; color: var(--lab-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.lab-chip {
  flex: none;
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
  padding: 4px 7px;
  border-radius: var(--lab-r-chip);
  color: var(--lab-text-2);
  background: var(--lab-fill-strong);
  white-space: nowrap;
}
.lab-chip--busy { color: var(--lab-on-accent); background: var(--lab-accent); }
.lab-chip--attention {
  color: var(--lab-warn);
  background: color-mix(in srgb, var(--lab-warn) 14%, transparent);
}

/* ---------------------------------------------------------------- toolbar */

.lab-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 16px;
  border-bottom: var(--lab-hairline) solid var(--lab-line);
  background: var(--lab-bg);
}
.lab-toolbar-title { margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -.005em; }
.lab-toolbar-meta { margin: 2px 0 0; font-size: 12px; color: var(--lab-text-3); }
.lab-toolbar-actions { display: flex; align-items: center; gap: 8px; flex: none; }

/* Context usage reads as a quiet meter, not a headline: it matters when it is
   nearly full and should be ignorable otherwise. */
.lab-usage { display: flex; align-items: center; gap: 7px; flex: none; }
.lab-usage-text { font-family: var(--lab-mono); font-size: 11px; color: var(--lab-text-3); white-space: nowrap; }
.lab-usage-bar {
  width: 46px;
  height: 4px;
  border-radius: var(--lab-r-chip);
  background: var(--lab-fill-strong);
  overflow: hidden;
}
.lab-usage-fill {
  height: 100%;
  border-radius: var(--lab-r-chip);
  background: var(--lab-text-3);
  transition: width var(--lab-slow) var(--lab-ease), background var(--lab-slow) var(--lab-ease);
}
/* Only shifts colour once it is worth acting on. */
.lab-usage-fill--warn { background: var(--lab-warn); }
.lab-usage-fill--full { background: var(--lab-danger); }

/* --------------------------------------------------------------- timeline */

.lab-timeline {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 18px clamp(14px, 3vw, 32px);
  scroll-behavior: smooth;
}
.lab-stream { max-width: 860px; margin: 0 auto; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }

.lab-row-card {
  border-radius: var(--lab-r-card);
  padding: 10px 13px;
  border: var(--lab-hairline) solid var(--lab-line);
  background: var(--lab-surface);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.55;
  animation: lab-row-in var(--lab-fast) var(--lab-ease);
}
@keyframes lab-row-in { from { opacity: 0 } to { opacity: 1 } }
@media (prefers-reduced-motion: reduce) { .lab-row-card { animation: none } }

.lab-row-label {
  display: block;
  margin-bottom: 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .05em;
  text-transform: uppercase;
  color: var(--lab-text-3);
}

/* The operator's own message is the one thing that should read as "mine". */
.lab-row-card--user {
  margin-left: auto;
  max-width: 92%;
  background: var(--lab-fill);
  border-color: transparent;
}
.lab-row-card--reasoning { background: transparent; border-style: dashed; color: var(--lab-text-2); }
.lab-row-card--status { background: transparent; border-color: transparent; padding: 2px 13px; color: var(--lab-text-3); font-size: 12px; }
.lab-row-card--status .lab-row-label { margin-bottom: 0; display: inline; margin-right: 8px; }
.lab-row-card--tool { font-family: var(--lab-mono); font-size: 12px; background: var(--lab-fill); border-color: transparent; }
.lab-row-card--error {
  border-color: color-mix(in srgb, var(--lab-danger) 35%, var(--lab-line));
  background: color-mix(in srgb, var(--lab-danger) 6%, var(--lab-surface));
}
.lab-row-card--error .lab-row-label { color: var(--lab-danger); }

/* ------------------------------------------------------------- tool detail */

.lab-tool-toggle {
  appearance: none;
  font: inherit;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .05em;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 0;
  color: var(--lab-text-3);
  background: transparent;
  border: 0;
  cursor: pointer;
  text-align: left;
}
.lab-tool-toggle:hover { color: var(--lab-text-2); }
.lab-tool-toggle-hint { font-weight: 500; text-transform: none; letter-spacing: 0; opacity: .8; }
.lab-tool-detail { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; margin-top: 9px; }
.lab-tool-field { display: grid; grid-template-columns: minmax(0, 1fr); gap: 3px; }
.lab-tool-field-label { font-size: 10px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--lab-text-3); }
.lab-tool-pre {
  margin: 0;
  padding: 8px 10px;
  max-height: 260px;
  overflow: auto;
  overscroll-behavior: contain;
  font-family: var(--lab-mono);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--lab-text);
  background: var(--lab-bg);
  border: var(--lab-hairline) solid var(--lab-line);
  border-radius: 7px;
}
.lab-tool-truncated { font-size: 11px; color: var(--lab-text-3); }

/* ------------------------------------------------------- interaction card */

.lab-interaction {
  border: var(--lab-hairline) solid color-mix(in srgb, var(--lab-warn) 50%, var(--lab-line));
  background: color-mix(in srgb, var(--lab-warn) 7%, var(--lab-surface));
  border-radius: var(--lab-r-card);
  padding: 13px;
  margin: 0 auto 14px;
  max-width: 860px;
  box-shadow: 0 2px 12px -4px color-mix(in srgb, var(--lab-warn) 30%, transparent);
}
.lab-interaction-kind { font-size: 12px; font-weight: 600; color: var(--lab-warn); margin: 0 0 5px; }
.lab-interaction-summary { margin: 0; font-size: 13px; line-height: 1.5; }
.lab-interaction-target { display: block; margin-top: 3px; font-family: var(--lab-mono); font-size: 11px; color: var(--lab-text-3); word-break: break-all; }
.lab-interaction-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.lab-interaction-error { margin: 8px 0 0; font-size: 12px; color: var(--lab-danger); }

.lab-question { border: var(--lab-hairline) solid var(--lab-line); border-radius: var(--lab-r-control); padding: 11px; margin: 10px 0 0; background: var(--lab-surface); }
.lab-question-legend { padding: 0 5px; font-size: 12px; font-weight: 600; }
.lab-question-prompt { margin: 3px 0 9px; font-size: 13px; color: var(--lab-text-2); }
.lab-choices { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; }
.lab-choice {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 7px 8px;
  border-radius: var(--lab-r-control);
  cursor: pointer;
  transition: background var(--lab-fast) var(--lab-ease);
}
.lab-choice:hover { background: var(--lab-hover); }
.lab-choice input { margin: 2px 0 0; accent-color: var(--lab-accent); }
.lab-choice-label { font-size: 13px; }
.lab-choice-desc { display: block; font-size: 12px; color: var(--lab-text-3); }

/* ------------------------------------------------------ directory browser */

/* A sheet rather than a sidebar panel. A 288px column cannot hold a breadcrumb,
   a scrollable listing and two actions without pushing the session list out of
   the viewport, and a modal file chooser is the platform-native shape for this
   anyway. Nested inside the window so it dims the panel it belongs to, not the
   whole Harness. */
.lab-sheet-scrim {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, var(--lab-bg) 45%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  animation: lab-scrim-in var(--lab-fast) var(--lab-ease);
}
.lab-sheet {
  width: min(520px, 100%);
  max-height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: var(--lab-surface);
  border: var(--lab-hairline) solid var(--lab-line);
  border-radius: var(--lab-r-window);
  overflow: hidden;
  box-shadow:
    0 0 0 .5px rgba(0, 0, 0, .05),
    0 16px 40px -12px rgba(0, 0, 0, .3);
  animation: lab-window-in var(--lab-slow) var(--lab-ease);
}
@media (prefers-reduced-motion: reduce) {
  .lab-sheet-scrim, .lab-sheet { animation: none }
}
.lab-sheet-head {
  padding: 13px 16px;
  border-bottom: var(--lab-hairline) solid var(--lab-line);
}
.lab-sheet-title { margin: 0; font-size: 14px; font-weight: 600; }
.lab-sheet-body { min-height: 0; padding: 14px 16px 16px; display: grid; grid-template-columns: minmax(0, 1fr); }

.lab-browse { display: grid; grid-template-columns: minmax(0, 1fr); gap: 9px; min-height: 0; }
.lab-crumbs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--lab-text-3);
}
.lab-crumb {
  appearance: none;
  font: inherit;
  font-size: 11px;
  color: var(--lab-text-2);
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 2px 5px;
  cursor: pointer;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: background var(--lab-fast) var(--lab-ease);
}
.lab-crumb:hover { background: var(--lab-hover); }
.lab-crumb:last-child { color: var(--lab-text); font-weight: 500; }
.lab-crumb-sep { opacity: .45; }

.lab-browse-list {
  /* Room for about a dozen rows, and a fixed height so the sheet does not
     resize between a deep directory and an empty one. */
  height: min(340px, 46vh);
  overflow-y: auto;
  overscroll-behavior: contain;
  border: var(--lab-hairline) solid var(--lab-line-strong);
  border-radius: var(--lab-r-control);
  background: var(--lab-bg);
  padding: 4px;
}
.lab-browse-row {
  appearance: none;
  font: inherit;
  font-size: 12px;
  text-align: left;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 8px;
  color: var(--lab-text);
  background: transparent;
  border: 0;
  border-radius: 7px;
  cursor: pointer;
  transition: background var(--lab-fast) var(--lab-ease);
}
.lab-browse-row:hover { background: var(--lab-hover); }
.lab-browse-row:disabled { opacity: .5; cursor: default; }
.lab-browse-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lab-browse-row--hidden .lab-browse-name { opacity: .6; }
.lab-browse-note { padding: 10px 8px; font-size: 12px; color: var(--lab-text-3); }
.lab-browse-toggle { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--lab-text-2); cursor: pointer; }
.lab-browse-toggle input { accent-color: var(--lab-accent); }
.lab-browse-path {
  font-family: var(--lab-mono);
  font-size: 11px;
  color: var(--lab-text-3);
  word-break: break-all;
}

/* -------------------------------------------------------------- composer */

.lab-composer {
  padding: 12px 16px 14px;
  border-top: var(--lab-hairline) solid var(--lab-line);
  background: var(--lab-surface);
}
.lab-composer-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: end; }
.lab-composer-hint { display: block; margin-top: 7px; font-size: 11px; color: var(--lab-text-3); }

/* ------------------------------------------------------ directory list */

.lab-dirs { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; margin-top: 8px; }
.lab-dir {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  border-radius: var(--lab-r-control);
  transition: background var(--lab-fast) var(--lab-ease);
}
.lab-dir:hover { background: var(--lab-hover); }
/* The ellipsis needs a constrained ancestor, not just min-width on itself.
   This wrapper was a bare <span> — an inline box sized by its content — so the
   grid track could not shrink it and a long directory name ran straight over the
   switch. A grid box with min-width: 0 is what actually caps the width; the same
   applies to any future two-column row here. */
.lab-dir-label {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}
.lab-dir-name {
  min-width: 0;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lab-dir-gone { color: var(--lab-danger); font-size: 11px; }
.lab-dir-actions { display: flex; align-items: center; gap: 4px; flex: none; }

/* A compact switch, so the row stays one line in a 288px column. */
.lab-switch {
  position: relative;
  flex: none;
  width: 30px;
  height: 18px;
  border-radius: var(--lab-r-chip);
  border: 0;
  padding: 0;
  cursor: pointer;
  background: var(--lab-fill-strong);
  transition: background var(--lab-fast) var(--lab-ease);
}
.lab-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--lab-surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, .2);
  transition: transform var(--lab-fast) var(--lab-ease);
}
.lab-switch[aria-checked='true'] { background: var(--lab-accent); }
.lab-switch[aria-checked='true']::after { transform: translateX(12px); }
.lab-switch:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px color-mix(in srgb, var(--lab-accent) 16%, transparent);
}
.lab-switch:disabled { opacity: .45; cursor: default; }

.lab-icon-btn {
  appearance: none;
  flex: none;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--lab-text-3);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background var(--lab-fast) var(--lab-ease), color var(--lab-fast) var(--lab-ease);
}
.lab-icon-btn:hover { background: var(--lab-hover); color: var(--lab-danger); }

/* --------------------------------------------------------- permission mode */

.lab-mode { position: relative; flex: none; }
.lab-mode-trigger {
  appearance: none;
  font: inherit;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 9px;
  color: var(--lab-text-2);
  background: var(--lab-fill);
  border: 0;
  border-radius: var(--lab-r-chip);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--lab-fast) var(--lab-ease);
}
.lab-mode-trigger:hover { background: var(--lab-fill-strong); }
.lab-mode-trigger:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px color-mix(in srgb, var(--lab-accent) 16%, transparent);
}
/* A mode that stops the browser being asked is worth seeing at a glance. */
.lab-mode-trigger--unguarded { color: var(--lab-warn); background: color-mix(in srgb, var(--lab-warn) 12%, transparent); }

.lab-mode-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  min-width: 260px;
  padding: 6px;
  background: var(--lab-surface);
  border: var(--lab-hairline) solid var(--lab-line-strong);
  border-radius: var(--lab-r-card);
  box-shadow: 0 8px 28px -10px rgba(0, 0, 0, .28);
  animation: lab-palette-in var(--lab-fast) var(--lab-ease);
}
.lab-mode-option {
  appearance: none;
  font: inherit;
  text-align: left;
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1px 10px;
  padding: 7px 9px;
  color: var(--lab-text);
  background: transparent;
  border: 0;
  border-radius: 7px;
  cursor: pointer;
  transition: background var(--lab-fast) var(--lab-ease);
}
.lab-mode-option:hover { background: var(--lab-hover); }
.lab-mode-name { font-size: 13px; }
.lab-mode-hint { grid-column: 1; font-size: 11px; color: var(--lab-text-3); }
.lab-mode-check { color: var(--lab-accent); font-size: 12px; }
.lab-mode-warning {
  margin: 4px 4px 2px;
  padding: 7px 8px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--lab-warn);
  background: color-mix(in srgb, var(--lab-warn) 10%, transparent);
  border-radius: 7px;
}
.lab-mode-footnote { margin: 2px 9px 4px; font-size: 11px; color: var(--lab-text-3); }

/* ---------------------------------------------------------- session picker */

.lab-resume { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; min-height: 0; }
.lab-resume-list {
  height: min(320px, 44vh);
  overflow-y: auto;
  overscroll-behavior: contain;
  border: var(--lab-hairline) solid var(--lab-line-strong);
  border-radius: var(--lab-r-control);
  background: var(--lab-bg);
  padding: 4px;
}
.lab-resume-row {
  appearance: none;
  font: inherit;
  text-align: left;
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
  padding: 8px 9px;
  color: var(--lab-text);
  background: transparent;
  border: var(--lab-hairline) solid transparent;
  border-radius: 7px;
  cursor: pointer;
  transition: background var(--lab-fast) var(--lab-ease);
}
.lab-resume-row:hover { background: var(--lab-hover); }
.lab-resume-row[aria-selected='true'] {
  background: var(--lab-fill);
  border-color: var(--lab-line-strong);
}
.lab-resume-title {
  font-size: 12px;
  font-weight: 500;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lab-resume-meta { font-size: 11px; color: var(--lab-text-3); display: flex; gap: 8px; }

/* -------------------------------------------------------- command palette */

/* Anchored above the composer rather than as a modal: the operator is mid-typing
   and the filter text stays in the composer, so the list has to appear without
   taking focus away from it. */
.lab-composer { position: relative; }
.lab-palette {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: calc(100% - 6px);
  z-index: 5;
  max-height: min(320px, 44vh);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  background: var(--lab-surface);
  border: var(--lab-hairline) solid var(--lab-line-strong);
  border-radius: var(--lab-r-card);
  box-shadow: 0 -4px 12px -6px rgba(0, 0, 0, .18), 0 -16px 40px -20px rgba(0, 0, 0, .3);
  animation: lab-palette-in var(--lab-fast) var(--lab-ease);
}
@keyframes lab-palette-in {
  from { opacity: 0; transform: translateY(6px) }
  to { opacity: 1; transform: none }
}
@media (prefers-reduced-motion: reduce) { .lab-palette { animation: none } }

.lab-palette-group {
  padding: 5px 8px 3px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .05em;
  text-transform: uppercase;
  color: var(--lab-caption);
}
.lab-palette-item {
  appearance: none;
  font: inherit;
  text-align: left;
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 10px;
  padding: 7px 8px;
  color: var(--lab-text);
  background: transparent;
  border: 0;
  border-radius: 7px;
  cursor: pointer;
  transition: background var(--lab-fast) var(--lab-ease);
}
.lab-palette-item:hover { background: var(--lab-hover); }
/* Keyboard selection has to look identical to hover, because the operator is
   arrowing through the list with their hands on the keys. */
.lab-palette-item[aria-selected='true'] { background: var(--lab-hover); }
.lab-palette-item:disabled { cursor: default; }
.lab-palette-item:disabled:hover { background: transparent; }
.lab-palette-name {
  min-width: 0;
  font-family: var(--lab-mono);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lab-palette-arg { font-family: var(--lab-mono); font-size: 11px; color: var(--lab-text-3); }
.lab-palette-desc {
  grid-column: 1 / -1;
  font-size: 11px;
  line-height: 1.4;
  color: var(--lab-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lab-palette-note { padding: 10px 8px; font-size: 12px; line-height: 1.5; color: var(--lab-text-3); }

/* ---------------------------------------------------------------- notices */

.lab-error-banner {
  max-width: 860px;
  margin: 0 auto 12px;
  padding: 10px 13px;
  border-radius: var(--lab-r-card);
  border: var(--lab-hairline) solid color-mix(in srgb, var(--lab-danger) 35%, var(--lab-line));
  background: color-mix(in srgb, var(--lab-danger) 7%, var(--lab-surface));
  color: var(--lab-danger);
  font-size: 12px;
}
.lab-diagnostic { display: grid; grid-template-columns: minmax(0, 1fr); gap: 3px; }
.lab-diagnostic + .lab-diagnostic { margin-top: 9px; padding-top: 9px; border-top: var(--lab-hairline) solid var(--lab-line); }
.lab-diagnostic-head { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 500; }
.lab-diagnostic-body { font-size: 12px; line-height: 1.5; color: var(--lab-text-2); }
.lab-diagnostic-hint { font-size: 11px; line-height: 1.5; color: var(--lab-text-3); }

/* ------------------------------------------------------------- responsive */

@media (max-width: 860px) {
  .lab-scrim { padding: 0; backdrop-filter: none; -webkit-backdrop-filter: none; }
  .lab-window { width: 100%; height: 100%; border: 0; border-radius: 0; }
  .lab-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(200px, 40%) minmax(0, 1fr); }
  .lab-aside { border-right: 0; border-bottom: var(--lab-hairline) solid var(--lab-line); padding: 12px; }
  .lab-titlebar { padding: 12px 12px 12px 16px; }
  .lab-timeline { padding: 14px 12px; }
  .lab-composer { padding: 10px 12px 12px; }
}

@media (max-width: 480px) {
  .lab-toolbar { flex-wrap: wrap; align-items: flex-start; }
  .lab-composer-row { grid-template-columns: minmax(0, 1fr); }
  .lab-composer-row > .lab-btn { width: 100%; }
  .lab-row-card--user { max-width: 100%; }
}
`
