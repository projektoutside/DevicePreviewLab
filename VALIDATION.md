# Integration validation — 2026-10-01

Integration branch: `codex/final-integration-20261001`.
Base: `1822ac9` (local main and origin/main). No other feature branches or
pull requests were present. Accumulated working-tree changes and relevant
checkpoint snapshots were reviewed and consolidated. The prior hot-reload
thread used this same project; an unrelated MongTeng thread was excluded.
A Git bundle and source recovery copy are retained locally under `.logs`.

## Passed checks

- `npm test`: 8 state, server, authorization, and real PTY regression tests.
  Covers arbitrary-port HTTP discovery, correct working directory, reconnect
  history, resizing, Ctrl+C, shell exit, and command-child cleanup.
- `npm run lint`: ESLint recommended rules, zero warnings.
- `npm run check`: JavaScript syntax checks.
- `npm run build`: both GUI executables, compiler warnings treated as errors.
- `npm audit`: no reported vulnerabilities.
- `git diff --check`: no whitespace errors.
- Preview browser regression: 24 checks passed.
- Terminal Hall browser regression: 13 checks passed, including rendered shell
  output, tab switching, page reload, responsive layout, and session closure.
  The final browser runs reported no console errors.
- Native launcher fixture: normal and forced shutdown passed under PowerShell
  7 and Windows PowerShell 5.1; no allocated PowerShell console and correct
  argument forwarding.
- Actual native workstation check: browser-process exit and forced launcher
  exit stopped the app's server, terminal shell, and command child.
- Native Explorer folder picker was operated through Windows computer use:
  selecting the application folder opened PowerShell in that exact folder and
  brought its Terminal Hall tab to the front. The picker and test session closed.

Existing external servers appear as live preview tabs with process details.
Their original consoles are not imported. Interactive terminal control is
available for sessions started in Terminal Hall. Closing the Lab ends its
managed sessions; it does not rerun commands on a later launch.

Both executables were rebuilt in the application directory. Task-owned browser
sessions, app windows, shells, and servers were closed after verification.
The user's pre-existing Lab session and other resources were left running;
reopening the updated launcher activates the new backend.

## Compact workspace and terminal visibility follow-up — 2026-10-01

Fixed Terminal Hall's fitting mismatch: its padded outer container was measured
as fully usable terminal space. An unpadded inner mount now gives FitAddon the
actual available dimensions, with 16 px reserved below the last row. Fits are
coalesced per animation frame, and terminal creation waits for its stylesheet.
The Latest output control restores the bottom of the terminal's history.

The main workspace now fits the viewport. Grid frames scale into the remaining
height; board tiles and terminal history scroll within their own panels. Compact
controls and horizontally scrolling tab strips keep the header from growing.
At 1500×980, the grid starts at 159 px instead of 293 px, saving 134 px above it.

Validation for this follow-up:

- `npm test`: 8 tests passed; lint, syntax, whitespace, and audit passed.
- Preview browser regression: 24 checks passed.
- Terminal Hall browser regression: 22 checks passed, including a fully visible
  bottom-row PowerShell prompt after long output, padding at five window sizes,
  enlarged UI zoom, scrollback, Latest output, tab switching, and reconnect.
- Layout browser regression: 27 checks passed at 1920×1080, 1500×980, 1280×720,
  1024×640, and 390×844. All modes fit the main page; complete device shells fit
  their stages at desktop sizes. Large boards and many tabs scroll internally.
- Screenshots inspected: `output/playwright/compact-workspace.png` and
  `output/playwright/terminal-bottom-safety.png`.
- Both GUI executables compiled to `.logs` with warnings treated as errors.
  Native launcher normal/forced cleanup fixture passed. The installed launcher
  also passed actual workstation shutdown checks with the updated app files.

The existing .exe loads the updated app files; refresh the Lab page to apply
this layout while keeping running terminal sessions. Task-owned test sessions
and helpers were closed; the user's existing Lab and terminals stayed running.

## Accurate local host discovery follow-up — 2026-10-01

Replaced the two divergent scanners with one discovery service shared by Terminal
Hall and both URL dropdowns. Windows TCP listener enumeration covers arbitrary
ports, IPv4, IPv6, and locally bound interfaces, with no 512-listener truncation.
HTTP and HTTPS responses are checked with bounded concurrency/body sizes.

Known Dart VM/tooling, WebSocket-only, Chrome/Node debugging, generic unserved
HTTP.sys, and Lab endpoints are filtered by protocol/response evidence. Normal
apps in those same processes remain detectable. Protected apps, APIs, redirects,
and missing-root applications are retained. Website titles label tabs, and full
URLs identify sessions so separate IPv4/IPv6 hosts sharing a port do not collide.
Scanner failures are reported rather than replaced by an unverified opaque
browser scan. Manually entered custom hostnames/routes remain supported.

Passed validation:

- 16 automated tests (including 8 focused discovery tests), no skips.
- Browser checks: preview 24, Terminal Hall 22, layout 27, discovery 17.
- Three additional live checks verified closed fixture tabs disappear and the
  actual Nikhom website remains while the pictured tooling ports are filtered.
- Lint, JavaScript syntax, whitespace, both executable builds, normal/forced
  native launcher fixture, and actual workstation process cleanup passed.
- Inspected `output/playwright/verified-local-hosts.png`; the deliberately
  protected fixture's HTTP 403 console message is expected. Final live tab strip
  is saved in `output/playwright/local-hosts-filtered.png`.

Native tests ran against the existing .exe with the updated application files.
The current running backend requires a Lab restart to load the new scanner.
The user's app/terminals were preserved; only task-owned fixtures were closed.

## Preview zoom and resize follow-up — 2026-10-01

Added independent preview zoom in every box, global device preview zoom, and
whole-board layout zoom with Fit board. Device viewport dimensions remain fixed;
zoom and resizing preserve the loaded page. Enlarged previews scroll internally.
Saved zoom preferences migrate safely from existing workspaces.

Resize events are grouped into animation frames. Final dimensions are flushed on
pointer cancellation, capture is released, and scaled board coordinates are used
for dragging/resizing. The corner handle also supports arrow-key resizing. New
tiles fit the available board, including cascade offsets; old negative positions
are normalized into reachable positions. Hidden modes defer initial navigation.
URL editing updates an existing tile without losing its layout; Open checks its
target directly. Main-page scrolling remains disabled.

Passed validation:

- 18 automated tests, no skips; lint, syntax and whitespace checks.
- Browser checks: preview 24, Terminal Hall 22, layout 28, discovery 17, zoom 38
  (129 total). The zoom checks exercise actual target content and clicks, a burst
  of 100 pointer events, cancellation cleanup, scaled dragging/resizing, keyboard
  resizing, persistence, internal scrollbars, hidden loads, and URL edits.
- Both GUI executables compiled to `.logs/zoom-validated.exe` and its companion
  picker with compiler warnings treated as errors. Normal/forced launcher fixture
  checks passed; the installed executable passed actual workstation lifecycle
  checks, including terminal command-child cleanup.
- Inspected browser screenshots `output/playwright/board-zoom.png` and
  `output/playwright/compact-workspace.png`. Layout checks cover 1920×1080,
  1500×980, 1280×720, 1024×640 and 390×844.

Remaining target-specific issue: the live Flutter development host was blank
both inside All in One and in a separate direct browser session. Both documents
loaded 811 scripts but produced zero Flutter views/canvases. There were no page
exceptions during the embedded startup check. Working HTML applications render
and remain interactive in the updated board. The target's startup failure is
outside this repository; its code, data and process were left untouched. This
does not establish that the user's existing native window was visually inspected.

The installed .exe loads the updated frontend files. Refreshing the Lab applies
these changes while preserving backend terminal sessions. Main integration is
held until the live target's loading issue is resolved, consistent with the
requested release gate.

## Flutter white-preview fix and final integration — 2026-10-01

Resolved the live Nikhom host's white screen at `http://127.0.0.1:61655/`.
All 803 Dart modules loaded, but DWDS withheld the startup signal from additional
browser instances. Calling the generated main entrypoint rendered the actual app.
The four-device grid exposed a second failure: each DDC loader queued hundreds
of scripts with a request pool of 1000, producing `ERR_INSUFFICIENT_RESOURCES`.

Added an opt-in, loopback-only debug bootstrap helper and an idempotent installer.
The helper caps the SDK's request pool at 32 before library loading, waits for
loaded modules, gives the debugger its normal startup opportunity, and starts
the app once if needed. A delayed debugger signal cannot duplicate `runApp`;
SDK-managed restarts remain allowed. The temporary configuration accessor is
restored to the SDK's normal plain property. Release builds and unmarked pages
are unchanged. Open from the Lab now carries the same explicit preview marker.

Installed the helper into Nikhom's `web/flutter_bootstrap.js`, preserving its
custom code and all other project work. The exact original backup is under
`.logs/flutter-bootstrap-backups/Nikhom Financials-20261001T233429655.js`.
The existing Flutter server immediately served the updated bootstrap.

Passed validation:

- 25 automated tests, no skips, including startup races, concurrency adaptation,
  inactive release/remote paths, timeout cleanup, and installer preservation.
- Lint, JavaScript syntax and whitespace checks.
- Browser regression checks: preview 24, Terminal Hall 22, layout 28, zoom 38,
  discovery 17 (129 total).
- 19 additional live Flutter checks: actual All in One, all four device frames,
  Terminal Hall, reload, Open, zoom, keyboard resize, duplicate-start prevention,
  and no outer layout scrollbars. All four loaders used the bounded request pool;
  startup produced no page exceptions or resource-exhaustion errors.
- Inspected `output/playwright/flutter-board-working.png` and
  `output/playwright/flutter-grid-working.png`, showing real Nikhom content.
  Enabled Flutter accessibility in the isolated browser and clicked Settings,
  then closed the resulting details dialog to verify the rendered UI responds.
- Rebuilt both installed GUI executables with warnings treated as errors.
  The installed launcher passed normal/forced cleanup fixtures and actual
  workstation lifecycle checks, including terminal-shell and command-child
  cleanup on browser exit and forced launcher exit.

The original user Lab and its Flutter host stopped after live validation; they
were not restarted during final checks. The live-target screenshots and checks
precede that shutdown. Native lifecycle tests used their own ports and resources;
Windows native-window visual inspection is not claimed. Nikhom business/data
workflows were outside this preview-loading fix. Task-owned test resources were
closed when verification finished.
