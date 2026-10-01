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
