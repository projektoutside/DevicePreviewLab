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
