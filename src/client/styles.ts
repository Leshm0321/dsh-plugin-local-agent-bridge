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
  /* Platform UI faces first, in platform order, then the CJK faces each platform
     ships. Two things were wrong for Windows readers:

     Helvetica Neue sat ahead of Segoe UI. Plenty of Windows machines have it —
     Adobe installers put it there — so Latin text was rendered in a face designed
     for print and for macOS grayscale antialiasing, while the Chinese in the same
     sentence fell through to YaHei. Mismatched pairing, and Helvetica renders
     poorly under ClearType. It is gone: -apple-system already covers every Apple
     platform, which is the only place it was reaching for.

     And the newer faces were missing. Windows 11 ships Segoe UI Variable, and
     Microsoft YaHei UI is the interface cut of YaHei — lighter and better spaced
     at UI sizes than the document cut this asked for. */
  --lab-font:
    -apple-system, BlinkMacSystemFont,
    'Segoe UI Variable Text', 'Segoe UI',
    system-ui, Roboto, 'Noto Sans',
    'PingFang SC', 'Hiragino Sans GB',
    'Microsoft YaHei UI', 'Microsoft YaHei',
    'Noto Sans CJK SC', 'Source Han Sans SC',
    sans-serif;
  /* Cascadia Mono and Consolas are what Windows actually has; without them the
     mono stack fell straight through to the generic monospace keyword, which on
     Windows means Courier New. */
  --lab-mono:
    ui-monospace, SFMono-Regular, 'SF Mono', Menlo,
    'Cascadia Mono', Consolas,
    'JetBrains Mono', 'Fira Code',
    monospace;

  /* HIG-ish radii: containers rounder than controls, controls rounder than chips. */
  --lab-r-window: 14px;
  --lab-r-card: 12px;
  --lab-r-control: 9px;
  --lab-r-chip: 999px;

  /* One easing curve for everything, Apple's standard decelerate. */
  --lab-ease: cubic-bezier(.32, .72, 0, 1);
  --lab-fast: .16s;
  --lab-slow: .28s;

  /* The side panel's width when open. Declared here rather than inline in the track
     list because the animation reads it back off the element: a grid whose track
     count changes cannot be transitioned, so the open and shut widths are tweened
     through --lab-side-width, and this is the value it tweens to. */
  --lab-side-open: 420px;

  font-family: var(--lab-font);
  color: var(--lab-text);
  /* macOS only, and deliberately kept: it is what makes text there match the rest
     of the system. Windows ignores it and uses ClearType, which is also correct for
     that platform — the fix for Windows was the font stack above, not this. */
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  /* Alternate glyph sets in Inter and SF. Ignored by faces that do not have them,
     which is every Windows face, so this costs nothing there. */
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
/* The badge rides the trigger, which is the only part of this plugin a shut panel
   still shows. Positioned rather than laid out, so the collapsed sidebar's
   icon-only trigger keeps its size. */
.lab-trigger { position: relative; }
.lab-trigger-badge {
  position: absolute;
  top: 2px;
  left: 20px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--lab-warn);
  color: var(--lab-surface);
  font-size: 10px;
  font-weight: 600;
  line-height: 15px;
  text-align: center;
  pointer-events: none;
}
.lab-bell-off { opacity: 0.45; }
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

/* Toggle and title travel together on the left, so the control sits on the side
   it acts on. */
.lab-titlebar-lead { display: flex; align-items: center; gap: 10px; min-width: 0; }

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
/* The icon rail: what the sidebar becomes at 52px. Hidden while the sidebar is
   open, because everything in it is already there in full. */
.lab-rail { display: none; }
.lab-body--collapsed .lab-rail { display: grid; gap: 6px; justify-items: center; }
.lab-rail-session {
  appearance: none;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  color: var(--lab-text-2);
  background: var(--lab-fill);
  border: 0;
  border-radius: var(--lab-r-control);
  cursor: pointer;
  transition: background var(--lab-fast) var(--lab-ease), color var(--lab-fast) var(--lab-ease);
}
.lab-rail-session:hover { background: var(--lab-fill-strong); }
.lab-rail-session:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px color-mix(in srgb, var(--lab-accent) 16%, transparent);
}
.lab-rail-session--on { color: var(--lab-on-accent); background: var(--lab-accent); }
/* A running turn, visible without expanding. */
.lab-rail-busy {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--lab-warn);
}
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
/* The two start routes share the row and the width: neither is the other's
   footnote. They wrap rather than squeeze when the column is narrow. */
.lab-start-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.lab-start-actions > * { flex: 1 1 auto; justify-content: center; }
.lab-start-note { margin: 2px 0 0; }
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

/* One directory, its sessions under it. The head carries the name the rows used to
   repeat, and folds the group away when the reader is done with it. */
.lab-session-group { display: grid; gap: 2px; }
.lab-group-head {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--lab-text-3);
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 6px;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}
.lab-group-head:hover { color: var(--lab-text-2); }
.lab-group-caret { flex: none; transition: transform 140ms ease; }
.lab-group-caret--open { transform: rotate(90deg); }
.lab-group-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lab-group-count { flex: none; font-variant-numeric: tabular-nums; }

/* The row is the button plus its menu trigger; the trigger only appears on hover or
   focus, so an idle list stays as quiet as it was before it grew actions. */
.lab-session-row { position: relative; display: flex; align-items: stretch; }
.lab-session-row > .lab-session { flex: 1 1 auto; min-width: 0; }
.lab-session-more {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--lab-text-3);
  flex: none;
  width: 24px;
  border-radius: var(--lab-r-sm, 6px);
  cursor: pointer;
  opacity: 0;
  display: grid;
  place-items: center;
}
.lab-session-row:hover .lab-session-more,
.lab-session-row--on .lab-session-more,
.lab-session-more:focus-visible { opacity: 1; }
.lab-session-more:hover { color: var(--lab-text); background: var(--lab-hover, transparent); }
.lab-session-pin { flex: none; font-size: 8px; color: var(--lab-accent, var(--lab-text-3)); }
.lab-session-rename { margin: 2px 0; }
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
  /* A span inside a non-flex parent stays inline, and an inline box ignores both
     width and height — which left this bar permanently empty however full the
     context was. The percentage arrives as an inline width, so the box has to be
     a block for it to mean anything. */
  display: block;
  height: 100%;
  border-radius: var(--lab-r-chip);
  background: var(--lab-text-3);
  transition: width var(--lab-slow) var(--lab-ease), background var(--lab-slow) var(--lab-ease);
}
/* Only shifts colour once it is worth acting on. */
.lab-usage-fill--warn { background: var(--lab-warn); }
.lab-usage-fill--full { background: var(--lab-danger); }

/* ------------------------------------------------------------ view tabs */

.lab-views {
  display: flex;
  gap: 4px;
  padding: 8px 16px 0;
  border-bottom: var(--lab-hairline) solid var(--lab-line);
}
.lab-view-tab {
  appearance: none;
  font: inherit;
  font-size: 12px;
  padding: 6px 12px;
  color: var(--lab-text-3);
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color var(--lab-fast) var(--lab-ease), border-color var(--lab-fast) var(--lab-ease);
}
.lab-view-tab:hover { color: var(--lab-text-2); }
.lab-view-tab--on { color: var(--lab-text); border-bottom-color: var(--lab-accent); }

/* ----------------------------------------------------------------- trace */

.lab-trace { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.lab-trace-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.lab-trace-summary { display: flex; gap: 12px; flex-wrap: wrap; }
.lab-trace-figure { font-size: 11px; font-family: var(--lab-mono); color: var(--lab-text-3); white-space: nowrap; }
.lab-trace-search { max-width: 260px; }
.lab-session-filter { margin-bottom: 6px; }

/* The strip: one row per lane, each a full-width track with spans positioned as
   percentages of the trace's own duration. */
.lab-trace-strip {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 3px;
  padding: 8px 0;
}
.lab-trace-lane { display: grid; grid-template-columns: 44px minmax(0, 1fr); align-items: center; gap: 8px; }
.lab-trace-lane-label { font-size: 10px; color: var(--lab-text-3); text-align: right; }
.lab-trace-track {
  position: relative;
  height: 10px;
  border-radius: 3px;
  background: var(--lab-fill);
}
.lab-trace-span {
  /* Absolute inside the track, and a block so the inline width means something. */
  display: block;
  position: absolute;
  top: 2px;
  height: 6px;
  border-radius: 2px;
}
/* Three inks so a glance separates waiting from thinking from doing. Input is an
   instant, so it reads as a tick rather than a bar. */
.lab-trace-span--input { background: var(--lab-text-3); min-width: 3px; }
.lab-trace-span--model { background: var(--lab-accent); }
.lab-trace-span--tools { background: var(--lab-warn); }
.lab-trace-span--failed { background: var(--lab-danger); }

.lab-trace-steps {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1px;
}
.lab-trace-step {
  display: grid;
  grid-template-columns: 72px minmax(0, 3fr) minmax(0, 4fr) auto;
  align-items: baseline;
  gap: 10px;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 12px;
  transition: background var(--lab-fast) var(--lab-ease);
}
.lab-trace-step:hover { background: var(--lab-hover); }
.lab-trace-step--failed { background: color-mix(in srgb, var(--lab-danger) 7%, transparent); }
.lab-trace-tag {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: .06em;
  text-align: center;
  padding: 3px 4px;
  border-radius: 4px;
  color: var(--lab-text-2);
  background: var(--lab-fill-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Each kind gets its own tint, matching the lane colours where they correspond. */
.lab-trace-tag--tool { color: var(--lab-warn); background: color-mix(in srgb, var(--lab-warn) 14%, transparent); }
.lab-trace-tag--assistant { color: var(--lab-text); background: color-mix(in srgb, var(--lab-accent) 12%, transparent); }
.lab-trace-tag--reasoning { color: var(--lab-text-3); background: var(--lab-fill); }
.lab-trace-tag--user { color: var(--lab-text-2); background: var(--lab-fill-strong); }
.lab-trace-tag--context { color: var(--lab-success); background: color-mix(in srgb, var(--lab-success) 14%, transparent); }
.lab-trace-tag--error { color: var(--lab-danger); background: color-mix(in srgb, var(--lab-danger) 12%, transparent); }

/* One line each, truncated: a trace is scanned down the left edge, and a wrapped
   cell would break that column. The full text is in the title. */
.lab-trace-call,
.lab-trace-result {
  font-family: var(--lab-mono);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lab-trace-call { color: var(--lab-text); }
.lab-trace-result { color: var(--lab-text-3); }
.lab-trace-name { font-weight: 600; margin-right: 6px; }
.lab-trace-arrow { margin-right: 6px; opacity: .6; }
.lab-trace-elapsed { font-family: var(--lab-mono); font-size: 10px; color: var(--lab-text-3); white-space: nowrap; }

.lab-trace-totals {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding-top: 8px;
  border-top: var(--lab-hairline) solid var(--lab-line);
  font-size: 11px;
  font-family: var(--lab-mono);
  color: var(--lab-text-3);
}

/* ------------------------------------------------------------------- code */

/* Gutter and body as two columns of one grid, sharing a line height. The numbers are
   a separate column because a highlighted region can span lines — a block comment, a
   template literal — and splitting the highlight tree to interleave numbers would
   break exactly those. */
.lab-code {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  font-family: var(--lab-mono);
  font-size: 12px;
  line-height: 1.55;
}
.lab-code-gutter {
  display: grid;
  text-align: right;
  color: var(--lab-text-3);
  user-select: none;
}
.lab-code-line { display: block; }
.lab-code-body { margin: 0; overflow-x: auto; white-space: pre; }

/* Syntax palette.
 *
 * Literal colours, which nothing else in this stylesheet uses. The platform's alias
 * set is label / state / button — it has no syntax scale, and there is no honest way
 * to derive eight distinguishable hues from four semantic ones. Two sets, so both
 * themes are legible rather than one being an inversion of the other.
 *
 * Chosen from the GitHub light and dark palettes, which are contrast-checked and
 * familiar enough that code looks like code here. */
.lab-code {
  --lab-syn-keyword: #cf222e;
  --lab-syn-string: #0a3069;
  --lab-syn-comment: #6e7781;
  --lab-syn-number: #0550ae;
  --lab-syn-name: #8250df;
  --lab-syn-type: #953800;
  --lab-syn-attr: #116329;
  --lab-syn-meta: #24292f;
}
/* The Harness marks dark mode with an attribute on body rather than relying on the
   media query, which is what the token bridge at the top of this sheet reads. The
   syntax palette has no token to read, so it follows the same attribute directly. */
body[data-ds-dark-theme] .lab-code {
  --lab-syn-keyword: #ff7b72;
  --lab-syn-string: #a5d6ff;
  --lab-syn-comment: #8b949e;
  --lab-syn-number: #79c0ff;
  --lab-syn-name: #d2a8ff;
  --lab-syn-type: #ffa657;
  --lab-syn-attr: #7ee787;
  --lab-syn-meta: #c9d1d9;
}

/* highlight.js class names, scoped under the viewer.
 *
 * The prefix is not cosmetic: this stylesheet is injected into the Harness document,
 * so an unscoped hljs-keyword rule would recolour every highlighted block anywhere
 * in the application. Grouped by meaning rather than one rule per class. */
.lab-code .hljs-keyword,
.lab-code .hljs-literal,
.lab-code .hljs-selector-tag,
.lab-code .hljs-doctag,
.lab-code .hljs-operator { color: var(--lab-syn-keyword); }
.lab-code .hljs-string,
.lab-code .hljs-regexp,
.lab-code .hljs-addition,
.lab-code .hljs-selector-attr,
.lab-code .hljs-selector-pseudo { color: var(--lab-syn-string); }
.lab-code .hljs-comment,
.lab-code .hljs-quote,
.lab-code .hljs-deletion { color: var(--lab-syn-comment); }
.lab-code .hljs-number,
.lab-code .hljs-symbol,
.lab-code .hljs-bullet { color: var(--lab-syn-number); }
.lab-code .hljs-title,
.lab-code .hljs-name,
.lab-code .hljs-section,
.lab-code .hljs-selector-id,
.lab-code .hljs-selector-class { color: var(--lab-syn-name); }
.lab-code .hljs-type,
.lab-code .hljs-built_in,
.lab-code .hljs-class,
.lab-code .hljs-params { color: var(--lab-syn-type); }
.lab-code .hljs-attr,
.lab-code .hljs-attribute,
.lab-code .hljs-property,
.lab-code .hljs-variable,
.lab-code .hljs-template-variable { color: var(--lab-syn-attr); }
.lab-code .hljs-meta,
.lab-code .hljs-tag,
.lab-code .hljs-punctuation { color: var(--lab-syn-meta); }
.lab-code .hljs-emphasis { font-style: italic; }
.lab-code .hljs-strong { font-weight: 600; }

/* ------------------------------------------------------------------- lock */

/* The locked window is sized to what is on it. At the panel's full width and
   height, one password field reads as a page that failed to load rather than as a
   door — so the window shrinks to the shape of its content. */
.lab-window--locked {
  height: auto;
  max-height: none;
  width: min(100%, 420px);
}

.lab-lock {
  display: flex;
  justify-content: center;
  padding: 40px 24px 48px;
}

.lab-lock-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  width: 100%;
  max-width: 340px;
}

.lab-lock-title { margin: 0; font-size: 15px; font-weight: 600; }

.lab-lock-note { margin: 0; font-size: 13px; color: var(--lab-text-2); }

.lab-lock-input {
  width: 100%;
  padding: 9px 11px;
  font: inherit;
  font-size: 13px;
  color: var(--lab-text);
  background: var(--lab-surface-2);
  border: var(--lab-hairline) solid var(--lab-line);
  border-radius: var(--lab-r-control);
  transition: border-color var(--lab-fast) var(--lab-ease), box-shadow var(--lab-fast) var(--lab-ease);
}

.lab-lock-input:focus-visible {
  outline: none;
  border-color: var(--lab-accent);
  box-shadow: 0 0 0 3px var(--lab-accent-soft);
}

.lab-lock-error { margin: 0; font-size: 12px; color: var(--lab-danger); }

/* While the Host has not yet said whether a password is set. */
.lab-lock-pending { margin: 0; padding: 32px 24px; font-size: 13px; color: var(--lab-text-3); text-align: center; }

.lab-lock-submit {
  padding: 9px 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--lab-on-accent);
  background: var(--lab-accent);
  border: none;
  border-radius: var(--lab-r-control);
  cursor: pointer;
  transition: background var(--lab-fast) var(--lab-ease), transform var(--lab-fast) var(--lab-ease);
}

.lab-lock-submit:active:not(:disabled) { transform: scale(.975); }
.lab-lock-submit:disabled { opacity: .5; cursor: default; }

/* The limit of what this lock covers, stated where the belief is formed. */
.lab-lock-scope {
  margin: 4px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--lab-text-3);
}

/* ------------------------------------------------- privacy settings page */

.lab-settings { padding: 4px 0 16px; }

.lab-privacy { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; max-width: 460px; }

.lab-privacy-title { margin: 0; font-size: 14px; font-weight: 600; }

.lab-privacy-note { margin: 0; font-size: 13px; line-height: 1.55; color: var(--lab-text-2); }

/* Not styled as an error, because it is not one — it is the shape of the thing. */
.lab-privacy-limit {
  margin: 0;
  padding: 9px 11px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--lab-text-2);
  background: var(--lab-surface-2);
  border-left: 2px solid var(--lab-line-strong);
  border-radius: var(--lab-r-control);
}

.lab-privacy-form { display: grid; grid-template-columns: minmax(0, 1fr); gap: 9px; margin: 2px 0 0; }

.lab-privacy-field { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; }

.lab-privacy-field > span { font-size: 12px; color: var(--lab-text-2); }

.lab-privacy-field > input {
  width: 100%;
  padding: 8px 10px;
  font: inherit;
  font-size: 13px;
  color: var(--lab-text);
  background: var(--lab-surface-2);
  border: var(--lab-hairline) solid var(--lab-line);
  border-radius: var(--lab-r-control);
  transition: border-color var(--lab-fast) var(--lab-ease), box-shadow var(--lab-fast) var(--lab-ease);
}

.lab-privacy-field > input:focus-visible {
  outline: none;
  border-color: var(--lab-accent);
  box-shadow: 0 0 0 3px var(--lab-accent-soft);
}

.lab-privacy-error { margin: 0; font-size: 12px; color: var(--lab-danger); }
.lab-privacy-done { margin: 0; font-size: 12px; color: var(--lab-text-2); }

.lab-privacy-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 2px 0 0; }

.lab-privacy-actions > button {
  padding: 8px 13px;
  font: inherit;
  font-size: 13px;
  color: var(--lab-text);
  background: var(--lab-surface-2);
  border: var(--lab-hairline) solid var(--lab-line);
  border-radius: var(--lab-r-control);
  cursor: pointer;
  transition: background var(--lab-fast) var(--lab-ease), color var(--lab-fast) var(--lab-ease);
}

.lab-privacy-actions > button:hover:not(:disabled) { background: var(--lab-hover); }
.lab-privacy-actions > button:disabled { opacity: .5; cursor: default; }
.lab-privacy-actions > button:first-child {
  color: var(--lab-on-accent);
  background: var(--lab-accent);
  border-color: transparent;
}

.lab-privacy-timeouts { margin: 0; font-size: 12px; color: var(--lab-text-3); }

/* -------------------------------------------------------------- side panel */

.lab-mirror { display: flex; transform: scaleX(-1); }

/* The body grows a third column only when the panel is open, so a closed panel
   costs the conversation nothing. */
.lab-body--side { grid-template-columns: var(--lab-aside-width, 288px) minmax(0, 1fr) var(--lab-side-width, var(--lab-side-open)); }
.lab-body--side.lab-body--collapsed { grid-template-columns: 52px minmax(0, 1fr) var(--lab-side-width, var(--lab-side-open)); }

.lab-side {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-left: var(--lab-hairline) solid var(--lab-line);
  background: var(--lab-surface);
}

/* Viewer above, tree below: the viewer is what gets read, so it takes the room, and
   the tree stays a fixed, scrollable strip. Two columns would leave both too narrow
   at this width. */
.lab-files {
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(0, 40%);
}
.lab-files-viewer { min-height: 0; display: flex; flex-direction: column; }
.lab-files-crumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-bottom: var(--lab-hairline) solid var(--lab-line);
  font-size: 11px;
  font-family: var(--lab-mono);
  color: var(--lab-text-3);
}
.lab-files-crumb { color: var(--lab-text-3); }
.lab-files-crumb--last { color: var(--lab-text); }
.lab-files-meta { margin-left: auto; }
.lab-files-content { min-height: 0; overflow: auto; padding: 10px 12px; }
.lab-files-empty {
  display: grid;
  justify-items: center;
  gap: 4px;
  padding: 32px 12px;
  color: var(--lab-text-3);
}
.lab-files-empty-title { margin: 0; font-size: 13px; color: var(--lab-text-2); }

.lab-files-tree {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 6px;
  padding: 8px 10px 10px;
  border-top: var(--lab-hairline) solid var(--lab-line);
}
.lab-files-filter { font-size: 12px; }
.lab-files-rows { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.lab-files-row {
  appearance: none;
  font: inherit;
  text-align: left;
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--lab-text);
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  transition: background var(--lab-fast) var(--lab-ease);
}
.lab-files-row:hover { background: var(--lab-hover); }
.lab-files-row--on { background: var(--lab-fill-strong); }
.lab-files-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.lab-files-toolbar { display: flex; align-items: center; gap: 4px; }
.lab-files-naming { display: flex; align-items: center; gap: 4px; }

/* Row and its actions share a line; the actions appear on hover so the tree reads
   as a tree until it is being worked on. */
.lab-files-line { position: relative; display: flex; align-items: center; }
.lab-files-line > .lab-files-row { flex: 1 1 auto; min-width: 0; }
.lab-files-row-actions {
  display: flex;
  gap: 2px;
  flex: none;
  opacity: 0;
  transition: opacity var(--lab-fast) var(--lab-ease);
}
.lab-files-line:hover .lab-files-row-actions,
.lab-files-line:focus-within .lab-files-row-actions { opacity: 1; }

.lab-files-action {
  appearance: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: none;
  padding: 0;
  color: var(--lab-text-3);
  background: transparent;
  border: 0;
  border-radius: 5px;
  cursor: pointer;
  transition: background var(--lab-fast) var(--lab-ease), color var(--lab-fast) var(--lab-ease);
}
.lab-files-action:hover { color: var(--lab-text); background: var(--lab-fill-strong); }
.lab-files-action:disabled { opacity: .4; cursor: default; }
.lab-files-action:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--lab-accent) 18%, transparent);
}

/* The editor fills the viewer and scrolls itself, so saving is never a scroll away. */
.lab-files-editor {
  width: 100%;
  min-height: 320px;
  height: 100%;
  resize: none;
  padding: 8px 10px;
  font-family: var(--lab-mono);
  font-size: 12px;
  line-height: 1.55;
  color: var(--lab-text);
  background: var(--lab-bg);
  border: var(--lab-hairline) solid var(--lab-line-strong);
  border-radius: var(--lab-r-control);
}
.lab-files-editor:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--lab-accent) 18%, transparent);
}

/* A refusal worth reading, not a code. */
.lab-files-warning {
  margin: 0 0 8px;
  padding: 8px 10px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--lab-warn);
  background: color-mix(in srgb, var(--lab-warn) 10%, transparent);
  border-radius: 7px;
}
.lab-files-size { font-size: 10px; font-family: var(--lab-mono); color: var(--lab-text-3); }

/* -------------------------------------------------------------------- diff */

.lab-diff-layout {
  appearance: none;
  font: inherit;
  font-size: 10px;
  padding: 2px 7px;
  color: var(--lab-text-3);
  background: var(--lab-fill);
  border: 0;
  border-radius: var(--lab-r-chip);
  cursor: pointer;
}
.lab-diff-layout--on { color: var(--lab-on-accent); background: var(--lab-accent); }
.lab-diff-counts { font-size: 10px; font-family: var(--lab-mono); color: var(--lab-text-3); white-space: nowrap; }

.lab-diff { font-family: var(--lab-mono); font-size: 11px; line-height: 1.5; }
/* Each half of a split row is about half the width, so the type comes down a step to
   keep a normal line of code readable without scrolling it. */
.lab-diff--split { font-size: 10px; }
.lab-diff-hunk { margin-bottom: 10px; }
.lab-diff-header {
  padding: 3px 8px;
  color: var(--lab-text-3);
  background: var(--lab-fill);
  border-radius: 4px;
  white-space: pre;
  overflow-x: auto;
}

/* Unified: two gutters, a sign, then the line. Rows scroll as one block so the
   gutters stay put while a long line moves. */
.lab-diff-line { display: grid; grid-template-columns: 34px 34px 12px minmax(0, 1fr); }
.lab-diff-num { color: var(--lab-text-3); text-align: right; padding-right: 6px; user-select: none; }
.lab-diff-sign { text-align: center; user-select: none; }
.lab-diff-text { white-space: pre; overflow-x: auto; }

/* Added and removed carry a tint rather than only a sign, because a sign in the
   gutter is easy to lose in a long hunk. */
.lab-diff-line--added,
.lab-diff-side.lab-diff-line--added { background: color-mix(in srgb, var(--lab-success) 14%, transparent); }
.lab-diff-line--removed,
.lab-diff-side.lab-diff-line--removed { background: color-mix(in srgb, var(--lab-danger) 12%, transparent); }
.lab-diff-line--context { background: transparent; }

/* Side by side: one row, two independently coloured halves. */
.lab-diff-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1px; }
.lab-diff-side { display: grid; grid-template-columns: 34px minmax(0, 1fr); min-width: 0; }
/* A row where one side ran out: three lines replaced by one is not three edits, and
   the empty cell is what says so. */
.lab-diff-side--empty { background: var(--lab-fill); }

/* ----------------------------------------------------------- attachments */

.lab-attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.lab-attachment { position: relative; display: block; line-height: 0; }
.lab-attachment-thumb {
  display: block;
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: var(--lab-r-control);
  border: var(--lab-hairline) solid var(--lab-line-strong);
}
/* Sits on the corner of its own thumbnail, which is why the wrapper is positioned. */
.lab-attachment-remove {
  appearance: none;
  position: absolute;
  top: -5px;
  right: -5px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  color: var(--lab-on-accent);
  background: var(--lab-accent);
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}

/* ------------------------------------------------------------- turn group */

.lab-turn { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }

/* A quiet chip, not a card: it describes the work rather than being part of the
   conversation, so it should not compete with the answer below it. */
.lab-turn-toggle {
  appearance: none;
  font: inherit;
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 10px;
  font-size: 11px;
  color: var(--lab-text-2);
  background: var(--lab-fill);
  border: 0;
  border-radius: var(--lab-r-chip);
  cursor: pointer;
  transition: background var(--lab-fast) var(--lab-ease);
}
.lab-turn-toggle:hover { background: var(--lab-fill-strong); }
.lab-turn-toggle:disabled { cursor: default; }
.lab-turn-toggle:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px color-mix(in srgb, var(--lab-accent) 16%, transparent);
}
.lab-turn-caret {
  display: inline-block;
  transition: transform var(--lab-fast) var(--lab-ease);
  color: var(--lab-text-3);
}
.lab-turn-caret--open { transform: rotate(90deg); }
.lab-turn-label { font-family: var(--lab-mono); }
.lab-turn-count { color: var(--lab-text-3); }
.lab-turn-waited { font-size: 11px; color: var(--lab-text-3); flex: none; }

/* Indented and ruled, so the work reads as belonging to the summary above it rather
   than as more conversation. */
.lab-turn-work {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  padding-left: 12px;
  border-left: 2px solid var(--lab-line);
}

/* --------------------------------------------------------------- markdown */

/* Blocks inside a transcript card, so the vertical rhythm is the card's rather than
   a document's: first and last lose their outer margin. */
.lab-md-p { margin: 0 0 8px; line-height: 1.6; }
.lab-md-p:last-child { margin-bottom: 0; }

/* Headings are weights, not an outline: a message is a card in a transcript, and
   promoting its sections to real headings would claim page structure it does not
   have. */
.lab-md-heading { margin: 12px 0 6px; font-weight: 600; line-height: 1.4; }
.lab-md-heading:first-child { margin-top: 0; }
.lab-md-heading--1 { font-size: 15px; }
.lab-md-heading--2 { font-size: 14px; }
.lab-md-heading--3 { font-size: 13px; }
.lab-md-heading--4,
.lab-md-heading--5,
.lab-md-heading--6 { font-size: 13px; color: var(--lab-text-2); }

.lab-md-list { margin: 0 0 8px; padding-left: 20px; line-height: 1.6; }
.lab-md-list:last-child { margin-bottom: 0; }
.lab-md-list li { margin: 2px 0; }

.lab-md-code {
  font-family: var(--lab-mono);
  font-size: .92em;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--lab-fill-strong);
}

.lab-md-pre {
  margin: 0 0 8px;
  padding: 10px 12px;
  border-radius: var(--lab-r-control);
  background: var(--lab-fill-strong);
  font-family: var(--lab-mono);
  font-size: 12px;
  line-height: 1.5;
  /* Scrolls itself rather than widening the card: a long command line must not
     make the whole transcript scroll sideways. */
  overflow-x: auto;
  white-space: pre;
}
.lab-md-pre:last-child { margin-bottom: 0; }

/* Same rule for tables, which are the other thing that can be wider than the card. */
.lab-md-table-wrap { margin: 0 0 8px; overflow-x: auto; }
.lab-md-table-wrap:last-child { margin-bottom: 0; }
.lab-md-table { border-collapse: collapse; font-size: 12px; }
.lab-md-table th,
.lab-md-table td {
  padding: 5px 10px;
  text-align: left;
  vertical-align: top;
  border: var(--lab-hairline) solid var(--lab-line);
}
.lab-md-table th { font-weight: 600; background: var(--lab-fill); white-space: nowrap; }

/* A link's target is shown but not clickable — see the note in markdown.tsx. */
.lab-md-url { color: var(--lab-text-3); word-break: break-all; }

/* --------------------------------------------------------------- timeline */

/* The main grid's middle row: tabs on top, then whichever view is showing. Nested
   rather than flattened into the parent, so the parent stays three rows and cannot
   be thrown out by adding a view. */
.lab-content {
  min-width: 0;
  min-height: 0;
  /* Flex, not grid rows: the tab strip is absent until a session is selected, and a
     row template has to know how many children there are. A column makes the view
     take whatever is left however many siblings it has. */
  display: flex;
  flex-direction: column;
}
.lab-content > .lab-views { flex: none; }
/* min-height: 0 is what lets the scroll container actually scroll inside a flex
   column rather than growing past it. */
.lab-content > .lab-timeline { flex: 1 1 auto; min-height: 0; }
/* The interaction dock is the content column's own last row: flex: none so the
   transcript gives up the space rather than the card being squeezed, and its own
   scroll so a question with many inputs cannot push the composer off the panel. */
.lab-content > .lab-interaction-dock {
  flex: none;
  max-height: 42%;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-top: var(--lab-hairline) solid var(--lab-line);
  padding: 12px clamp(14px, 3vw, 32px) 0;
}

.lab-timeline {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 18px clamp(14px, 3vw, 32px);
  scroll-behavior: smooth;
}
.lab-stream { max-width: 860px; margin: 0 auto; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }

/* The opening card. Quiet on purpose: it is scaffolding for the first prompt, not
   a thing to read twice, and it is gone the moment a turn exists. */
.lab-opening {
  border: var(--lab-hairline) solid var(--lab-line);
  border-radius: var(--lab-r-card);
  padding: 16px 18px;
  color: var(--lab-text-2);
}
.lab-opening-lead { margin: 0 0 12px; font-size: 13px; }
.lab-opening-facts {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 14px;
  margin: 0 0 14px;
  font-size: 12px;
}
.lab-opening-facts dt { color: var(--lab-text-3); }
.lab-opening-facts dd { margin: 0; color: var(--lab-text); overflow-wrap: anywhere; }
.lab-opening-keys { margin: 0; padding: 0; list-style: none; display: grid; gap: 5px; font-size: 12px; }
.lab-opening-keys code {
  font-family: var(--lab-mono);
  padding: 0 4px;
  border-radius: 4px;
  background: var(--lab-surface-2, var(--lab-surface));
  border: var(--lab-hairline) solid var(--lab-line);
}
/* A model this panel did not choose reads as inherited rather than set. */
.lab-model-name--inherited { color: var(--lab-text-3); }

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

/* The operator's own message reads as "mine" three ways at once, because one was
   not enough: at 92% width the right alignment was invisible, and a 5% tint against
   a white card is a difference you have to look for. Narrower, darker, and with the
   label in the stronger ink. */
.lab-row-card--user {
  margin-left: auto;
  max-width: 78%;
  background: color-mix(in srgb, var(--lab-text) 10%, transparent);
  border-color: transparent;
}
.lab-row-card--user .lab-row-label { color: var(--lab-text-2); }
/* And the agent's own answer keeps the plain card, but with a visible edge rather
   than a hairline that disappears against the panel. */
.lab-row-card--assistant { border-color: var(--lab-line-strong); }
.lab-row-card--reasoning { background: transparent; border-style: dashed; color: var(--lab-text-2); }
.lab-row-card--status { background: transparent; border-color: transparent; padding: 2px 13px; color: var(--lab-text-3); font-size: 12px; }
.lab-row-card--status .lab-row-label { margin-bottom: 0; display: inline; margin-right: 8px; }
/* The history rule: a line across the transcript with a caption sitting in it,
   marking where the resumed conversation ends. Not a card, because it describes
   the transcript rather than being part of it. */
.lab-history-rule {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 6px 0;
  font-size: 11px;
  color: var(--lab-text-3);
}
.lab-history-rule::before,
.lab-history-rule::after {
  content: '';
  flex: 1 1 0;
  height: var(--lab-hairline);
  background: var(--lab-line-strong);
}
.lab-history-label { flex: none; }

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
  margin: 0 auto 12px;
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
/* Above the box: working directory on the left, context on the right. Both
   shrink to nothing before the row wraps, so a long directory title truncates
   instead of pushing the usage meter off the edge. */
.lab-composer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 7px;
  min-width: 0;
}
/* Two clusters that each shrink before the row wraps: where the work is on the
   left, what it has cost on the right. */
.lab-composer-where { display: flex; align-items: center; gap: 10px; min-width: 0; }
.lab-composer-cost { display: flex; align-items: center; gap: 10px; flex: none; }

.lab-repo {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  font-size: 11px;
  font-family: var(--lab-mono);
  color: var(--lab-text-3);
  white-space: nowrap;
}
/* A detached HEAD is worth noticing before committing to it. */
.lab-repo--detached { color: var(--lab-warn); }
.lab-repo-branch { max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
.lab-repo-diff { display: inline-flex; gap: 4px; }
.lab-repo-added { color: var(--lab-success); }
.lab-repo-removed { color: var(--lab-danger); }
.lab-repo-track { opacity: .75; }

.lab-spend { font-size: 11px; font-family: var(--lab-mono); color: var(--lab-text-3); white-space: nowrap; }

.lab-cwd {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  color: var(--lab-text-2);
}
/* A block, not a bare inline span: an inline box refuses to shrink below its
   text, which is what let a long title overrun its neighbour once before. */
.lab-cwd-name {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--lab-mono);
}

/* Beneath the box: what the agent may do and what it is given on the left, what
   it costs and what answers on the right — the arrangement both products' own
   composers use. Wraps rather than overflows on a narrow panel. */
.lab-composer-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.lab-composer-tools { display: flex; align-items: center; gap: 6px; min-width: 0; }

.lab-icon-button {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--lab-text-2);
  background: var(--lab-fill);
  border: 0;
  border-radius: var(--lab-r-chip);
  cursor: pointer;
  transition: background var(--lab-fast) var(--lab-ease), color var(--lab-fast) var(--lab-ease);
}
.lab-icon-button:hover { background: var(--lab-fill-strong); }
.lab-icon-button:disabled { opacity: .45; cursor: default; }
.lab-icon-button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px color-mix(in srgb, var(--lab-accent) 16%, transparent);
}
/* Dictation running. Pulsed rather than merely coloured, because the operator
   needs to notice a live microphone from across the room. */
.lab-icon-button--live {
  color: var(--lab-danger);
  background: color-mix(in srgb, var(--lab-danger) 14%, transparent);
  animation: lab-pulse 1.6s var(--lab-ease) infinite;
}
.lab-mic-glyph { display: block; }
.lab-brand-glyph { display: block; flex: none; }

@keyframes lab-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .55; }
}

.lab-composer-hint { display: block; margin-top: 7px; font-size: 11px; color: var(--lab-text-3); }
.lab-composer-hint--second { margin-top: 3px; }

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

/* Opens upward: the trigger sits at the bottom of the composer, so a menu
   dropping down would land outside the panel. */
.lab-mode-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
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

/* ------------------------------------------------------- model and quota */

.lab-model { position: relative; flex: none; min-width: 0; }
.lab-model-trigger {
  appearance: none;
  font: inherit;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 190px;
  padding: 5px 9px;
  color: var(--lab-text-2);
  background: var(--lab-fill);
  border: 0;
  border-radius: var(--lab-r-chip);
  cursor: pointer;
  transition: background var(--lab-fast) var(--lab-ease);
}
.lab-model-trigger:hover { background: var(--lab-fill-strong); }
.lab-model-trigger:disabled { opacity: .5; cursor: default; }
.lab-model-trigger:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3.5px color-mix(in srgb, var(--lab-accent) 16%, transparent);
}
/* Truncates rather than widening the composer: a model name is vendor text and
   some of them are long. */
.lab-model-name {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Right-aligned and upward, matching where its trigger sits. */
.lab-model-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  z-index: 20;
  width: min(320px, 76vw);
  max-height: min(420px, 52vh);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  background: var(--lab-surface);
  border: var(--lab-hairline) solid var(--lab-line-strong);
  border-radius: var(--lab-r-card);
  box-shadow: 0 8px 28px -10px rgba(0, 0, 0, .28);
  animation: lab-palette-in var(--lab-fast) var(--lab-ease);
}
.lab-model-group { display: grid; grid-template-columns: minmax(0, 1fr); }
.lab-model-option {
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
.lab-model-option:hover { background: var(--lab-hover); }
.lab-model-option-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lab-model-option-hint { grid-column: 1; font-size: 11px; line-height: 1.45; color: var(--lab-text-3); }
.lab-model-check { color: var(--lab-accent); font-size: 12px; }

/* Effort sits under its own model, indented, because it only applies there. */
.lab-effort { padding: 2px 9px 8px 18px; }
.lab-effort-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 5px;
}
.lab-effort-label { font-size: 11px; color: var(--lab-text-3); }
.lab-effort-value { font-size: 11px; color: var(--lab-text-2); }

/* The stops overlay the track, so both share one positioning context. */
.lab-effort-track { position: relative; display: flex; align-items: center; height: 22px; }

.lab-effort-input {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  height: 22px;
  margin: 0;
  background: transparent;
  cursor: pointer;
}
.lab-effort-input:focus-visible { outline: none; }

/* Filled portion up to the thumb, unfilled after it. No browser paints this the
   same way, and Firefox's ::-moz-range-progress covers only one half, so the whole
   track is drawn from one gradient driven by the progress property. */
.lab-effort-input::-webkit-slider-runnable-track {
  height: 22px;
  border-radius: 11px;
  background:
    linear-gradient(
      to right,
      var(--lab-accent) 0 var(--lab-effort-progress, 0%),
      var(--lab-fill-strong) var(--lab-effort-progress, 0%) 100%
    );
}
.lab-effort-input::-moz-range-track {
  height: 22px;
  border-radius: 11px;
  background:
    linear-gradient(
      to right,
      var(--lab-accent) 0 var(--lab-effort-progress, 0%),
      var(--lab-fill-strong) var(--lab-effort-progress, 0%) 100%
    );
}
.lab-effort-input::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  margin-top: 2px;
  border-radius: 50%;
  border: 0;
  background: var(--lab-surface);
  box-shadow: 0 1px 4px -1px rgba(0, 0, 0, .35);
  cursor: grab;
}
.lab-effort-input::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 0;
  background: var(--lab-surface);
  box-shadow: 0 1px 4px -1px rgba(0, 0, 0, .35);
  cursor: grab;
}
.lab-effort-input:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 3.5px color-mix(in srgb, var(--lab-accent) 26%, transparent);
}

/* Inset by half a thumb at each end, so a dot sits exactly where the thumb lands
   for that level rather than drifting toward the middle. */
.lab-effort-stops {
  position: absolute;
  inset: 0 9px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: none;
}
.lab-effort-stop {
  display: block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  /* One ink that reads on both halves of the track, without knowing which half a
     given dot is on. The difference blend inverts against whatever is behind it,
     so a pale dot goes dark on the light unfilled track and light on the filled
     one. This matters because the theme's accent is nearly black, and an overlay
     blend, tried first, vanished on it completely. */
  background: color-mix(in srgb, var(--lab-on-accent) 60%, transparent);
  mix-blend-mode: difference;
}

.lab-quota {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  font-size: 11px;
  font-family: var(--lab-mono);
  color: var(--lab-text-3);
  white-space: nowrap;
}
.lab-quota--warn { color: var(--lab-warn); }
.lab-quota--out { color: var(--lab-danger); }

/* ------------------------------------------------- file and folder picker */

.lab-attach { position: relative; flex: none; }
/* Upward and left-aligned, under the plus button that opens it. */
.lab-attach-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 20;
  width: min(360px, 80vw);
  padding: 6px;
  background: var(--lab-surface);
  border: var(--lab-hairline) solid var(--lab-line-strong);
  border-radius: var(--lab-r-card);
  box-shadow: 0 8px 28px -10px rgba(0, 0, 0, .28);
  animation: lab-palette-in var(--lab-fast) var(--lab-ease);
}
/* Two machines, two tabs. Named rather than iconic, because "this computer" and
   "the working directory" are not a distinction an icon can carry. */
.lab-attach-tabs { display: flex; gap: 4px; margin-bottom: 6px; }
.lab-attach-tab {
  appearance: none;
  font: inherit;
  font-size: 12px;
  flex: 1 1 0;
  padding: 5px 8px;
  color: var(--lab-text-2);
  background: var(--lab-fill);
  border: 0;
  border-radius: var(--lab-r-chip);
  cursor: pointer;
  transition: background var(--lab-fast) var(--lab-ease), color var(--lab-fast) var(--lab-ease);
}
.lab-attach-tab:hover { background: var(--lab-fill-strong); }
.lab-attach-tab--on { color: var(--lab-on-accent); background: var(--lab-accent); }

.lab-attach-search { margin-bottom: 4px; }
.lab-attach-upload { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; padding: 2px 2px 4px; }
/* The host browser reuses the crumb trail and row styling the workspace picker
   already has; only the stacking is its own. */
.lab-attach-host { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
.lab-attach-warning {
  margin: 0;
  padding: 7px 8px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--lab-warn);
  background: color-mix(in srgb, var(--lab-warn) 10%, transparent);
  border-radius: 7px;
}

/* A file input has to be a real, reachable input for the browser to open its
   chooser at all, so it is moved out of the layout rather than hidden: an input
   set to display none cannot be clicked programmatically in every browser. */
.lab-offscreen {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
.lab-attach-list {
  max-height: min(280px, 40vh);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.lab-attach-row {
  appearance: none;
  font: inherit;
  text-align: left;
  width: 100%;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 2px 8px;
  padding: 6px 8px;
  color: var(--lab-text);
  background: transparent;
  border: 0;
  border-radius: 7px;
  cursor: pointer;
  transition: background var(--lab-fast) var(--lab-ease);
}
.lab-attach-row:hover { background: var(--lab-hover); }
.lab-attach-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The full relative path under the name, so two files with one base name are
   distinguishable without hovering. */
.lab-attach-path {
  grid-column: 2;
  font-size: 11px;
  font-family: var(--lab-mono);
  color: var(--lab-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

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
.lab-palette-path { font-family: var(--lab-mono); font-size: 11px; color: var(--lab-text-3); grid-column: 1 / -1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
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
  /* Each half of the composer's foot takes its own line, so the send button
     stays reachable instead of being squeezed by the pickers beside it. */
  .lab-composer-tools { flex: 1 1 100%; justify-content: space-between; }
  .lab-row-card--user { max-width: 100%; }
}
`
