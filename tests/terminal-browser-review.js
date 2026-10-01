async (page) => {
  page.setDefaultTimeout(15000);
  const origin = new URL(page.url()).origin;
  const check = (condition, message) => { if (!condition) throw new Error(message); checks++; };
  let checks = 0;
  await page.goto(origin);
  await page.getByRole('button', { name: 'Device grid', exact: true }).click();
  await page.getByRole('button', { name: 'Terminal Hall', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#terminal-status').textContent.startsWith('Connected'));
  check(!await page.locator('#device-grid').isVisible(), 'Hall must replace the preview grid');
  check(await page.locator('#terminal-hall').isVisible(), 'Hall must be visible');
  const bootstrap = await (await page.request.get(`${origin}/api/terminal/bootstrap`)).json();
  const headers = { 'X-Terminal-Token': bootstrap.token };
  const created = [];
  let stage = 'create terminal sessions';
  try {
    for (let i = 0; i < 2; i++) {
      const response = await page.request.post(`${origin}/api/terminal/sessions`, { headers, data: { cwd: bootstrap.defaultFolder } });
      if (response.status() !== 201) throw new Error(await response.text());
      created.push((await response.json()).session);
    }
    const first = created[0]; const second = created[1];
    await page.locator(`#tab-${first.id}`).click();
    check(await page.locator(`#panel-${first.id} .xterm`).isVisible(), 'First interactive terminal must render');
    const messages = await page.evaluate(async ({ token, id }) => {
      const socket = new WebSocket(`ws://${location.host}/api/terminal/socket`);
      return await new Promise((resolve, reject) => {
        let output = '';
        const timeout = setTimeout(() => { socket.close(); reject(new Error('Shell output timed out')); }, 15000);
        socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', token }));
        socket.onmessage = event => {
          const message = JSON.parse(event.data);
          if (message.type === 'sessions') {
            socket.send(JSON.stringify({ type: 'replay', id, after: 0 }));
            socket.send(JSON.stringify({ type: 'input', id, data: "Write-Output ('HALL_' + 'RENDERED')\r" }));
          }
          if (message.type === 'output') {
            output += message.data;
            if (output.includes('HALL_RENDERED')) { clearTimeout(timeout); socket.close(); resolve(true); }
          }
        };
      });
    }, { token: bootstrap.token, id: first.id });
    check(messages, 'Real shell must execute the rendering probe');
    stage = 'render the shell probe';
    await page.waitForFunction(id => {
      const pane = document.querySelector(`#panel-${id}`);
      return pane?.querySelector('.xterm-screen')?.textContent.includes('HALL_RENDERED');
    }, first.id);
    check(true, 'Shell output must appear on screen');
    const pane = page.locator(`#panel-${first.id}`);
    stage = 'render long terminal output';
    await pane.getByRole('button', { name: 'Latest output', exact: true }).click();
    await page.keyboard.type("1..120 | ForEach-Object { Write-Output ('SAFETY_ROW_' + $_) }; Write-Output ('BOTTOM_' + 'VISIBLE')");
    await page.keyboard.press('Enter');
    await page.waitForFunction(id => document.querySelector(`#panel-${id} .xterm-screen`)?.textContent.includes('BOTTOM_VISIBLE'), first.id);
    for (const size of [{ width: 1831, height: 758 }, { width: 1500, height: 980 }, { width: 1024, height: 640 }, { width: 390, height: 844 }, { width: 780, height: 360 }]) {
      stage = `fit terminal at ${size.width}x${size.height}`;
      await page.setViewportSize(size);
      await page.waitForFunction(id => {
        const host = document.querySelector(`#panel-${id} .terminal-screen`);
        const screen = host?.querySelector('.xterm-screen');
        if (!screen) return false;
        const h = host.getBoundingClientRect(); const s = screen.getBoundingClientRect();
        return s.bottom <= h.bottom - 15.5 && s.right <= h.right - 9.5;
      }, first.id);
      check(true, `Complete terminal rows must stay inside safety padding at ${size.width}x${size.height}`);
    }
    await page.setViewportSize({ width: 1500, height: 980 });
    await page.evaluate(() => { document.body.style.zoom = '1.25'; });
    stage = 'fit terminal at enlarged zoom';
    await page.waitForFunction(id => {
      const host = document.querySelector(`#panel-${id} .terminal-screen`).getBoundingClientRect();
      const screen = document.querySelector(`#panel-${id} .xterm-screen`).getBoundingClientRect();
      return screen.bottom <= host.bottom - 19.5;
    }, first.id);
    check(true, 'Bottom safety padding must survive enlarged UI zoom');
    await page.evaluate(() => { document.body.style.zoom = ''; });
    await pane.getByRole('button', { name: 'Latest output', exact: true }).click();
    // ConPTY redraws the prompt asynchronously after the last resize.
    await page.waitForTimeout(500);
    await pane.locator('.xterm-screen').hover();
    // xterm normalizes each wheel event to a few rows, regardless of its magnitude.
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(20);
    }
    stage = 'scroll back to earlier output';
    await page.waitForFunction(id => !document.querySelector(`#panel-${id} .xterm-screen`)?.textContent.includes('BOTTOM_VISIBLE'), first.id);
    check(true, 'Earlier terminal output must remain accessible');
    await pane.getByRole('button', { name: 'Latest output', exact: true }).click();
    stage = 'return to latest output';
    await page.waitForFunction(id => document.querySelector(`#panel-${id} .xterm-screen`)?.textContent.includes('BOTTOM_VISIBLE'), first.id);
    check(true, 'Latest output must restore the last output and prompt');
    await page.locator(`#tab-${second.id}`).click();
    stage = 'switch previews and reconnect';
    check(!await page.locator(`#panel-${first.id}`).isVisible(), 'Switching must hide the previous terminal');
    check(await page.locator(`#panel-${second.id}`).isVisible(), 'Switching must show the selected terminal');
    await page.locator('#tab-list .tab-item__label').first().click();
    check(!await page.locator('#terminal-hall').isVisible(), 'Preview tabs must exit Hall');
    check(await page.locator('#device-grid').isVisible(), 'Preview grid must restore');
    await page.getByRole('button', { name: 'Terminal Hall', exact: true }).click();
    await page.locator(`#tab-${first.id}`).click();
    check(await page.locator(`#panel-${first.id} .xterm-screen`).textContent().then(text => text.includes('BOTTOM_VISIBLE')), 'Latest output must survive switching to previews');
    await page.setViewportSize({ width: 390, height: 844 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Hall must fit a narrow screen');
    await page.setViewportSize({ width: 1500, height: 980 });
    await pane.getByRole('button', { name: 'Latest output', exact: true }).click();
    await page.keyboard.type("1..100 | ForEach-Object { Write-Output ('SAFETY_FINAL_ROW_' + $_) }; Write-Output ('BOTTOM_FINAL_' + 'VISIBLE')");
    await page.keyboard.press('Enter');
    await page.waitForFunction(id => {
      const host = document.querySelector(`#panel-${id} .terminal-screen`);
      const rows = host.querySelectorAll('.xterm-rows > div');
      const last = rows[rows.length - 1];
      return host.textContent.includes('BOTTOM_FINAL_VISIBLE') && last?.textContent.startsWith('PS ')
        && last.getBoundingClientRect().bottom <= host.getBoundingClientRect().bottom - 15.5;
    }, first.id);
    check(true, 'The complete command prompt must remain visible on the bottom row after long output');
    await pane.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'output/playwright/terminal-hall.png' });
    await pane.screenshot({ path: 'output/playwright/terminal-bottom-safety.png' });
    await page.reload();
    await page.getByRole('button', { name: 'Terminal Hall', exact: true }).click();
    await page.locator(`#tab-${first.id}`).click();
    await page.waitForFunction(id => document.querySelector(`#panel-${id} .xterm-screen`)?.textContent.includes('BOTTOM_FINAL_VISIBLE'), first.id);
    check(true, 'Reload must reconnect to the same terminal and replay output');
    await page.locator(`#panel-${first.id}`).getByRole('button', { name: 'Close terminal' }).click();
    await page.locator(`#tab-${first.id}`).waitFor({ state: 'detached' });
    check(true, 'Close terminal must remove its tab');
    return { checks };
  } catch (error) {
    const rows = await page.locator('.terminal-pane:not([hidden]) .xterm-rows > div').allTextContents();
    throw new Error(`${stage}: ${error.message}; rendered rows: ${JSON.stringify({ first: rows.slice(0, 3), last: rows.slice(-4), count: rows.length })}`, { cause: error });
  } finally {
    for (const session of created) await page.request.post(`${origin}/api/terminal/close`, { headers, data: { id: session.id } });
  }
}
