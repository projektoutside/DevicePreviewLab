(() => {
  'use strict';
  const panel = document.querySelector('#terminal-hall');
  const tabs = document.querySelector('#terminal-tabs');
  const panels = document.querySelector('#terminal-panels');
  const empty = document.querySelector('#terminal-empty');
  const status = document.querySelector('#terminal-status');
  const add = document.querySelector('#terminal-add');
  const refresh = document.querySelector('#terminal-refresh');
  const views = new Map();
  let activeId = null;
  let token = null;
  let socket = null;
  let reconnectTimer = null;
  let scanTimer = null;
  let connecting = null;
  let libraries = null;
  let scanning = false;
  let stopped = false;
  let picking = false;

  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.dataset.state = error ? 'error' : 'success';
  };

  async function api(operation, body) {
    const response = await fetch(`/api/terminal/${operation}`, {
      method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
      headers: { 'X-Terminal-Token': token || '', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(operation === 'choose-folder' ? 310000 : 25000),
    });
    if (response.status === 404) throw new Error('Terminal Hall needs the updated local server. Close and reopen the Lab using its updated .exe. Device previews still work on the website.');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Terminal request failed.');
    return data;
  }

  function loadLibraries() {
    if (!libraries) libraries = (async () => {
      const style = document.createElement('link');
      style.rel = 'stylesheet'; style.href = '/vendor/xterm.css';
      await new Promise((resolve, reject) => {
        style.onload = resolve;
        style.onerror = () => { style.remove(); reject(new Error('Terminal styles could not load. Try again.')); };
        document.head.appendChild(style);
      });
      for (const source of ['/vendor/xterm.js', '/vendor/addon-fit.js']) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script'); script.src = source;
          script.onload = resolve;
          script.onerror = () => { script.remove(); reject(new Error('Terminal display could not load. Check npm ci and try again.')); };
          document.head.appendChild(script);
        });
      }
    })().catch(error => { libraries = null; throw error; });
    return libraries;
  }

  function send(message) {
    if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(message)); return true; }
    return false;
  }

  function fit(view) {
    if (!view.terminal || panel.hidden || view.element.hidden || view.fitFrame) return;
    view.fitFrame = requestAnimationFrame(() => {
      view.fitFrame = null;
      if (!views.has(view.id) || panel.hidden || view.element.hidden) return;
      view.fit.fit();
    });
  }

  function select(id, focus = true) {
    activeId = id;
    for (const view of views.values()) {
      view.element.hidden = view.id !== activeId;
      view.button.setAttribute('aria-selected', String(view.id === activeId));
      view.button.tabIndex = view.id === activeId ? 0 : -1;
    }
    empty.hidden = views.size > 0;
    const view = views.get(id);
    if (!view) return;
    if (view.server && !view.frame.src) view.frame.src = `${view.server.url}?__dpl_fresh=${Date.now()}`;
    requestAnimationFrame(() => { fit(view); if (focus && !panel.hidden) view.terminal?.focus(); });
  }

  function createView(id, label) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'terminal-tab'; button.setAttribute('role', 'tab');
    button.id = `tab-${id}`; button.setAttribute('aria-controls', `panel-${id}`);
    button.textContent = label;
    button.addEventListener('click', () => select(id));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const ids = [...views.keys()]; const index = ids.indexOf(id);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
      select(ids[next], false); views.get(ids[next]).button.focus();
    });
    tabs.appendChild(button);
    const element = document.createElement('section');
    element.id = `panel-${id}`; element.className = 'terminal-pane'; element.hidden = true;
    element.setAttribute('role', 'tabpanel'); element.setAttribute('aria-labelledby', button.id);
    panels.appendChild(element);
    const view = { id, button, element, seq: 0 };
    views.set(id, view);
    return view;
  }

  function removeView(view) {
    if (view.fitFrame) cancelAnimationFrame(view.fitFrame);
    view.observer?.disconnect(); view.terminal?.dispose();
    view.frame?.setAttribute('src', 'about:blank');
    view.button.remove(); view.element.remove(); views.delete(view.id);
  }

  function syncSessions(sessions) {
    const ids = new Set(sessions.map(session => session.id));
    for (const view of [...views.values()]) if (view.session && !ids.has(view.id)) removeView(view);
    for (const session of sessions) {
      let view = views.get(session.id);
      if (!view) {
        view = createView(session.id, session.name);
        const toolbar = document.createElement('header'); toolbar.className = 'terminal-pane__toolbar';
        const title = document.createElement('span'); title.className = 'terminal-path';
        const close = document.createElement('button'); close.className = 'button button--small';
        close.type = 'button'; close.textContent = 'Close terminal';
        close.title = 'Stop this terminal and its running commands';
        close.addEventListener('click', async () => {
          close.disabled = true;
          try { await api('close', { id: session.id }); }
          catch (error) { setStatus(error.message, true); close.disabled = false; }
        });
        const latest = document.createElement('button'); latest.className = 'button button--small';
        latest.type = 'button'; latest.textContent = 'Latest output';
        latest.title = 'Return to the latest output and command prompt';
        latest.addEventListener('click', () => { view.terminal.scrollToBottom(); view.terminal.focus(); });
        toolbar.append(title, latest, close);
        const host = document.createElement('div'); host.className = 'terminal-screen';
        // FitAddon measures its direct parent. Keep the safety padding outside that box.
        const mount = document.createElement('div'); mount.className = 'terminal-mount'; host.appendChild(mount);
        view.element.append(toolbar, host); view.title = title;
        view.terminal = new Terminal({ cursorBlink: true, fontSize: 14, fontFamily: 'Consolas, "Cascadia Code", monospace',
          scrollback: 3000, theme: { background: '#080e17', foreground: '#d7e1ef', cursor: '#58c5cd', selectionBackground: '#31516b' } });
        view.fit = new FitAddon.FitAddon(); view.terminal.loadAddon(view.fit);
        view.terminal.open(mount);
        view.terminal.onData(data => {
          for (let start = 0; start < data.length;) {
            let end = Math.min(start + 4096, data.length);
            // Keep surrogate pairs intact when splitting large clipboard pastes.
            if (end < data.length && data.charCodeAt(end - 1) >= 0xd800 && data.charCodeAt(end - 1) <= 0xdbff) end--;
            if (!send({ type: 'input', id: session.id, data: data.slice(start, end) })) {
              setStatus('Connection lost. Reconnecting; input was not sent.', true); break;
            }
            start = end;
          }
        });
        view.terminal.onResize(({ cols, rows }) => send({ type: 'resize', id: session.id, cols, rows }));
        view.observer = new ResizeObserver(() => fit(view)); view.observer.observe(host);
        document.fonts.ready.then(() => fit(view));
      }
      view.session = session;
      view.button.textContent = `${session.name} · ${session.status === 'running' ? 'PowerShell' : 'Exited'}`;
      view.button.title = session.cwd;
      view.title.textContent = `${session.cwd}   ·   ${session.status === 'running' ? `PID ${session.pid}` : `Exited (${session.exitCode})`}`;
      view.terminal.options.disableStdin = session.status !== 'running';
      send({ type: 'replay', id: session.id, after: view.seq });
    }
    if (!views.has(activeId)) activeId = views.keys().next().value || null;
    select(activeId, false);
  }

  async function scan() {
    if (scanning || !token) return;
    scanning = true; refresh.disabled = true;
    try {
      const { servers } = await api('servers');
      const ids = new Set(servers.map(server => `server-${server.port}`));
      for (const view of [...views.values()]) if (view.server && !ids.has(view.id)) removeView(view);
      for (const server of servers) {
        const id = `server-${server.port}`;
        let view = views.get(id);
        if (!view) {
          view = createView(id, `Server :${server.port}`);
          const info = document.createElement('header'); info.className = 'terminal-pane__toolbar';
          view.title = document.createElement('span'); info.appendChild(view.title);
          const reload = document.createElement('button'); reload.type = 'button'; reload.className = 'button button--small'; reload.textContent = 'Reload preview';
          reload.addEventListener('click', () => { view.frame.src = `${view.server.url}?__dpl_fresh=${Date.now()}`; });
          info.appendChild(reload);
          const note = document.createElement('p'); note.className = 'terminal-server-note';
          note.textContent = 'Existing server · live preview. Its console input and output remain in the terminal where it was started. Use + New terminal to start an interactive session here.';
          view.frame = document.createElement('iframe'); view.frame.title = `Server on port ${server.port}`;
          view.frame.referrerPolicy = 'no-referrer';
          view.frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads');
          view.element.append(info, note, view.frame);
        } else if (view.server.pid !== server.pid) view.frame.removeAttribute('src');
        view.server = server;
        view.button.textContent = `${server.processName || 'Server'} :${server.port}`;
        view.title.textContent = `${server.url}   ·   ${server.processName || 'HTTP server'}${server.pid ? `   ·   PID ${server.pid}` : ''}`;
      }
      if (!views.has(activeId)) activeId = views.keys().next().value || null;
      select(activeId, false);
    } catch (error) { setStatus(error.message, true); }
    finally { scanning = false; refresh.disabled = false; }
  }

  async function connect() {
    if (connecting || socket?.readyState === WebSocket.OPEN || stopped) return connecting;
    connecting = (async () => {
      add.disabled = true;
      const bootstrap = await api('bootstrap'); token = bootstrap.token;
      await loadLibraries();
      if (stopped) return;
      socket = new WebSocket(`ws://${location.host}/api/terminal/socket`);
      socket.onopen = () => send({ type: 'hello', token });
      socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === 'sessions') {
          syncSessions(message.sessions); add.disabled = picking;
          setStatus('Connected · terminals stay active as you switch previews.');
        } else if (message.type === 'output') {
          const view = views.get(message.id);
          if (view?.terminal && message.seq > view.seq) {
            view.terminal.write(message.data, () => send({ type: 'ack', id: message.id, seq: message.seq }));
            view.seq = message.seq;
          }
        } else if (message.type === 'gap') {
          const view = views.get(message.id);
          view?.terminal.reset(); view?.terminal.write('\r\n[Earlier output was trimmed while disconnected.]\r\n');
        }
      };
      socket.onclose = () => {
        socket = null; add.disabled = true;
        if (!stopped) {
          setStatus('Disconnected · reconnecting to your sessions…', true);
          reconnectTimer = setTimeout(() => connect().catch(error => setStatus(error.message, true)), 1500);
        }
      };
      socket.onerror = () => setStatus('Terminal connection interrupted.', true);
      await scan();
    })().catch(error => { setStatus(error.message, true); throw error; }).finally(() => { connecting = null; });
    return connecting;
  }

  add.addEventListener('click', async () => {
    if (picking) return;
    picking = true;
    add.disabled = true; setStatus('Choose a project folder in the Windows folder picker…');
    try {
      const { session } = await api('choose-folder', {});
      if (session) {
        if (!views.has(session.id)) syncSessions([...views.values()].filter(view => view.session).map(view => view.session).concat(session));
        select(session.id);
        setStatus(`PowerShell opened in ${session.cwd}.`);
      } else setStatus('Folder selection cancelled.');
    } catch (error) { setStatus(error.message, true); }
    finally { picking = false; add.disabled = socket?.readyState !== WebSocket.OPEN; }
  });
  refresh.addEventListener('click', () => connect().then(scan).catch(error => setStatus(error.message, true)));
  window.TerminalHall = {
    show() {
      panel.hidden = false;
      connect().then(() => { select(activeId, false); scan(); }).catch(() => {});
      clearInterval(scanTimer); scanTimer = setInterval(scan, 15000);
    },
    hide() { panel.hidden = true; clearInterval(scanTimer); },
  };
  window.addEventListener('pagehide', () => {
    stopped = true; clearInterval(scanTimer); clearTimeout(reconnectTimer); socket?.close();
    for (const view of [...views.values()]) removeView(view);
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      stopped = false;
      if (!panel.hidden) window.TerminalHall.show();
    }
  });
})();
