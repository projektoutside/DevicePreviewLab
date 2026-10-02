# Device Preview Lab

Device Preview Lab is a standalone browser tool for visually testing any
running web app URL in four side-by-side device classes:

- Computer
- iPad / Tablet
- Galaxy S25-class
- iPhone Pro-class

It does not build, modify, or bundle the app it previews. It only loads the
target URL in iframe viewports.

The workspace fills the window without a main page scrollbar. Compact controls
leave more room for previews. Terminal history, long tab lists, board tiles, and
preview content scroll within their own panels; smaller windows can scroll the
device grid internally. Device frames scale to the available space.

Every initial load, URL submission, grid reload, and focused-device reload uses
a unique `__dpl_fresh` query value. This bypasses normal document-cache reuse
without changing the clean target URL saved by Device Preview Lab. Previews in
the visible mode load eagerly. Hidden views defer initial navigation until you
open them, avoiding unused app instances while restoring an All in One board.

## Tabs

Use `+ New tab` above the controls to create independent preview tabs. Every
tab keeps its own Target URL, orientations, zoom level, and All in One tiles.
Click a tab to switch, double-click a tab to rename it, and use `×` to close it
(at least one tab always remains). Tabs persist in localStorage.

## Local Server Detection

Device Preview Lab auto-scans for running local servers on startup:

- The Target URL field has a `Detect…` dropdown plus a `Scan` button. Picking
  a server fills the URL and immediately loads fresh previews.
- The All in One board has its own `Detect…` dropdown plus `Scan`. Picking a
  server fills the Server URL field so you only choose a device and add the tile.
- Both URL fields also accept typed URLs with autocomplete from detected servers.
- On Windows, the bundled server enumerates every TCP listener and verifies
  HTTP/HTTPS hosts on arbitrary ports, including IPv6 and locally bound network
  interfaces. Terminal Hall and both URL dropdowns use the same scanner.
- Debugging APIs, Dart tooling endpoints, WebSocket-only services, and other Lab
  instances are filtered by their responses. Real websites running in the same
  Dart/Node process remain available. Login-protected apps, APIs, redirects, and
  apps with a missing root route are retained instead of being rejected by status.
- Local HTTPS development certificates can be detected even when self-signed;
  displaying those pages still requires the browser to trust their certificate.
  Hosts requiring a custom virtual hostname or a specific route can be entered
  manually. The scanner does not fetch redirects to external websites.
- Scans share concurrent work, limit network concurrency and response size, and
  do not launch, stop, or change discovered processes. Static hosting without the
  local API has only a smaller browser-side common-port probe; full discovery
  requires the Windows app.

## All in One Mode

Use the `All in One` toggle for a free-form board instead of the four-device
grid:

- Add any running `http://` or `https://` server URL and choose its device
  frame (Computer, Tablet, Galaxy S25, or iPhone Pro).
- Drag a tile by its header to move it smoothly anywhere on the board.
- Existing and new tiles use one compact header row. Focus, Rotate, Reload, URL,
  Open and Remove use icons with tooltips and accessible names. Hover the server
  name for the full URL and device details. Narrow tiles automatically condense
  the viewport readout into a tooltip badge while keeping every action reachable.
- Drag the glowing corner handle to resize the tile. Pointer updates are grouped
  into animation frames, and the last size is saved even if dragging is cancelled.
  Focus the handle and use arrow keys to resize by 10 pixels, or Shift + arrows
  for 50-pixel steps.
- New tiles fit the available board. **Layout** zoom scales the entire board;
  **Fit board** brings the saved tile bounds into view. Dragging and resizing use
  board coordinates at every zoom level. Large boards scroll inside the panel.
- Every device box and board tile has **− / percentage / +** preview zoom controls.
  Clicking the percentage resets that zoom to 100%. **All previews** adjusts
  every device-grid preview together; individual percentages multiply that
  setting. Enlarged content scrolls inside its box. Zoom never changes the device
  viewport dimensions or reloads the app being previewed.
- Each tile has its own Focus, Rotate (when supported), Reload, URL, Open, and Remove
  controls. Clicking the preview also opens fullscreen focus mode.
- **URL** changes an existing tile's target or device using the form above. Pick
  a detected server or paste a URL and click **Save tile URL**; position, size and
  zoom are retained. **Open** checks the target directly in a separate browser tab.
  If it is blank there too, the target application needs its own startup diagnosis.
- Board layout, local preview zoom and whole-board zoom persist per tab.

## Terminal Hall

Click **Terminal Hall** beside your preview tabs to open the local workstation
inside the main preview area. Its session tabs switch instantly without stopping
your shells. You can return to a device preview and keep terminals running.

- **+ New terminal** opens the native Windows Explorer folder picker. Browse to
  your project and click **Open terminal here** to start interactive PowerShell
  in that exact folder. The new session comes to the front automatically.
- Run commands, development servers, interactive tools, Ctrl+C, and clipboard
  paste directly in the terminal. The display fits the available panel size,
  keeping safety space below the last row. **Latest output** returns to the
  newest output and command prompt after browsing earlier lines.
- Running local HTTP servers are detected across listening ports, including
  HTTPS and ports outside the usual development-port list. Their tabs show the
  website title when available, a live preview, and process details. Detection
  refreshes every 15 seconds while Hall is visible.
- An existing external terminal's console cannot be transferred into this app;
  its server tab is a preview, not a copy of its output or keyboard control.
  Start future servers from a Hall terminal to control their full console here.
- **Close terminal** stops that session and its attached commands. Closing the
  native Lab app stops all sessions it started, including their server processes.
  External servers and terminals remain yours to manage.
- Reloading the page reconnects to running sessions with bounded recent output.
  Sessions end when the Lab closes; commands are never rerun automatically.

Terminal Hall uses a local-only authenticated WebSocket connection. It supports
up to 12 sessions, retains 256 KiB of recent output per session on the server,
and limits terminal scrollback to 3,000 lines. Slow connections reconnect rather
than accumulating unlimited output in memory. Terminal libraries load only
when Hall is opened. The website continues to support device previews; terminals
require the local Windows app.

## Start The Tool

### Online

This app can run as a static website on GitHub Pages. Open the Pages URL, then
paste any public `http://` or `https://` app URL into the Target URL field.

```text
https://projektoutside.github.io/DevicePreviewLab/
```

### Local

Double-click for the full one-click start (updated for tabs, All in One board,
and local-server detection):

```text
Start-DevicePreviewLab.exe
```

The native launcher runs without creating a console window. PowerShell and the
preview server stay hidden in the background. Closing the app window automatically
stops the server, PowerShell, and native launcher. A Windows job object also stops
owned child processes if the launcher unexpectedly exits. Your other browser windows
and servers are separate from this process group.

`Start-DevicePreviewLab.cmd` remains a compatibility entry point, but Windows may
briefly display its command window. Use the `.exe` directly for seamless startup.
For a fresh source checkout, run `npm ci`, then build the launcher and native
folder picker with `Build-DevicePreviewLabLauncher.ps1`. The build uses the
Windows .NET Framework compiler. Keep both `.exe` files beside the app files.

The launcher verifies `server.js`, `index.html`, `app.js`, and
`styles.css` are present, waits for `/health`, verifies the
`/api/local-servers` scan endpoint, then opens Device Preview Lab in its own
Chrome app window (or Edge when Chrome is unavailable). Chrome is preferred to
avoid Edge's automatic Windows-account sign-in and sync prompt. The startup URLs show the
Preview URL, Target URL, Scan API URL, and log directory, including a notice
when the requested port was busy and the next free port was used. Closing that
app window automatically stops the server and hidden launcher. The launcher uses
an isolated browser profile in `.browser-profiles/<browser>-<port>` so saved tabs and boards
survive closing and reopening the app. Profiles are separate from your normal
browser and excluded from Git. Returning to the same port restores its workspace;
a busy-port fallback uses a separate workspace. Browser caches also persist, while
every preview navigation continues to use a unique cache-bypass URL. Passing
`-TargetUrl` explicitly replaces the active tab's target; ordinary startup preserves it.
Arguments such as `-Port 9090` and `-TargetUrl "http://127.0.0.1:3000"` also work
with the `.exe`.

Or run from PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\Start-DevicePreviewLab.ps1
```

Use `-NoOpen` only when you intentionally want to run the server without the
managed browser window; that mode remains attached until you press Ctrl+C.

The default preview URL is:

```text
http://127.0.0.1:9090/
```

## Preview A Specific App

Start the app you want to inspect first, then pass its URL:

```powershell
powershell -ExecutionPolicy Bypass -File .\Start-DevicePreviewLab.ps1 -TargetUrl "http://127.0.0.1:5000"
```

You can also paste a new `http://` or `https://` URL into the Target URL field
inside the preview page.

## Options

```powershell
.\Start-DevicePreviewLab.ps1 -TargetUrl "http://127.0.0.1:3000" -Port 9090
.\Start-DevicePreviewLab.ps1 -NoOpen
```

If the requested preview port is already busy, the launcher uses the next
available port and prints the actual Preview URL.

## Direct Node Start

If you only want to start the static preview server:

```powershell
$env:PORT = "9090"
node .\server.js
```

Then open:

```text
http://127.0.0.1:9090
```

## Notes

- This is a visual layout tool, not a full device emulator.
- The app being previewed must already be running or publicly reachable.
- Some websites block iframe embedding with browser security headers; those
  sites cannot be forced to render inside the preview frames.
- A target app with its own cache-first service worker can still choose to serve
  cached assets. Browser same-origin protections prevent Device Preview Lab
  from deleting another site's service worker or storage.
- The local app requires Node.js and the packages pinned in `package-lock.json`.
  Terminal Hall uses node-pty, xterm.js, its fit addon, and ws. No remote terminal
  service or CDN is used. Windows 10 1809 or later is required for ConPTY.

## Flutter debug previews that stay white

`flutter run -d chrome` can leave additional browser tabs and embedded previews
waiting for a debugger startup signal, even after every Dart script loads. Large
debug builds can also exhaust Chrome's resources when four previews each enqueue
hundreds of scripts simultaneously.

Enable the scoped compatibility helper in the Flutter project being previewed:

```powershell
.\scripts\Enable-FlutterPreview.ps1 -ProjectPath "C:\path\to\FlutterProject"
```

The installer backs up the existing `web/flutter_bootstrap.js`, preserves custom
code, and updates only its own marked block on subsequent runs. Custom loader
calls that cannot be safely located are left unchanged. Refresh the target using
the Lab's Reload button after installation.

The helper applies only to loopback debug pages opened with the Lab's preview
marker. It caps DDC script concurrency at 32 and starts the loaded app if the
debugger does not start it. Late debugger signals cannot start a second app.
Normal unmarked browsing and release builds retain their original startup. It
does not clear application storage or change browser security settings.

For the explicitly installed, running Nikhom Flutter host, the additional live
browser check is `tests/flutter-live-browser-review.js`. It uses an isolated Lab
workspace and verifies board, grid, Terminal Hall, reload, Open, zoom and resizing.

## Regression checks

Run the dependency-free state and server checks:

```powershell
npm test
npm run check
npm run lint
.\tests\native-launcher.test.ps1
```

For the browser checks, start the preview server on port 19111, then run:

```powershell
npx --yes --package @playwright/cli playwright-cli -s=dpl-review open http://127.0.0.1:19111/ --browser chrome
npx --yes --package @playwright/cli playwright-cli -s=dpl-review run-code --filename tests/browser-review.js
npx --yes --package @playwright/cli playwright-cli -s=dpl-review run-code --filename tests/terminal-browser-review.js
npx --yes --package @playwright/cli playwright-cli -s=dpl-review run-code --filename tests/layout-browser-review.js
npx --yes --package @playwright/cli playwright-cli -s=dpl-review run-code --filename tests/zoom-browser-review.js
npx --yes --package @playwright/cli playwright-cli -s=dpl-review close
```

The browser checks use an isolated session and fixture URLs. They replace that
session's saved workspace, not your managed app's workspace.

`npm run check` checks JavaScript syntax. `npm run lint` applies ESLint's recommended
rules with zero warnings allowed. `npm run build` builds both Windows executables with compiler
warnings treated as errors. To validate while the launcher is running, use
`Build-DevicePreviewLabLauncher.ps1 -OutputPath .logs\validated.exe` and
`tests\native-launcher.test.ps1 -LauncherPath .logs\validated.exe`.

Run `node tests/native-workstation-check.js` to verify the actual native app,
interactive terminal, command child, and server cleanup on browser exit and
forced launcher exit. This Windows check opens and closes its own app windows.
