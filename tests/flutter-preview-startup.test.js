const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'integrations', 'flutter-preview-startup.js'), 'utf8');

function runtime(url = 'http://127.0.0.1:3000/?__dpl_fresh=test', compileTarget = 'dartdevc') {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const warnings = [];
  const calls = [];
  const listeners = new Map();
  const window = { location: new URL(url), _flutter: { buildConfig: { builds: [{ compileTarget }] } } };
  const document = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
  };
  vm.runInNewContext(source, { window, document, URL, URLSearchParams, Reflect,
    Date: { now: () => now }, console: { warn: message => warnings.push(message) },
    setInterval: fn => { timers.set(++nextId, fn); return nextId; }, clearInterval: id => timers.delete(id),
  });
  const ready = () => {
    window.$dwdsInitialized = true;
    window.$dartReadyToRunMain = () => {};
    window.$dartRunMain = function (...args) { calls.push(args); this.$dartMainExecuted = true; return 'started'; };
    return window.$dartRunMain;
  };
  const advance = milliseconds => {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) {
      now += 100;
      for (const fn of [...timers.values()]) fn();
    }
  };
  return { window, ready, advance, calls, timers, warnings, listeners };
}

test('debug views cap script concurrency before SDK initialization and restore its plain property', () => {
  const r = runtime();
  const loader = r.window.$dartLoader = { loadConfig: null };
  r.listeners.get('load')({ target: { tagName: 'SCRIPT', src: '/ddc_module_loader.js' } });
  assert.equal(r.listeners.size, 0);
  const config = { maxRequestPoolSize: 1000 };
  loader.loadConfig = config;
  assert.equal(config.maxRequestPoolSize, 32);
  assert.equal(loader.loadConfig, config);
  assert.equal(Object.getOwnPropertyDescriptor(loader, 'loadConfig').writable, true);
  r.ready(); r.advance(1000);
  assert.equal(r.calls.length, 1);
  const timedOut = runtime(); const uninitialized = timedOut.window.$dartLoader = { loadConfig: null };
  timedOut.listeners.get('load')({ target: { tagName: 'SCRIPT', src: '/ddc_module_loader.js' } });
  timedOut.advance(30000);
  assert.equal(Object.getOwnPropertyDescriptor(uninitialized, 'loadConfig').value, null);
  assert.equal(timedOut.listeners.size, 0);
});

test('pool adaptation ignores unrelated scripts, unknown descriptors and release builds', () => {
  const r = runtime(); const loader = r.window.$dartLoader = { loadConfig: null };
  r.listeners.get('load')({ target: { tagName: 'SCRIPT', src: '/another.js' } });
  assert.equal(Object.getOwnPropertyDescriptor(loader, 'loadConfig').value, null);
  const small = { maxRequestPoolSize: 8 }; loader.loadConfig = small;
  r.listeners.get('load')({ target: { tagName: 'SCRIPT', src: '/ddc_module_loader.js' } });
  assert.equal(small.maxRequestPoolSize, 8);
  const locked = runtime(); locked.window.$dartLoader = {};
  Object.defineProperty(locked.window.$dartLoader, 'loadConfig', { value: null });
  locked.listeners.get('load')({ target: { tagName: 'SCRIPT', src: '/ddc_module_loader.js' } });
  locked.advance(30000); assert.equal(locked.listeners.size, 0);
  for (const url of ['http://localhost:3000/', 'https://example.com/?__dpl_fresh=test']) {
    assert.equal(runtime(url).listeners.size, 0);
  }
  assert.equal(runtime(undefined, 'dart2js').listeners.size, 0);
});

test('Flutter compatibility is opt-in, loopback-only and inactive in release builds', () => {
  for (const url of ['http://localhost:3000/', 'https://example.com/?__dpl_fresh=test']) {
    const r = runtime(url); r.ready(); r.advance(5000);
    assert.equal(r.calls.length, 0); assert.equal(r.timers.size, 0);
  }
  const release = runtime(undefined, 'dart2js'); release.ready(); release.advance(5000);
  assert.equal(release.calls.length, 0); assert.equal(release.timers.size, 0);
  for (const url of ['http://localhost:3000/?__dpl_fresh=test', 'http://[::1]:3000/?__dpl_fresh=test']) {
    const r = runtime(url); r.ready(); r.advance(1000); assert.equal(r.calls.length, 1);
  }
});

test('additional debug previews wait for loaded libraries, then start exactly once', () => {
  const r = runtime(); r.advance(5000);
  assert.equal(r.calls.length, 0);
  r.ready(); r.advance(700); assert.equal(r.calls.length, 0);
  r.advance(300); assert.equal(r.calls.length, 1); assert.equal(r.timers.size, 0);
  r.window.$dartRunMain('late debugger'); r.advance(5000);
  assert.equal(r.calls.length, 1, 'A delayed RunRequest must not runApp twice');
  r.window.$dartMainExecuted = false;
  assert.equal(r.window.$dartRunMain('SDK restart'), 'started');
  assert.deepEqual(r.calls[1], ['SDK restart']);
});

test('normal debugger startup keeps its original entrypoint and wins the grace period', () => {
  const r = runtime(); const original = r.ready();
  r.advance(500); original.call(r.window); r.advance(500);
  assert.equal(r.window.$dartRunMain, original); assert.equal(r.calls.length, 1);
  assert.equal(r.timers.size, 0);
});

test('unsupported debug runtimes stop polling and report bounded startup failure', () => {
  const r = runtime(); r.advance(30000); r.advance(5000);
  assert.equal(r.calls.length, 0); assert.equal(r.timers.size, 0);
  assert.equal(r.warnings.length, 1);
});

test('Flutter installer preserves custom bootstrap code and is idempotent', { skip: process.platform !== 'win32' }, t => {
  const logs = path.join(root, '.logs'); fs.mkdirSync(logs, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(logs, 'flutter-installer-'));
  t.after(() => {
    const absolute = path.resolve(fixture);
    assert.equal(path.dirname(absolute), logs);
    assert.ok(path.basename(absolute).startsWith('flutter-installer-'));
    fs.rmSync(absolute, { recursive: true, force: true });
  });
  const project = path.join(fixture, 'Project with spaces');
  const web = path.join(project, 'web'); fs.mkdirSync(web, { recursive: true });
  fs.writeFileSync(path.join(project, 'pubspec.yaml'), 'name: fixture\n');
  const bootstrap = path.join(web, 'flutter_bootstrap.js');
  const original = '{{flutter_js}}\r\n{{flutter_build_config}}\r\n// Preserve custom configuration and café\r\n_flutter.loader.load();\r\n';
  fs.writeFileSync(bootstrap, original);
  const backups = path.join(fixture, 'backups');
  const install = (useDefault = false) => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(root, 'scripts', 'Enable-FlutterPreview.ps1'), '-ProjectPath', project, ...(useDefault ? [] : ['-BackupDirectory', backups])],
  { windowsHide: true, encoding: 'utf8' });
  assert.equal(install().status, 0);
  assert.equal(install(true).status, 0, 'The default backup path must work under Windows PowerShell');
  const updated = fs.readFileSync(bootstrap, 'utf8');
  assert.ok(updated.includes('// Preserve custom configuration and café'));
  assert.equal(updated.split('_flutter.loader.load();').length, 2);
  assert.equal(fs.readFileSync(path.join(backups, fs.readdirSync(backups)[0]), 'utf8'), original);
  assert.equal(install().status, 0);
  assert.equal(fs.readFileSync(bootstrap, 'utf8'), updated);
  assert.equal(fs.readdirSync(backups).length, 1);
  fs.writeFileSync(bootstrap, updated.replace('// END DEVICE PREVIEW LAB STARTUP', '// Missing end marker'));
  const broken = fs.readFileSync(bootstrap);
  assert.notEqual(install().status, 0);
  assert.deepEqual(fs.readFileSync(bootstrap), broken, 'Malformed existing configuration must be left intact');
  fs.unlinkSync(bootstrap);
  assert.equal(install().status, 0);
  assert.ok(fs.readFileSync(bootstrap, 'utf8').includes('{{flutter_build_config}}'));
});
