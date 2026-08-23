# Features

Everything the panel does, in roughly the order you meet it. The
[README](../../README.md) covers getting it running; this covers what is there once it
is.

One rule shapes most of what follows: each product is asked what it can actually do,
and only that is offered. Where the two differ — Codex reports three permission modes
to Claude Code's five, Claude Code cannot list its models until a turn has run — the
difference is reported rather than smoothed over. A control that silently does
something else is worse than one that is absent.

## The composer


| Key | Does |
| --- | --- |
| Enter | Send |
| Shift+Enter | Newline |
| `↑` / `↓` | Walk messages already sent (in an empty composer) |
| Esc | Interrupt a running turn, else clear the draft |
| `/` | Commands and skills the product reports |
| `@` | Files under the working directory |

Enter is ignored while an input method is composing, so accepting a candidate does
not send a half-written message.

`@` works anywhere a word can begin, because referencing a file happens
mid-sentence, and selecting one replaces just that token. The search runs on the
Host, confined to the working directory after symlinks are resolved, bounded by a
visit budget, and skipping `.git` and dependency trees. When it stops early it says
so rather than presenting a partial list as complete.

The controls around the box follow each product's own composer:

| Position | Shows |
| --- | --- |
| Above, left | Working directory, branch, and lines changed |
| Above, right | Tokens spent, and how full the context is |
| Below, left | Permission mode, a file button, and dictation |
| Below, right | Usage allowance, model, and send |

**The status line above the box** answers what a terminal answers at a glance.
Branch and change size come from `git status --porcelain=v2` and `git diff
--numstat HEAD`, run on the Host with no inherited environment and with terminal
prompts and index locks disabled, so a status read can neither block on a
credential nor fight your own terminal. A directory that is not a repository, or a
Host without git, simply shows nothing. A detached HEAD names its commit and says
so; a branch tracking nothing says that too, because finding out after a push is
the wrong time.

Tokens spent is the running total for the session, with input, output, cache reads
and cache writes on hover. It is a different question from the context meter beside
it — one only grows, the other moves both ways as the session compacts — which is
why both are there.

**The file button** offers three routes, because a file can be in three places:

- **Working directory** is `@` without the syntax — the same Host search, listing
  files and folders, appending the reference to the draft. Nothing is copied. A
  folder keeps its trailing slash, which is how both products tell one from a file.
- **This computer** sends files from the machine the browser is running on, which is
  the only way those bytes can arrive when the Harness is somewhere else. They land
  in `.dsh-bridge-uploads/` inside the working directory — add it to `.gitignore` —
  and are referenced identically, so the products read one shape either way.
- **Host filesystem** browses the machine the Harness runs on, beyond the working
  directory, and references what you pick by absolute path. Directories open on
  click; a directory is referenced through its own button, so one click never means
  two things. Dot-prefixed entries stay hidden until you ask.

Browsing the Host is the panel's widest read, and it can be turned off — see
[Browsing the Host filesystem](security.md#browsing-the-host-filesystem) for what it
does and does not grant.

Uploads are the only path in the bridge that writes Host files, so they are narrow
by design: one destination the browser cannot name, file names rebuilt from an
allow-list rather than trusted, containment re-verified after symlinks resolve,
nothing ever overwritten, and ceilings of 8 MB per file, 32 MB per request, and 50
files. A name that cannot be made safe, or a file over the ceiling, is refused and
counted rather than silently dropped.

**Dictation** appears only where the browser has the Web Speech API, which in
practice means Chromium. Transcripts are appended, so speech extends a typed
sentence instead of replacing it. Note that a browser's recognition is not
necessarily local — see [Security boundary](../../README.md#security-boundary).

## The sidebar


The toggle sits at the titlebar's left, on the same side as the sidebar it
controls. Collapsed, the sidebar becomes a 52px icon rail that still switches
sessions — a running turn shows as a dot — and the content area takes the width
back.

## Permission modes


The modes are named after the Claude desktop app, because that vocabulary is what
operators already know:

| Mode | Means |
| --- | --- |
| Auto | The agent handles permission decisions |
| Manual | Always ask before making changes |
| Accept edits | Automatically accept all file edits |
| Plan | Create a plan before making changes |
| Bypass permissions | Accepts all permissions |

Each product reports only the modes it can actually honour, so a mode on screen is
always the mode the agent obeys. Claude Code has a native equivalent for all five.
Codex reports three: it has no accept-edits policy, and its plan mode is reachable
only through a payload that would override the model and reasoning effort you
configured on the Host.

**Accept edits and Bypass permissions stop the browser being asked to approve
anything** — the protection this bridge exists to provide. They are offered because
both products offer them, and the panel marks and warns about them. A change
applies from the next turn, because that is when both products read the setting.

## Model, effort, and quota


Both products enumerate their own models and both accept one per turn, so the
picker offers exactly what the session's product reported — there is no list of
model names here to fall out of date. Reasoning effort nests under the model,
because that is how both products scope it: the levels one model accepts are not
the levels another does, and a model that takes none shows none.

`Product default` is a real choice, not a placeholder. Leaving it selected keeps
whatever you configured in the CLI itself, which is the right answer if you have
already set a model there. A change applies from the next turn, for the same reason
as the permission mode.

Effort is a slider rather than a row of buttons, because the levels are one ordered
axis of "think harder" and not five unrelated choices. It is a native range input,
so keyboard and screen readers work without being reimplemented, and it announces
the level's name rather than its index. Levels the panel has no word for — Codex
ships an `ultra` the Claude SDK does not — are shown exactly as the product spells
them.

| Product | Models from | Applied through |
| --- | --- | --- |
| Claude Code | `supportedModels()` on a live SDK query | `Options.model` and `Options.effort` |
| Codex | `model/list` on the App Server | `model` and `effort` on `turn/start` |

As with commands, Claude Code can only be asked while a turn is running, so the
list appears after a first message has been sent anywhere in the panel; until then
the control says so rather than looking like a product with no models. Codex
answers at any time.

**Quota is shown only when the product volunteers it.** Claude Code emits it as a
stream event for subscription accounts; Codex has the reciprocal call but refuses
it without a ChatGPT sign-in. An account the product said nothing about shows
nothing, because a zero or a dash would read as a figure. When several allowances
are reported the tightest one is shown — that is the one that will stop you — and
the rest are in the tooltip.

## Commands, skills, and MCP


Typing `/` in the composer lists what the session's product reports it can do,
filtered as you type and navigable with the arrow keys. Selecting an entry writes
the product's own invocation text and nothing else — the bridge never runs a
command on the product's behalf, so `/compact` means what it means in a terminal
and a product that renames a command needs no change here.

The syntax is the product's, not the bridge's:

| Product | Reported through | Invoked as |
| --- | --- | --- |
| Claude Code | `supportedCommands()` on a live SDK query | `/name` |
| Codex | `skills/list` for the session's working directory | `namespace:skill` |

Claude Code can only be asked while a turn is running, so its list appears after
the session's first message and refreshes on each later turn; until then the panel
says it has not reported yet, which is not the same as reporting none. Codex
answers at any time.

MCP servers from both products are listed with the state each reports, as
inventory — they are not invocable from the composer.

### Why `/resume`, `/model` and `/clear` are not there

They are not commands. `/resume`, `/model`, `/help`, `/clear` and the rest belong to
Claude Code's terminal interface, which draws its own screen and reads its own
keystrokes; the Agent SDK this bridge drives has no such layer, so those commands
do not exist in it. What `supportedCommands()` returns is skills — its own
documentation says so — which is why typing `/resume` gets you the product's honest
`/resume isn't available in this environment` rather than a bridge-invented error.

The capabilities themselves are all here, as controls rather than as typed
commands, because that is the shape the SDK exposes them in:

| In a terminal | In this panel |
| --- | --- |
| `/resume` | `Browse existing sessions…` |
| `/model` | The model picker at the composer's bottom-right |
| `/status` | Context usage above the box, quota below it |
| `/permissions` | The permission-mode picker |

Anything a product genuinely reports as a command or skill does appear in the `/`
list, and it is invoked with the product's own syntax.

## Continuing an existing session


`Browse existing sessions…` lists the native sessions that already exist for the
selected directory, including ones you started in a terminal, and hands the one
you choose to the product's own resume path.

**The earlier conversation is loaded into the timeline.** Resuming gives the
*product* its context back — that is what resuming means — but the panel only ever
recorded its own turns, so continuing a session started in a terminal used to show
a blank screen above a working agent. The transcript is now read back through each
product's own API and written as ordinary events, so it persists, replays after a
reload, and survives a Host restart like anything else. A rule across the
transcript marks where the existing conversation ends.

| Product | Transcript from | What it contains |
| --- | --- | --- |
| Claude Code | `getSessionMessages()` | Messages, thinking, and tool calls with their results |
| Codex | `thread/read` with turns | Messages only — the rollout history holds no tool calls |

The difference is the products', not the bridge's: Codex's stored history simply
does not carry tool calls, and inventing them would be worse than their absence.
`thread/items/list` would be the paginated equivalent, but this Codex answers it
with "not supported yet".

The newest part is kept, not the oldest. A long session's opening is rarely what
you need in order to continue it — in one real case it was a single message
followed by a hundred tool calls — so the tail survives and the panel says when
earlier entries were dropped.

Enumeration goes through each product's own API — the Agent SDK's `listSessions`,
Codex's `thread/list` — never by reading `~/.claude` or `~/.codex`. For Claude
Code the listing excludes programmatic entrypoints, which is what the SDK
documents for a session picker and also keeps the bridge from offering back the
sessions it created itself.

Session transcript paths stay on the Host. An unknown or expired locator makes the
session `orphaned`, the same as one that stopped resolving after a Host restart.

## The side panel


The button at the titlebar's right opens a third column showing the project the
agent is working on: a viewer above, the working directory's tree below. Reading a
file the agent just changed does not mean leaving the conversation.

Everything here is workspace-relative. The tree and the viewer both work in paths
under the session's working directory, so nothing this panel holds or sends is an
absolute Host path — unlike the composer's host browser, which exists to do exactly
that and says so. Confinement is checked after symlinks resolve: a link committed
into a repository must not become a way to read whatever it points at.

Directories are read when opened, not up front, so a monorepo is not walked for a
tree nobody asked to see. `.git` and `node_modules` are skipped. Dotfiles are listed
but hidden until asked for. A file over 512 KB is cut and says so, and a binary file
says it is binary rather than rendering a screenful of replacement characters.

With writes enabled the panel is a lightweight file manager: create a file or
directory, rename, delete, and edit contents in place. Everything is confined to the
working directory, and three refusals are deliberate:

- **Creating never overwrites.** "New file" and "erase that file" are different
  intentions and only one was expressed. The parent directory must already exist, so
  one mistyped path cannot produce a tree nobody asked for.
- **Deleting is not recursive.** A directory with contents is refused, and says so. A
  recursive delete reachable from a browser is a way to lose a repository to one
  mis-click.
- **Saving is refused if the file moved.** The file is read with a revision, and the
  write carries it back. The agent works in this same tree, and a panel that wrote
  whatever its buffer held would silently discard whatever the agent had just done. On
  a mismatch your text stays in the editor and the viewer shows the newer file, so you
  can see both before deciding.

A truncated file cannot be edited at all — saving would write the part that was shown
over the whole file.

Editing is a plain textarea rather than the highlighted view made editable. Overlaying
a caret on coloured spans is a rewrite of text editing, and getting it subtly wrong is
worse than editing in monospace for a minute.

Set `allowWorkspaceWrites: false` in the Profile config to turn all of it off; the
controls then do not appear rather than appearing and failing.

Syntax colour comes from lowlight — highlight.js's analysis as a tree rather than as
a string of HTML, which is why this renders React elements and no
`dangerouslySetInnerHTML` exists in the panel at all. 37 languages, chosen from the
extension and checked against what is registered: an unknown extension shows as
plain text rather than being guessed at, because colours assert a structure and
asserting the wrong one is worse than asserting none.

It costs 314 KB uncompressed in the client bundle, around 80 KB over the wire. If
that matters more than breadth, `createLowlight(common)` in `src/client/code.tsx`
can take a hand-picked subset instead.

The syntax palette is the one place in the stylesheet with literal colours. The
Harness exposes label, state and button aliases and no syntax scale, and there is no
honest way to derive eight distinguishable hues for code from four semantic ones — so
it carries two full sets, one per theme, rather than one being an inversion of the
other.

### The Diff tab

When the working directory is a git repository, the panel's second tab shows what is
uncommitted — against HEAD, so staged and unstaged changes are one view, which is what
a person means by "what have I changed".

Two layouts. **Unified** is git's own line order and the default, because the panel is
narrow and one column of long lines beats two columns of wrapped ones. **Side by side**
pairs each removal with the addition that replaced it, so an edited line reads as one
change rather than as a deletion followed by an unrelated insertion; where one side
runs out, the other keeps a blank cell — three lines replaced by one is not three
edits.

The diff itself comes from git's unified output rather than from comparing files in
the plugin. git knows about rename detection, whitespace options, text conversion
filters and binary files, and a reimplementation would be wrong about all four.

Untracked files are listed but carry no hunks: they have no older version to compare
against, and rendering a whole new file as one enormous addition would bury the
changes it sits beside. The panel says so and points at the Files tab.

## How a turn reads


A turn is three layers: the question, the work, the answer.

The work — tool calls, thinking, and the "I'll start by looking around" the agents
open with — folds into one line: `processed in 2m19s · 4 steps`. It is open while
the turn is running, because that is when watching it is the point, and folded once
the turn finishes, because then the answer is. A fold you set yourself wins over
both: having opened the work to read it, you should not have it shut under you when
the turn completes.

The answer is the turn's *last* assistant message. Everything before it is work,
which is why an opening remark folds away with the tool calls it introduced.

Four things stay outside the fold, because none of them is work leading to an
answer: your own message, the rule marking a resumed transcript, a status you have
to act on, and an error. A failure is an outcome, and folding it away would hide the
one row most worth seeing.

Routine status rows — `running`, then `idle`, around every turn — are not shown at
all. The toolbar reports that live, and two rows between every question and its
answer was the noise this grouping exists to remove.

## Images


Paste a screenshot into the composer and the agent sees it. Both products take
images natively — Codex as an `image` input item, Claude Code as a base64 image
block — so this is the picture reaching the model, not a file it has to be told to go
and read. An image on its own is a valid message: "what is this" is a perfectly good
prompt when the picture is the question.

Each image is also saved into `.dsh-bridge-uploads/` and referenced in the message
text, so the conversation still makes sense after a reload. The paths are what the
transcript stores, not the bytes: a screenshot is hundreds of kilobytes and the event
log keeps two thousand entries, so storing the images there would trade the whole
transcript for a few pictures.

Types are allow-listed to PNG, JPEG, GIF and WebP — what the products accept. SVG is
excluded deliberately: it is an image to a browser and a script host to everything
else. Eight images per message, 5 MB each.

Claude Code's streaming input mode is used only when there are images, because that
is what carries image blocks. Every text-only turn takes exactly the path it did
before.

## Markdown


Both products answer in markdown, and the panel renders it: headings, tables, lists,
fenced code, bold, inline code. Only what the agent wrote — the operator's own
message stays exactly as they typed it, and a tool's output stays in its code block,
where markdown would corrupt it.

The renderer is written into the plugin rather than pulled in, for two reasons.

**It cannot inject.** Every node it produces is a React element, and React escapes
text children; there is no `dangerouslySetInnerHTML` and no markdown-to-HTML step for
a sanitizer to have to keep up with. That matters here specifically: an agent's
output is not trusted input — it can be shaped by whatever the agent just read — and
this panel renders it inside a Harness holding the operator's session.

**It degrades instead of failing.** The streaming reveal hands it text mid-token, so
a paragraph is routinely an unclosed bold run or half a table. Anything
unterminated or unrecognised renders as the characters that were typed, which is what
the panel did before markdown existed — so the worst case is no worse than the old
behaviour.

Raw HTML, images, blockquotes, footnotes and nested lists are not supported and
appear as their source text. Links show their label and their target but are not
clickable: a clickable destination composed by a model that just read an untrusted
file is an attack surface this view does not need.

## The trace view


`Trace` sits beside `Conversation` and answers a different question: not what was
said, but where the time went and what the agent actually did. A strip over the
turn's timeline — input, model, tools — then one line per step with its arguments,
its result and its duration, filterable, with the totals underneath.

All of it is derived from events the panel already holds. There is no extra Host
call, no new event type and no additional retention: every bridge event carries a
timestamp and a turn id, and that is enough for spans, ordering and totals.

Two things are deliberate:

**Idle time is removed.** Duration counts the turns, not the wall clock. A session
left open overnight has a first-to-last span of hours — measured on a real one, it
read `4262m40s` — and none of that was work. Activity is bounded by turn start and
turn completion rather than by gaps between events, because a model reasoning for
ten seconds emits nothing and a gap-based rule would score deep thinking as idleness.
Waiting on an approval stays counted: the turn genuinely had not finished.

**A figure that was not measured is absent, not zero.** No token report means no
tokens-per-second and no cache ratio. A zero in a performance view gets believed.

**There is no model-time / tool-time split, and that is on purpose.** It looks
derivable from the event timestamps and is not: those record when a product chose to
report something, not when it did it. A real Codex turn lasting 2m18s delivered
every one of its events in the final three seconds, and stamped a shell command's
start and completion 1ms apart — from which the first version of this view computed
"model 11ms, tools 1ms, 7636 tok/s". The trace therefore says *when* each step was
reported, and the only rate it gives is output tokens over turn duration, whose
denominator the bridge stamps itself.

## The lock


Settings -> Privacy sets a password for this panel. Enabled by setting one, disabled
by removing it — the password's presence is the switch, so there is nothing else to
keep in sync with it.

Locked, the panel shows a password field **in place of** itself, not over it: the
body is not in the DOM at all. That is a consequence rather than the mechanism. The
mechanism is on the Host, where every one of the bridge's Remote methods refuses
without a valid token — so the field is not what keeps anyone out, and removing it
would make the panel unusable rather than open.

One unlock lasts 8 hours, or 30 minutes idle, both counted on the Host. `Lock now`
in the settings page drops every unlock everywhere, not just this browser's: locking
from a machine you are walking away from should not leave another one open. A Host
restart locks it too — the password is stored, the unlock is not.

Guessing is bounded twice, because one bound is not enough: the verifier is `scrypt`
at ~0.15s a guess, and five failures start a lockout that doubles from 30 seconds to
a 15-minute ceiling. While the lockout stands, even the right password is refused.

The screen says what it does not cover, because the moment someone sets a password
is the moment they form a belief about it. It covers this panel, not the rest of the
Harness, and over plain HTTP the password travels in cleartext — see
[the panel's own lock](security.md#the-panels-own-lock) for the reasoning and
[`examples/proxy/Caddyfile`](../../examples/proxy/Caddyfile) for gating the Harness
itself.

## Motion


Almost all of it is CSS — hovers, presses, the caret, a popover's entrance, the
context meter filling. Two things are not, and both are the same problem: a layout
size with no second keyframe to transition to.

A **fold** cannot go from `height: 0` to `height: auto`, because `auto` is not a
length until it has been laid out. The **side panel** cannot slide, because opening
it gives the body a third grid column and a track list cannot be interpolated
against one of a different length — so it popped into place and the conversation
jumped sideways to make room.

Both are tweened by GSAP, in `src/client/motion.ts`, which measures the size at run
time and drives it frame by frame. The panel's width is read off the stylesheet
rather than restated in code, so widening the panel in CSS moves the animation with
it. Both keep their content mounted just long enough to be seen closing, and both
clear every inline style when they land — a fold left pinned at a measured height
would clip the rows that stream in after it opened.

Measured on a real transcript whose work rows were 12,800px tall, the tween held the
display's frame budget with no dropped frames of its own. Nothing animates on first
paint: a transcript that has just loaded, or a session just resumed, would otherwise
play back every fold it contains as though someone had opened them.

Under `prefers-reduced-motion` neither animates — the fold and the panel simply
appear, which was the behaviour before this existed.

GSAP is not under an OSI-approved licence; see
[THIRD_PARTY_NOTICES](../../THIRD_PARTY_NOTICES.md).

## Streaming


Both products stream token by token, and the Host relays each delta the moment it
arrives. The browser reads through a long poll, though, so what it receives is
everything that accumulated during one round trip — measured on a real Codex turn,
11 characters and then 346 at once. Correct, and it did not look like streaming.

Arrival and display are therefore separate: text is revealed on a frame timer whose
stride grows with the backlog, so a large batch catches up in a few frames instead
of appearing whole, and the reveal can never fall permanently behind a fast turn. A
finished answer and a transcript restored from a resumed session are shown complete
— animating those would misrepresent when they happened.

Timeline rows are memoized, which is the other half: without it every delta
repainted a resumed session's several hundred rows, which lengthened the round trip
and made the next batch bigger still.
