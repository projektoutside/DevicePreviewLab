# Device Preview Lab

Device Preview Lab is a standalone browser tool for visually testing any
running web app URL in four side-by-side device classes:

- Computer
- iPad / Tablet
- Galaxy S25-class
- iPhone Pro-class

It does not build, modify, or bundle the app it previews. It only loads the
target URL in iframe viewports.

## Start The Tool

### Online

This app can run as a static website on GitHub Pages. Open the Pages URL, then
paste any public `http://` or `https://` app URL into the Target URL field.

```text
https://projektoutside.github.io/DevicePreviewLab/
```

### Local

Double-click:

```text
Start-DevicePreviewLab.cmd
```

Or run from PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\Start-DevicePreviewLab.ps1
```

The default preview URL is:

```text
http://127.0.0.1:9090/?target=http%3A%2F%2F127.0.0.1%3A8080%2F
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
- The preview tool uses Node.js built-in modules only and has no npm install
  step.
