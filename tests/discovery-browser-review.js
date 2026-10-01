async page => {
  page.setDefaultTimeout(25000);
  const origin = new URL(page.url()).origin;
  let checks = 0;
  const check = (condition, message) => { if (!condition) throw new Error(message); checks++; };
  await page.goto(origin);
  const scan = await (await page.request.get(`${origin}/api/local-servers`)).json();
  const fixtures = scan.servers.filter(server => server.title?.startsWith('Discovery '));
  check(fixtures.length === 3, 'IPv4, IPv6 and protected fixtures must be detected; debugger fixture must be filtered');
  check(fixtures.filter(server => server.title !== 'Discovery protected fixture').every(server => server.port === fixtures.find(entry => entry.title === 'Discovery IPv4 fixture').port), 'Different apps sharing one port must both be represented');
  await page.getByRole('button', { name: 'Device grid', exact: true }).click();
  await page.locator('#target-scan').click();
  await page.waitForFunction(() => !document.querySelector('#target-scan').disabled);
  const dropdown = await page.locator('#target-pick option').evaluateAll(options => options.map(option => option.value));
  check(fixtures.every(server => dropdown.includes(server.url)), 'URL dropdown must include arbitrary ports and IPv6');
  await page.getByRole('button', { name: 'Terminal Hall', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('#terminal-tabs [role=tab]')].filter(tab => tab.textContent.startsWith('Discovery ')).length === 3);
  await page.waitForFunction(() => !document.querySelector('#terminal-refresh').disabled);
  const labels = await page.locator('#terminal-tabs [role=tab]').allTextContents();
  check(!labels.some(label => label.includes('Discovery debugger fixture')), 'Debugger ports must not become Hall tabs');
  for (const server of fixtures) {
    const tab = page.getByRole('tab', { name: `${server.title} :${server.port}`, exact: true });
    check(await tab.count() === 1, 'Each discovered host must have a unique named tab');
    await tab.click();
    const control = await tab.getAttribute('aria-controls');
    const pane = page.locator('[role=tabpanel]').filter({ has: page.locator(`iframe[title="Server on port ${server.port}"]`) });
    const frame = page.locator(`[id="${control}"] iframe`);
    check((await frame.getAttribute('src')).startsWith(server.url), 'Host selection must load the exact IPv4/IPv6 endpoint');
    await page.frameLocator(`[id="${control}"] iframe`).getByRole('heading', { name: server.title, exact: true }).waitFor();
    check(true, 'Discovered application must render its actual page');
    check(await pane.count() >= 1, 'Discovered frame must remain in the Hall');
  }
  await page.screenshot({ path: 'output/playwright/verified-local-hosts.png' });
  await page.getByRole('button', { name: 'Refresh servers', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#terminal-refresh').disabled);
  check((await page.locator('#terminal-tabs [role=tab]').allTextContents()).length === labels.length, 'Refresh must preserve hosts without duplicate tabs');
  return { checks, fixtures: fixtures.map(server => ({ title: server.title, url: server.url })) };
}
