async (page) => {
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
    await page.waitForFunction(id => {
      const pane = document.querySelector(`#panel-${id}`);
      return pane?.querySelector('.xterm-screen')?.textContent.includes('HALL_RENDERED');
    }, first.id);
    check(true, 'Shell output must appear on screen');
    await page.locator(`#tab-${second.id}`).click();
    check(!await page.locator(`#panel-${first.id}`).isVisible(), 'Switching must hide the previous terminal');
    check(await page.locator(`#panel-${second.id}`).isVisible(), 'Switching must show the selected terminal');
    await page.locator('#tab-list .tab-item__label').first().click();
    check(!await page.locator('#terminal-hall').isVisible(), 'Preview tabs must exit Hall');
    check(await page.locator('#device-grid').isVisible(), 'Preview grid must restore');
    await page.getByRole('button', { name: 'Terminal Hall', exact: true }).click();
    await page.locator(`#tab-${first.id}`).click();
    check(await page.locator(`#panel-${first.id} .xterm-screen`).textContent().then(text => text.includes('HALL_RENDERED')), 'Output must survive switching to previews');
    await page.setViewportSize({ width: 390, height: 844 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Hall must fit a narrow screen');
    await page.setViewportSize({ width: 1500, height: 980 });
    await page.screenshot({ path: 'output/playwright/terminal-hall.png' });
    await page.reload();
    await page.getByRole('button', { name: 'Terminal Hall', exact: true }).click();
    await page.locator(`#tab-${first.id}`).click();
    await page.waitForFunction(id => document.querySelector(`#panel-${id} .xterm-screen`)?.textContent.includes('HALL_RENDERED'), first.id);
    check(true, 'Reload must reconnect to the same terminal and replay output');
    await page.locator(`#panel-${first.id}`).getByRole('button', { name: 'Close terminal' }).click();
    await page.locator(`#tab-${first.id}`).waitFor({ state: 'detached' });
    check(true, 'Close terminal must remove its tab');
    return { checks };
  } finally {
    for (const session of created) await page.request.post(`${origin}/api/terminal/close`, { headers, data: { id: session.id } });
  }
}
