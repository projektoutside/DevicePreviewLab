async (page) => {
  const origin = new URL(page.url()).origin;
  const hosts = await (await page.request.get(`${origin}/api/local-servers`)).json();
  const target = hosts.servers.find(server => server.title === "Nikhom's Personal Hub");
  if (!target) throw new Error('Start the Nikhom Flutter development host before running this explicit live check.');
  const bootstrap = await page.request.get(new URL('flutter_bootstrap.js', target.url).href);
  if (!(await bootstrap.text()).includes('BEGIN DEVICE PREVIEW LAB STARTUP')) throw new Error('Install local preview startup compatibility before this check.');
  let checks = 0;
  const check = (condition, message) => { if (!condition) throw new Error(message); checks++; };
  const errors = [];
  const error = e => errors.push(e.message.slice(0,180));
  page.on('pageerror', error);
  try {
    await page.goto(origin);
    await page.setViewportSize({width:1500,height:980});
    await page.evaluate(url => localStorage.setItem('device-preview.workspace.v2', JSON.stringify({
      activeTabId:'flutter-live',mode:'board',tabs:[{id:'flutter-live',name:'Flutter live',targetUrl:url,boardTiles:[
        {id:'flutter-tile',name:'Flutter preview',url,deviceId:'galaxy-s25',x:24,y:24,width:550,height:740},
      ]}],
    })),target.url);
    await page.reload();
    const tile = page.locator('.board-tile');
    const render = async locator => {
      const frame = await (await locator.elementHandle()).contentFrame();
      await frame.waitForFunction(() => window.$dartMainExecuted === true && document.querySelector('flutter-view'), null, {timeout:30000});
      await frame.waitForFunction(() => document.title === 'Nikhom’s Personal Hub', null, {timeout:20000});
      return frame;
    };
    const phone = await render(tile.locator('iframe'));
    check(await phone.evaluate(() => document.querySelectorAll('flutter-view').length) === 1, 'Real Flutter phone preview must render exactly once');
    check(await phone.evaluate(() => innerWidth) === 412, 'Flutter phone viewport must preserve its device width');
    const initial = await tile.locator('iframe').getAttribute('src');
    await tile.getByRole('button',{name:'Flutter preview zoom in',exact:true}).click();
    check(await tile.locator('iframe').getAttribute('src') === initial, 'Zoom must preserve the live Flutter instance');
    await tile.getByRole('button',{name:'Resize Flutter preview',exact:true}).focus();
    await page.keyboard.press('Shift+ArrowRight');
    check(await phone.evaluate(() => window.$dartMainExecuted && document.querySelectorAll('flutter-view').length === 1), 'Resizing must retain the live Flutter app');
    await tile.getByRole('button',{name:'Flutter preview reset zoom',exact:true}).click();
    await page.screenshot({path:'output/playwright/flutter-board-working.png'});
    await tile.getByRole('button',{name:'Reload',exact:true}).click();
    await render(tile.locator('iframe'));
    check(true, 'Fresh reload must start a new usable Flutter view without debugger attachment');
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),tile.getByRole('button',{name:'Open',exact:true}).click(),
    ]);
    try {
      await popup.waitForFunction(() => window.$dartMainExecuted === true && document.querySelector('flutter-view'), null, {timeout:30000});
      check(new URL(popup.url()).searchParams.has('__dpl_fresh'), 'Open must carry the explicit preview marker');
      check(await popup.evaluate(() => document.querySelectorAll('flutter-view').length) === 1, 'Direct Open from the Lab must render the actual app');
    } finally {await popup.close();}
    await page.getByRole('button',{name:'Device grid',exact:true}).click();
    const grid = page.locator('#device-grid iframe');
    for (let i=0;i<4;i++) {
      const frame = await render(grid.nth(i));
      check(await frame.evaluate(() => document.querySelectorAll('flutter-view').length) === 1, `Live Flutter device ${i+1} must render once`);
      check(await frame.evaluate(() => window.$dartLoader.loadConfig.maxRequestPoolSize) === 32, `Live Flutter device ${i+1} must bound script concurrency`);
    }
    await page.screenshot({path:'output/playwright/flutter-grid-working.png'});
    await page.getByRole('button',{name:'Terminal Hall',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('#terminal-status').textContent.startsWith('Connected'));
    const tab = page.getByRole('tab',{name:`${target.title} :${target.port}`,exact:true});
    await tab.click();
    const panelId = await tab.getAttribute('aria-controls');
    await render(page.locator(`[id="${panelId}"] iframe`));
    check(true, 'Terminal Hall must render the same actual Flutter host');
    await page.getByRole('button',{name:'All in One',exact:true}).click();
    const late = await render(tile.locator('iframe'));
    await late.evaluate(() => {window.$dartRunMain();window.$dartRunMain();});
    check(await late.evaluate(() => document.querySelectorAll('flutter-view').length) === 1, 'Late and duplicate debugger run signals must not duplicate Flutter views');
    check(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth), 'Real Flutter views must not create main-page scrollbars');
    check(errors.length === 0, `Live startup must have no page exceptions: ${errors.join('; ')}`);
    return {checks,target:target.url};
  } finally { page.off('pageerror',error); }
}
