async (page) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const failures = [];
  let checks = 0;
  const check = (condition, message) => { checks++; if (!condition) failures.push(message); };
  await page.route('http://127.0.0.1:19112/**', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Preview fixture</title><button>Working target</button>',
  }));
  await page.goto(new URL(page.url()).origin);
  await page.evaluate(() => {
    localStorage.setItem('device-preview.workspace.v2', JSON.stringify({
      activeTabId: 'first', mode: 'board', tabs: [
        { id: 'first', name: 'First', targetUrl: 'http://127.0.0.1:19112/', boardTiles: ['a', 'b', 'c'].map((id, i) => ({
          id, name: id, url: `http://127.0.0.1:19112/${id}`, deviceId: 'iphone-pro',
          x: 24 + i * 480, y: 24, width: 450, height: 650,
        })) },
        { id: 'second', name: 'Second', targetUrl: 'http://127.0.0.1:19112/second', boardTiles: [] },
      ],
    }));
  });
  await page.reload();
  const restored = await page.locator('.board-tile iframe').evaluateAll(frames => frames.map(f => f.getAttribute('src')));
  check(restored.length === 3 && restored.every(src => src?.includes('__dpl_fresh=')), 'Restored board must load all three distinct tiles');
  check(await page.locator('.board-tile__title').allTextContents().then(names => names.join() === 'a,b,c'), 'Board rendering must preserve saved order');
  check(!await page.locator('#device-grid').isVisible(), 'Device grid must be hidden in board mode');
  await page.getByRole('button', { name: 'Second', exact: true }).click();
  check(await page.locator('.board-tile').count() === 0, 'Switching tabs must display the active board');
  await page.getByRole('button', { name: 'First', exact: true }).click();
  check(await page.locator('.board-tile').count() === 3, 'Returning to a tab must restore all its tiles');
  const before = await page.locator('.board-tile iframe').first().getAttribute('src');
  await page.locator('.board-tile').first().getByRole('button', { name: 'Reload', exact: true }).click();
  check(await page.locator('.board-tile iframe').first().getAttribute('src') !== before, 'Tile reload control must work independently of dragging');
  check(!await page.locator('body').evaluate(el => el.classList.contains('board-dragging')), 'Tile controls must not leave a drag active');
  await page.locator('.board-tile').first().getByRole('button', { name: 'Focus', exact: true }).click();
  check(await page.locator('#focus-rotate').isVisible(), 'Focused board phones must offer rotation');
  const focusBeforeRotate = await page.locator('#focus-frame').getAttribute('src');
  await page.locator('#focus-rotate').click();
  check(await page.locator('#focus-viewport').textContent() === '852 × 393', 'Focused tile rotation must update dimensions');
  const focusAfterRotate = await page.locator('#focus-frame').getAttribute('src');
  const loadNumber = src => parseInt(new URL(src).searchParams.get('__dpl_fresh').split('-')[1], 36);
  check(loadNumber(focusAfterRotate) - loadNumber(focusBeforeRotate) === 1, 'Focused board rotation must navigate only once');
  await page.locator('#focus-close').click();
  check(await page.locator('#focus-frame').getAttribute('src') === 'about:blank', 'Closing focus must unload the hidden target');
  const tile = page.locator('.board-tile').first();
  const originalX = await tile.evaluate(el => parseFloat(el.style.left));
  const header = await tile.locator('.board-tile__title').boundingBox();
  await page.mouse.move(header.x + 10, header.y + 10);
  await page.mouse.down();
  await page.mouse.move(header.x + 90, header.y + 70, { steps: 8 });
  await page.mouse.up();
  check(await tile.evaluate(el => parseFloat(el.style.left)) === originalX + 80, 'Dragging must move the tile and release the pointer');
  check(!await page.locator('body').evaluate(el => el.classList.contains('board-dragging')), 'Drag completion must clean up its state');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('device-preview.workspace.v2')));
  check(saved.tabs[0].boardTiles.find(t => t.id === 'a').x === originalX + 80, 'Dragged position must persist');
  const activeSource = await page.locator('#device-grid iframe').first().getAttribute('src');
  await page.getByRole('button', { name: 'Close Second', exact: true }).click();
  check(await page.locator('#device-grid iframe').first().getAttribute('src') === activeSource, 'Closing an inactive tab must not reload active previews');
  await page.getByRole('button', { name: 'Device grid', exact: true }).click();
  check(!await page.locator('#board-panel').isVisible(), 'Board panel must be hidden in grid mode');
  const sources = await page.locator('#device-grid iframe').evaluateAll(frames => frames.map(f => f.src));
  check(new Set(sources).size === 4, 'Grid frames must get unique freshness tokens');
  await page.getByRole('button', { name: 'Fresh reload all', exact: true }).click();
  const reloaded = await page.locator('#device-grid iframe').evaluateAll(frames => frames.map(f => f.src));
  check(reloaded.every((src, i) => src !== sources[i]), 'Reload must replace every freshness token');
  await page.locator('[data-device-id="iphone-pro"]').getByRole('button', { name: 'Rotate', exact: true }).click();
  check(await page.locator('[data-device-id="iphone-pro"] .device-card__viewport').textContent() === '852 × 393', 'Phone rotation must update viewport dimensions');
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile grid must not overflow horizontally');
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole('button', { name: '+ New tab', exact: true }).click();
  await page.getByRole('button', { name: 'All in One', exact: true }).click();
  check(await page.locator('.board-tile').count() === 0, 'New tabs must have an empty board');
  await page.locator('#board-url').fill('http://127.0.0.1:19112/new');
  await page.locator('#board-device').selectOption('galaxy-s25');
  await page.getByRole('button', { name: 'Add server tile', exact: true }).click();
  check(await page.locator('.board-tile iframe').first().getAttribute('src').then(src => src.includes('__dpl_fresh=')), 'Added tiles must load fresh previews');
  await page.locator('.board-tile').getByRole('button', { name: 'Remove', exact: true }).click();
  check(await page.locator('.board-tile').count() === 0, 'Tile removal must remove its frame');
  await page.getByRole('button', { name: 'Close Tab 2', exact: true }).click();
  check(await page.locator('.board-tile').count() === 3, 'Closing the active tab must restore the next board');
  if (failures.length) throw new Error(failures.join('\n'));
  return { failures, checks };
}
