async (page) => {
  let checks = 0;
  const check = (condition, message) => { if (!condition) throw new Error(message); checks++; };
  const origin = new URL(page.url()).origin;
  const fixture = 'http://127.0.0.1:19112/';
  await page.route(`${fixture}**`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Live preview</title>
    <style>body{font:20px system-ui;background:#eff6fb;color:#14334a;padding:20px}footer{margin-top:850px}</style>
    <h1>Interactive preview</h1><button id="counter" onclick="this.textContent='Clicked'">Click me</button><footer>Bottom of content</footer>` }));
  await page.goto(origin);
  await page.setViewportSize({ width: 1500, height: 980 });
  await page.evaluate(url => localStorage.setItem('device-preview.workspace.v2', JSON.stringify({
    activeTabId: 'zoom', mode: 'board', tabs: [{ id: 'zoom', name: 'Zoom', targetUrl: url, boardTiles: [
      { id: 'a', name: 'Live A', url, deviceId: 'computer', x: 24, y: 24, width: 650, height: 600 },
      { id: 'b', name: 'Live B', url: `${url}other`, deviceId: 'iphone-pro', x: 1200, y: 24, width: 440, height: 600 },
    ] }],
  })), fixture);
  await page.reload();
  const tile = page.locator('.board-tile').filter({has:page.getByRole('heading',{name:'Live A',exact:true})});
  await tile.frameLocator('iframe').locator('#counter').waitFor();
  check(await tile.frameLocator('iframe').locator('h1').textContent() === 'Interactive preview', 'All in One must render real target content');
  check(await page.locator('#device-grid iframe').evaluateAll(frames => frames.every(f => !f.getAttribute('src') && f.dataset.pendingUrl)), 'Restored board must defer all hidden grid loads');
  const source = await tile.locator('iframe').getAttribute('src');
  await tile.frameLocator('iframe').locator('#counter').click();
  check(await tile.frameLocator('iframe').locator('#counter').textContent() === 'Clicked', 'Board preview must remain interactive');
  const initial = await tile.evaluate(el => ({width:el.offsetWidth,height:el.offsetHeight,transform:el.querySelector('.device-shell').style.transform}));
  await tile.getByRole('button', {name:'Live A zoom in',exact:true}).click();
  await page.waitForFunction(transform => document.querySelector('.board-tile .device-shell').style.transform !== transform, initial.transform);
  check(await tile.getByRole('button',{name:'Live A reset zoom',exact:true}).textContent() === '110%', 'Per-tile zoom must update its percentage');
  check(await page.locator('.board-tile').nth(1).getByRole('button',{name:'Live B reset zoom',exact:true}).textContent() === '100%', 'Zooming one tile must not change another');
  check(await tile.evaluate(el => el.offsetWidth) === initial.width, 'Per-tile zoom must preserve box geometry');
  check(await tile.frameLocator('iframe').locator('#counter').textContent() === 'Clicked', 'Zoom must preserve the running page');
  await tile.getByRole('button',{name:'Live A reset zoom',exact:true}).click();
  const zoomBurst = await page.locator('#board-zoom-slider').evaluate(el => {
    const world = document.querySelector('#board-world');
    const before = world.style.transform;
    for(let i=25; i<=200; i++) {el.value=String(i);el.dispatchEvent(new Event('input',{bubbles:true}));}
    return {before,after:world.style.transform};
  });
  check(zoomBurst.before === zoomBurst.after, 'Slider bursts must coalesce whole-board layout updates');
  await page.waitForFunction(() => document.querySelector('#board-world').style.transform === 'scale(2)');
  check(await page.locator('#board-zoom-value').textContent() === '200%', 'Coalesced layout zoom must retain the final slider value');
  await page.locator('#board-zoom-slider').evaluate(el => { el.value='50'; el.dispatchEvent(new Event('input',{bubbles:true})); });
  await page.waitForFunction(() => document.querySelector('#board-world').style.transform === 'scale(0.5)');
  check(await page.locator('#board-zoom-value').textContent() === '50%', 'Whole-board zoom must update its percentage');
  check(await tile.evaluate(el => Math.abs(el.getBoundingClientRect().width - el.offsetWidth / 2) < 1), 'Layout zoom must scale the whole tile');
  const title = await tile.locator('.board-tile__title').boundingBox();
  const oldX = await tile.evaluate(el => parseFloat(el.style.left));
  await page.mouse.move(title.x + 6, title.y + 6);
  await page.mouse.down();
  await page.mouse.move(title.x + 46, title.y + 26, {steps:10});
  await page.mouse.up();
  check(await tile.evaluate(el => parseFloat(el.style.left)) === oldX + 80, 'Dragging at 50% zoom must use board coordinates');
  const handle = await tile.locator('.board-tile__resize').boundingBox();
  await page.mouse.move(handle.x + 6, handle.y + 6);
  await page.mouse.down();
  await page.mouse.move(handle.x + 66, handle.y + 46, {steps:24});
  await page.mouse.up();
  check(await tile.evaluate(el => el.offsetWidth) === initial.width + 120, 'Resizing must account for board zoom');
  check(await tile.evaluate(el => el.offsetHeight) === initial.height + 80, 'Final resize height must flush the final animation frame');
  check(await tile.locator('iframe').getAttribute('src') === source, 'Move, resize and zoom must never reload the target');
  check(await tile.frameLocator('iframe').locator('#counter').textContent() === 'Clicked', 'Resizing must preserve application state');
  check(!await page.locator('body').evaluate(el => el.classList.contains('board-dragging')), 'Completed resizing must clear pointer state');
  const cancelHandle = await tile.locator('.board-tile__resize').boundingBox();
  await tile.locator('.board-tile__resize').evaluate(el => el.addEventListener('pointerdown', event => {el.dataset.testPointerId = event.pointerId;}, {once:true}));
  await page.mouse.move(cancelHandle.x + 6, cancelHandle.y + 6);
  await page.mouse.down();
  const burst = await tile.evaluate((el, point) => {
    const handle = el.querySelector('.board-tile__resize');
    const pointerId = Number(handle.dataset.testPointerId);
    const before = el.offsetWidth;
    for (let i=1; i<=100; i++) window.dispatchEvent(new PointerEvent('pointermove', {pointerId,clientX:point.x + 6 + i / 2,clientY:point.y + 6}));
    const beforeCancel = el.offsetWidth;
    window.dispatchEvent(new PointerEvent('pointercancel', {pointerId}));
    return {before,beforeCancel,after:el.offsetWidth,captured:handle.hasPointerCapture(pointerId),dragging:document.body.classList.contains('board-dragging')};
  }, cancelHandle);
  await page.mouse.up();
  check(burst.beforeCancel === burst.before, 'A burst of pointer events must not synchronously relayout the box');
  check(burst.after === burst.before + 100, 'Pointer cancellation must flush the final pending dimensions');
  check(!burst.captured && !burst.dragging, 'Cancelled resizing must release capture and clean up');
  await page.locator('#board-fit').click();
  check(await page.locator('#board-canvas').evaluate(el => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1), 'Fit board must bring all tile bounds into view');
  await page.reload();
  check(await tile.evaluate(el => el.offsetWidth) === initial.width + 220, 'Resized dimensions must survive reload');
  const savedZoom = await page.locator('#board-zoom-value').textContent();
  check(savedZoom !== '100%', 'Board layout zoom must survive reload');
  await tile.getByRole('button',{name:'URL',exact:true}).click();
  const beforeEdit = await tile.locator('iframe').getAttribute('src');
  await page.locator('#board-url').fill('javascript:alert(1)');
  await page.getByRole('button',{name:'Save tile URL',exact:true}).click();
  check(await tile.locator('iframe').getAttribute('src') === beforeEdit, 'Invalid edits must preserve the working target');
  await page.locator('#board-url').fill(`${fixture}repaired`);
  await page.getByRole('button',{name:'Save tile URL',exact:true}).click();
  check(new URL(await tile.locator('iframe').getAttribute('src')).pathname === '/repaired', 'A changed server URL must navigate the existing tile');
  check(await page.locator('.board-tile').count() === 2 && await tile.evaluate(el => el.offsetWidth) === initial.width + 220, 'Changing a URL must preserve tile count and geometry');
  check(await page.locator('#board-cancel-edit').isVisible() === false, 'Saving must leave edit mode');
  await tile.getByRole('button',{name:'URL',exact:true}).click();
  await page.locator('#board-url').fill(`${fixture}cancelled`);
  const beforeCancel = await tile.locator('iframe').getAttribute('src');
  await page.locator('#board-cancel-edit').click();
  check(await tile.locator('iframe').getAttribute('src') === beforeCancel, 'Cancelling an edit must leave the target unchanged');
  await tile.getByRole('button',{name:'Resize Live A',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  check(await tile.evaluate(el => el.offsetWidth) === initial.width + 230, 'Arrow keys must resize the focused box');
  await page.keyboard.press('Shift+ArrowLeft');
  check(await tile.evaluate(el => el.offsetWidth) === initial.width + 180, 'Shift and arrow keys must use larger resize steps');
  await page.getByRole('button',{name:'Device grid',exact:true}).click();
  await page.locator('#device-grid iframe').first().waitFor();
  check(await page.locator('#device-grid iframe').evaluateAll(frames => frames.every(f => f.src.includes('__dpl_fresh'))), 'Opening the grid must load its deferred previews');
  const computer = page.locator('[data-device-id="computer"]');
  const gridSources = await page.locator('#device-grid iframe').evaluateAll(frames => frames.map(f => f.src));
  await computer.getByRole('button',{name:'Computer zoom in',exact:true}).click();
  check(await computer.getByRole('button',{name:'Computer reset zoom',exact:true}).textContent() === '110%', 'Grid boxes must have independent zoom');
  check(await page.locator('[data-device-id="tablet"] .zoom-controls button').nth(1).textContent() === '100%', 'Grid zoom must leave other boxes unchanged');
  await page.locator('#zoom-slider').evaluate(el => {el.value='200';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForFunction(() => document.querySelector('[data-device-id="computer"] .device-stage').scrollWidth > document.querySelector('[data-device-id="computer"] .device-stage').clientWidth);
  check(await computer.locator('.device-stage').evaluate(el => el.scrollWidth > el.clientWidth), 'Enlarged previews must expose internal scrolling');
  check(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth), 'Zoom must not introduce main page scrollbars');
  check(await page.locator('#device-grid iframe').evaluateAll(frames => frames.map(f => f.src)).then(values => values.every((src,i) => src === gridSources[i])), 'Grid zoom must not reload previews');
  await page.locator('#zoom-value').click();
  await computer.getByRole('button',{name:'Computer reset zoom',exact:true}).click();
  await page.reload();
  check(await computer.getByRole('button',{name:'Computer reset zoom',exact:true}).textContent() === '100%', 'Reset zoom must persist');
  await page.getByRole('button',{name:'All in One',exact:true}).click();
  await page.locator('#board-url').fill(`${fixture}new`);
  await page.getByRole('button',{name:'Add server tile',exact:true}).click();
  check(await page.locator('.board-tile').last().evaluate(el => {
    const board = document.querySelector('#board-canvas').getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return box.bottom <= board.bottom && box.right <= board.right;
  }), 'New desktop tiles must fit the board even with cascade offsets and layout zoom');
  await page.locator('#board-fit').click();
  await page.screenshot({path:'output/playwright/board-zoom.png'});
  return {checks};
}
