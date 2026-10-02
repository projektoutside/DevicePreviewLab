async (page) => {
  const origin = new URL(page.url()).origin;
  const fixture = 'http://127.0.0.1:19112/';
  let checks = 0;
  const check = (condition, message) => { if (!condition) throw new Error(message); checks++; };
  await page.route(`${fixture}**`, route => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><title>Compact header fixture</title><button onclick="this.textContent=\'Clicked\'">Working target</button>' }));
  await page.goto(origin);
  await page.setViewportSize({ width: 1500, height: 980 });
  await page.evaluate(url => localStorage.setItem('device-preview.workspace.v2', JSON.stringify({
    activeTabId: 'compact', mode: 'board', tabs: [{ id: 'compact', name: 'Compact headers', targetUrl: url, boardTiles: [
      { id: 'phone', name: '127.0.0.1:53856', url, deviceId: 'galaxy-s25', x: 24, y: 24, width: 540, height: 650 },
      { id: 'desktop', name: 'A very long local server title with a route and query', url: `${url}desktop`, deviceId: 'computer', x: 600, y: 24, width: 750, height: 650 },
    ] }],
  })), fixture);
  await page.reload();
  const tile = page.locator('.board-tile').first();
  await tile.frameLocator('iframe').getByRole('button', { name: 'Working target' }).click();
  const source = await tile.locator('iframe').getAttribute('src');
  const fits = locator => locator.evaluate(el => {
    const header = el.querySelector('.board-tile__header').getBoundingClientRect();
    const controls = [...el.querySelectorAll('.board-tile__header button')].filter(button => !button.hidden);
    return header.height <= 28 && controls.every(button => {
      const box = button.getBoundingClientRect();
      return box.left >= header.left && box.right <= header.right + 0.5 && box.top >= header.top && box.bottom <= header.bottom + 0.5;
    }) && el.querySelector('.board-tile__header').scrollWidth <= header.width + 1;
  });
  for (const width of [280, 320, 360, 420, 540, 900]) {
    await tile.evaluate((el, size) => { el.style.width = `${size}px`; }, width);
    check(await fits(tile), `Every icon and zoom control must fit one row at ${width}px`);
  }
  await tile.evaluate(el => { el.style.width = '540px'; });
  check(await tile.locator('.board-tile__action').evaluateAll(buttons => buttons.every(button =>
    button.getAttribute('aria-label') && button.title && button.querySelector('svg[aria-hidden=true]') && !button.textContent)), 'Icon actions must keep accessible names and tooltips');
  check((await tile.locator('.board-tile__title').getAttribute('title')).includes('Galaxy S25') &&
    (await tile.locator('.board-tile__title').getAttribute('title')).includes(fixture), 'Device and full URL must remain available in the title tooltip');
  await tile.getByRole('button', { name: 'Rotate', exact: true }).click();
  check(await tile.locator('.board-tile__dimensions').textContent() === '915 × 412', 'Rotate icon must update actual viewport dimensions');
  await tile.getByRole('button', { name: 'Rotate', exact: true }).click();
  check(await tile.frameLocator('iframe').getByRole('button', { name: 'Clicked' }).isVisible(), 'Automatic layout and rotation must preserve running content');
  check(await tile.locator('iframe').getAttribute('src') === source, 'Header adjustments must not navigate the target');
  check(!await page.locator('.board-tile').nth(1).getByRole('button', { name: 'Rotate', exact: true }).isVisible(), 'Desktop must hide only its unsupported Rotate control');
  check(await fits(page.locator('.board-tile').nth(1)), 'Long desktop names must truncate without displacing icons');
  await tile.getByRole('button', { name: 'Reload', exact: true }).focus();
  check(await tile.getByRole('button', { name: 'Reload', exact: true }).evaluate(el => el === document.activeElement), 'Icon controls must retain keyboard focus');
  await tile.locator('.board-tile__header').screenshot({ path: 'output/playwright/compact-tile-header.png' });
  await page.screenshot({ path: 'output/playwright/compact-tile-workspace.png' });
  await page.locator('#board-url').fill(`${fixture}new`);
  await page.locator('#board-device').selectOption('galaxy-s25');
  await page.getByRole('button', { name: 'Add server tile', exact: true }).click();
  check(await fits(page.locator('.board-tile').last()), 'New server tiles must use the compact row immediately');
  await page.reload();
  check(await fits(page.locator('.board-tile').last()), 'Restored server tiles must retain the compact row');
  await page.setViewportSize({ width: 390, height: 844 });
  await tile.evaluate(el => { el.style.width = '280px'; });
  check(await fits(tile), 'Narrow windows must keep all tile controls reachable in one row');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), 'Compact headers must not introduce main-page scrollbars');
  return { checks };
}
