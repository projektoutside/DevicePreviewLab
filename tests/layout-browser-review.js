async (page) => {
  page.setDefaultTimeout(15000);
  let checks = 0;
  const check = (condition, message) => { if (!condition) throw new Error(message); checks++; };
  await page.route('http://127.0.0.1:19112/**', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><style>body{font:18px system-ui;background:#eaf2f8;color:#18304a;padding:20px}button{padding:12px}section{height:1600px}</style><h1>Preview fixture</h1><button onclick="this.textContent=\'Clicked\'">Working target</button><section>Device content scrolls inside its own preview.</section>',
  }));
  await page.goto(new URL(page.url()).origin);
  await page.evaluate(() => localStorage.removeItem('device-preview.workspace.v2'));
  await page.reload();
  await page.getByRole('button', { name: 'Device grid', exact: true }).click();
  await page.locator('#target-url').fill('http://127.0.0.1:19112/');
  await page.getByRole('button', { name: 'Load fresh previews', exact: true }).click();
  const outerFits = () => page.evaluate(() => {
    const workspace = document.querySelector('.workspace').getBoundingClientRect();
    return document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth
      && workspace.bottom <= innerHeight && workspace.right <= innerWidth;
  });
  const sizes = [{ width: 1920, height: 1080 }, { width: 1500, height: 980 }, { width: 1280, height: 720 }, { width: 1024, height: 640 }, { width: 390, height: 844 }];
  for (const size of sizes) {
    await page.setViewportSize(size);
    check(await outerFits(), `Main layout must fit at ${size.width}x${size.height}`);
    if (size.width >= 1280) {
      await page.waitForFunction(() => [...document.querySelectorAll('#device-grid .device-stage')].every(stage => {
        const shell = stage.querySelector('.device-shell').getBoundingClientRect();
        const frame = stage.getBoundingClientRect();
        return shell.left >= frame.left && shell.right <= frame.right && shell.top >= frame.top && shell.bottom <= frame.bottom;
      }));
      check(true, 'Every complete device shell must fit its stage');
      check(await page.locator('#device-grid').evaluate(el => el.scrollHeight <= el.clientHeight), 'Maximized device grid must not need a layout scrollbar');
    }
    await page.getByRole('button', { name: 'All in One', exact: true }).click();
    check(await outerFits(), 'Board mode must not grow the main page');
    await page.getByRole('button', { name: 'Terminal Hall', exact: true }).click();
    check(await outerFits(), 'Terminal Hall must not grow the main page');
    await page.getByRole('button', { name: 'Device grid', exact: true }).click();
  }
  await page.setViewportSize({ width: 1500, height: 980 });
  const controls = await page.evaluate(() => ({
    gridTop: document.querySelector('#device-grid').getBoundingClientRect().top,
    topbarHeight: document.querySelector('.topbar').getBoundingClientRect().height,
    controlsHeight: document.querySelector('#grid-controls').getBoundingClientRect().height,
  }));
  check(controls.gridTop < 180, 'Compact desktop controls must leave more vertical preview space');
  await page.screenshot({ path: 'output/playwright/compact-workspace.png' });
  for (let i = 0; i < 12; i++) await page.getByRole('button', { name: '+ New tab', exact: true }).click();
  check(await page.locator('.topbar').evaluate(el => el.getBoundingClientRect().height < 85), 'Many tabs must scroll horizontally instead of growing the toolbar');
  check(await page.locator('.tab-list').evaluate(el => el.scrollWidth > el.clientWidth), 'Long tab strips must preserve internal scrolling');
  check(await outerFits(), 'Many tabs must not add a main page scrollbar');
  await page.getByRole('button', { name: 'All in One', exact: true }).click();
  await page.locator('#board-url').fill('http://127.0.0.1:19112/board');
  await page.getByRole('button', { name: 'Add server tile', exact: true }).click();
  check(await page.locator('#board-canvas').evaluate(el => el.scrollHeight <= el.clientHeight + 1), 'New board tiles must fit the available board');
  const handle = await page.locator('.board-tile__resize').boundingBox();
  await page.mouse.move(handle.x + 12, handle.y + 12);
  await page.mouse.down();
  await page.mouse.move(handle.x + 12, handle.y + 512, { steps: 12 });
  await page.mouse.up();
  check(await page.locator('#board-canvas').evaluate(el => el.scrollHeight > el.clientHeight), 'Manually enlarged board tiles must scroll within the board');
  check(await outerFits(), 'Large board tiles must not grow the main page');
  return { checks, controls };
}
