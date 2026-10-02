const STORAGE_KEYS = {
  workspace: 'device-preview.workspace.v2',
  // Legacy keys kept only to migrate existing users once.
  targetUrl: 'device-preview.targetUrl',
  orientations: 'device-preview.orientations',
  scaleMode: 'device-preview.scaleMode',
};

const DEFAULT_TARGET_URL = 'http://127.0.0.1:8080';
const FRESHNESS_PARAM = '__dpl_fresh';
const CARD_STAGE_FIT_PADDING = 8;
const FOCUS_STAGE_FIT_PADDING = 12;
const BOARD_MIN_WIDTH = 280;
const BOARD_MIN_HEIGHT = 320;
const BOARD_MAX_WIDTH = 1440;
const BOARD_MAX_HEIGHT = 1200;
const BOARD_TILE_FALLBACK = 'Server';
const LOCAL_SERVERS_ENDPOINT = '/api/local-servers';
const LOCAL_FALLBACK_PORTS = [
  3000, 3001, 5173, 5174, 8080, 8081, 5000, 5001, 8000, 8001, 4200, 5500,
  8888, 9000, 3002, 3003, 4000, 7000, 7100, 8787, 9229, 9999,
];
const LOCAL_FALLBACK_HOSTS = ['127.0.0.1', 'localhost'];
const LOCAL_PROBE_TIMEOUT_MS = 1500;

const DEVICE_PRESETS = [
  {
    id: 'computer',
    label: 'Computer',
    subtitle: 'Desktop viewport',
    width: 1440,
    height: 900,
    rotatable: false,
    defaultOrientation: 'landscape',
    frameKind: 'browser',
    accent: 'desktop',
    frameRadius: 18,
  },
  {
    id: 'tablet',
    label: 'iPad / Tablet',
    subtitle: 'Touch tablet class',
    width: 820,
    height: 1180,
    rotatable: true,
    defaultOrientation: 'portrait',
    frameKind: 'tablet',
    accent: 'tablet',
    frameRadius: 26,
  },
  {
    id: 'galaxy-s25',
    label: 'Galaxy S25-class',
    subtitle: 'Android flagship phone',
    width: 412,
    height: 915,
    rotatable: true,
    defaultOrientation: 'portrait',
    frameKind: 'android-phone',
    accent: 'android',
    frameRadius: 28,
  },
  {
    id: 'iphone-pro',
    label: 'iPhone Pro-class',
    subtitle: 'Modern iPhone Pro size',
    width: 393,
    height: 852,
    rotatable: true,
    defaultOrientation: 'portrait',
    frameKind: 'iphone',
    accent: 'apple',
    frameRadius: 32,
  },
];

const state = {
  tabs: [],
  activeTabId: null,
  mode: 'grid',
  workspaceView: 'preview',
  localServers: [],
  localScan: {
    status: 'idle',
    error: null,
    scannedAt: null,
  },
  focused: {
    deviceId: null,
    boardTileId: null,
  },
  cardRefs: new Map(),
  boardTileRefs: new Map(),
  boardDrag: null,
  boardEditingTileId: null,
};

const elements = {
  form: document.querySelector('#preview-form'),
  targetUrl: document.querySelector('#target-url'),
  targetPick: document.querySelector('#target-pick'),
  targetScan: document.querySelector('#target-scan'),
  serversList: document.querySelector('#local-servers-list'),
  reloadAll: document.querySelector('#reload-all'),
  openTarget: document.querySelector('#open-target'),
  zoomSlider: document.querySelector('#zoom-slider'),
  zoomValue: document.querySelector('#zoom-value'),
  gridZoomOut: document.querySelector('#grid-zoom-out'),
  gridZoomIn: document.querySelector('#grid-zoom-in'),
  statusMessage: document.querySelector('#status-message'),
  deviceGrid: document.querySelector('#device-grid'),
  template: document.querySelector('#device-card-template'),
  gridControls: document.querySelector('#grid-controls'),
  tabList: document.querySelector('#tab-list'),
  tabAdd: document.querySelector('#tab-add'),
  terminalHallTab: document.querySelector('#terminal-hall-tab'),
  modeGrid: document.querySelector('#mode-grid'),
  modeBoard: document.querySelector('#mode-board'),
  boardPanel: document.querySelector('#board-panel'),
  boardForm: document.querySelector('#board-add-form'),
  boardSubmit: document.querySelector('#board-submit'),
  boardCancelEdit: document.querySelector('#board-cancel-edit'),
  boardUrl: document.querySelector('#board-url'),
  boardPick: document.querySelector('#board-pick'),
  boardScan: document.querySelector('#board-scan'),
  boardDevice: document.querySelector('#board-device'),
  boardReload: document.querySelector('#board-reload'),
  boardStatus: document.querySelector('#board-status'),
  boardCanvas: document.querySelector('#board-canvas'),
  boardWorld: document.querySelector('#board-world'),
  boardSpace: document.querySelector('#board-space'),
  boardZoomSlider: document.querySelector('#board-zoom-slider'),
  boardZoomValue: document.querySelector('#board-zoom-value'),
  boardZoomOut: document.querySelector('#board-zoom-out'),
  boardZoomIn: document.querySelector('#board-zoom-in'),
  boardFit: document.querySelector('#board-fit'),
  focusOverlay: document.querySelector('#focus-overlay'),
  focusStage: document.querySelector('#focus-stage'),
  focusShell: document.querySelector('#focus-shell'),
  focusCanvas: document.querySelector('#focus-canvas'),
  focusFrame: document.querySelector('#focus-frame'),
  focusEyebrow: document.querySelector('#focus-eyebrow'),
  focusTitle: document.querySelector('#focus-title'),
  focusTarget: document.querySelector('#focus-target'),
  focusViewport: document.querySelector('#focus-viewport'),
  focusRotate: document.querySelector('#focus-rotate'),
  focusReload: document.querySelector('#focus-reload'),
  focusFullscreen: document.querySelector('#focus-fullscreen'),
  focusClose: document.querySelector('#focus-close'),
};

const stageObserver = new ResizeObserver(scheduleViewportSync);

let pendingViewportSync = 0;
let pendingBoardZoom = 0;
let boardZoomAnchor = null;
let freshLoadCounter = 0;

bootstrap();

function bootstrap() {
  loadWorkspace();
  populateBoardDeviceOptions();
  renderLocalServerOptions('Scanning local servers…');

  const activeTab = getActiveTab();
  elements.targetUrl.value = activeTab.targetUrl;
  updateZoomControls();

  renderTabs();
  renderCards();
  renderBoard();
  applyUrlToFrames(activeTab.targetUrl);
  attachEvents();
  setMode(state.mode, { silent: true });
  syncAllCardScales();
  syncAllBoardTileScales();
  refreshLocalServers({ silent: true });

  setStatus(
    `Always-fresh previews are on. Tab “${activeTab.name}” is showing ${activeTab.targetUrl}.`,
    'success',
  );
}

function attachEvents() {
  elements.terminalHallTab.addEventListener('click', () => {
    flushBoardZoom();
    endBoardDrag();
    closeFocusPreview();
    state.workspaceView = 'terminal';
    elements.deviceGrid.hidden = true;
    elements.gridControls.hidden = true;
    elements.boardPanel.hidden = true;
    renderTabs();
    window.TerminalHall.show();
  });
  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const submittedUrl = elements.targetUrl.value.trim();
    if (!validateAndApplyUrl(submittedUrl)) {
      return;
    }
    const activeTab = getActiveTab();
    setStatus(`Fresh-loaded ${activeTab.targetUrl} in “${activeTab.name}”.`, 'success');
  });

  elements.reloadAll.addEventListener('click', () => {
    if (!validateAndApplyUrl(elements.targetUrl.value.trim())) {
      return;
    }
    setStatus('Fresh-reloaded every preview frame with cache bypassing.', 'success');
  });

  elements.openTarget.addEventListener('click', () => {
    const rawUrl = elements.targetUrl.value.trim();
    const normalizedUrl = normalizeUrl(rawUrl);
    if (!normalizedUrl) {
      setStatus('Enter a valid http or https URL before opening a new tab.', 'error');
      return;
    }

    window.open(createFreshPreviewUrl(normalizedUrl), '_blank', 'noopener,noreferrer');
    setStatus(`Opened ${normalizedUrl} in a new browser tab.`, 'success');
  });

  elements.zoomSlider.addEventListener('input', () => {
    setGridZoom(Number(elements.zoomSlider.value));
  });
  elements.gridZoomOut.addEventListener('click', () => setGridZoom(getActiveTab().zoomPercent - 10));
  elements.gridZoomIn.addEventListener('click', () => setGridZoom(getActiveTab().zoomPercent + 10));
  elements.zoomValue.addEventListener('click', () => setGridZoom(100));
  elements.boardZoomSlider.addEventListener('input', () => setBoardZoom(Number(elements.boardZoomSlider.value)));
  elements.boardZoomOut.addEventListener('click', () => setBoardZoom(getBoardZoom() - 10));
  elements.boardZoomIn.addEventListener('click', () => setBoardZoom(getBoardZoom() + 10));
  elements.boardZoomValue.addEventListener('click', () => setBoardZoom(100));
  elements.boardFit.addEventListener('click', fitBoard);

  elements.tabAdd.addEventListener('click', () => {
    createTab();
  });

  elements.modeGrid.addEventListener('click', () => {
    setMode('grid');
  });

  elements.modeBoard.addEventListener('click', () => {
    setMode('board');
  });

  elements.boardForm.addEventListener('submit', (event) => {
    event.preventDefault();
    addBoardTile(elements.boardUrl.value.trim(), elements.boardDevice.value);
  });

  elements.targetPick.addEventListener('change', () => {
    if (!elements.targetPick.value) {
      return;
    }
    elements.targetUrl.value = elements.targetPick.value;
    elements.targetPick.value = '';
    elements.form.requestSubmit();
  });

  elements.boardPick.addEventListener('change', () => {
    if (!elements.boardPick.value) {
      return;
    }
    elements.boardUrl.value = elements.boardPick.value;
    elements.boardPick.value = '';
    elements.boardUrl.focus();
  });

  elements.targetScan.addEventListener('click', () => {
    refreshLocalServers();
  });

  elements.boardScan.addEventListener('click', () => {
    refreshLocalServers();
    elements.boardUrl.focus();
  });

  elements.boardReload.addEventListener('click', () => {
    reloadBoardTiles();
    setBoardStatus('Fresh-reloaded every All in One tile with cache bypassing.', 'success');
  });

  elements.focusRotate.addEventListener('click', () => {
    if (state.focused.boardTileId) {
      rotateBoardTile(state.focused.boardTileId);
      return;
    }

    if (state.focused.deviceId) {
      toggleOrientation(state.focused.deviceId);
      syncFocusPreview();
    }
  });

  elements.focusReload.addEventListener('click', () => {
    reloadFocusFrame();
    setStatus('Fresh-reloaded the focused preview with cache bypassing.', 'success');
  });

  elements.focusFullscreen.addEventListener('click', () => {
    requestOverlayFullscreen();
  });

  document.addEventListener('fullscreenchange', scheduleViewportSync);
  window.addEventListener('resize', scheduleViewportSync);
  window.addEventListener('orientationchange', scheduleViewportSync);
  window.addEventListener('online', refreshAfterReconnect);
  window.addEventListener('pageshow', refreshAfterHistoryRestore);
  window.visualViewport?.addEventListener('resize', scheduleViewportSync);

  elements.focusClose.addEventListener('click', closeFocusPreview);
  elements.focusOverlay.addEventListener('click', (event) => {
    if (event.target === elements.focusOverlay || event.target.classList.contains('focus-overlay__backdrop')) {
      closeFocusPreview();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.focusOverlay.hidden) {
      closeFocusPreview();
    }
  });
}

function renderCards() {
  const fragment = document.createDocumentFragment();

  DEVICE_PRESETS.forEach((preset) => {
    const cardFragment = elements.template.content.cloneNode(true);
    const card = cardFragment.querySelector('.device-card');
    const eyebrow = cardFragment.querySelector('.device-card__eyebrow');
    const title = cardFragment.querySelector('.device-card__title');
    const viewport = cardFragment.querySelector('.device-card__viewport');
    const focusButton = cardFragment.querySelector('.device-card__focus');
    const rotateButton = cardFragment.querySelector('.device-card__rotate');
    const stage = cardFragment.querySelector('.device-stage');
    const shell = cardFragment.querySelector('.device-shell');
    const canvas = cardFragment.querySelector('.device-canvas');
    const iframe = cardFragment.querySelector('.device-frame');
    const surface = wrapPreviewSurface(stage, shell);
    const zoomControls = createPreviewZoomControls(preset.label, () => getDeviceZoom(preset.id), value => {
      const tab = getActiveTab();
      tab.deviceZooms ??= {};
      tab.deviceZooms[preset.id] = clampZoomPercent(value);
      persistWorkspace();
      animatePreviewZoom(stage);
      scheduleViewportSync();
    });
    cardFragment.querySelector('.device-card__controls').appendChild(zoomControls.element);

    card.dataset.deviceId = preset.id;
    card.dataset.accent = preset.accent;
    eyebrow.textContent = preset.subtitle;
    title.textContent = preset.label;
    shell.dataset.frameKind = preset.frameKind;
    iframe.title = `${preset.label} preview`;
    stage.tabIndex = 0;
    stage.setAttribute('role', 'button');
    stage.setAttribute('aria-label', `Open ${preset.label} in fullscreen focus mode`);

    stage.addEventListener('click', event => {
      if (event.target === stage) return;
      openFocusPreview(preset.id, { fullscreen: true });
    });

    stage.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      openFocusPreview(preset.id, { fullscreen: true });
    });

    focusButton.addEventListener('click', (event) => {
      event.stopPropagation();
      openFocusPreview(preset.id, { fullscreen: true });
    });

    if (!preset.rotatable) {
      rotateButton.hidden = true;
    } else {
      rotateButton.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleOrientation(preset.id);
      });
    }

    stageObserver.observe(stage);

    state.cardRefs.set(preset.id, {
      preset,
      card,
      stage,
      shell,
      canvas,
      iframe,
      viewport,
      surface,
      zoomControls,
    });

    fragment.appendChild(cardFragment);
    updateCardGeometry(preset.id);
  });

  elements.deviceGrid.appendChild(fragment);
  stageObserver.observe(elements.focusStage);
}

function toggleOrientation(deviceId, tab = getActiveTab()) {
  const preset = DEVICE_PRESETS.find((item) => item.id === deviceId);
  if (!preset || !preset.rotatable) {
    return;
  }

  const currentOrientation = getOrientation(deviceId, tab);
  tab.orientations[deviceId] =
    currentOrientation === 'portrait' ? 'landscape' : 'portrait';
  persistWorkspace();
  updateCardGeometry(deviceId);
  syncAllCardScales();
}

function getOrientation(deviceId, tab = getActiveTab()) {
  return tab?.orientations?.[deviceId] ?? (
    DEVICE_PRESETS.find((preset) => preset.id === deviceId)?.defaultOrientation ??
    'portrait'
  );
}

function updateCardGeometry(deviceId) {
  const cardRef = state.cardRefs.get(deviceId);
  if (!cardRef) {
    return;
  }

  const { preset, shell, canvas, viewport } = cardRef;
  const orientation = getOrientation(deviceId, getActiveTab());
  const { width: frameWidth, height: frameHeight, shellWidth, shellHeight } = getFrameDimensions(preset, orientation);

  shell.style.setProperty('--shell-width', `${shellWidth}px`);
  shell.style.setProperty('--shell-height', `${shellHeight}px`);
  shell.style.setProperty('--frame-width', `${frameWidth}px`);
  shell.style.setProperty('--frame-height', `${frameHeight}px`);
  shell.style.setProperty('--frame-radius', `${preset.frameRadius}px`);
  canvas.style.setProperty('--frame-width', `${frameWidth}px`);
  canvas.style.setProperty('--frame-height', `${frameHeight}px`);
  canvas.style.setProperty('--frame-radius', `${preset.frameRadius}px`);

  viewport.textContent = `${frameWidth} × ${frameHeight}`;
}

function syncAllCardScales() {
  state.cardRefs.forEach((_, deviceId) => {
    syncCardScale(deviceId);
  });
}

function syncCardScale(deviceId) {
  const cardRef = state.cardRefs.get(deviceId);
  if (!cardRef) {
    return;
  }

  const { stage, shell } = cardRef;
  cardRef.zoomControls.update();
  const shellWidth = Number.parseFloat(
    shell.style.getPropertyValue('--shell-width'),
  );
  const shellHeight = Number.parseFloat(
    shell.style.getPropertyValue('--shell-height'),
  );

  if (!shellWidth || !shellHeight) {
    return;
  }

  const fitScale = getFitScale({
    container: stage,
    shellWidth,
    shellHeight,
    padding: CARD_STAGE_FIT_PADDING,
    maxScale: 1,
  });
  const zoomScale = getActiveTab().zoomPercent * getDeviceZoom(deviceId) / 10000;
  const finalScale = Math.max(0.001, fitScale * zoomScale);
  applyPreviewScale(cardRef, finalScale, shellWidth, shellHeight);
}

function wrapPreviewSurface(stage, shell) {
  const surface = document.createElement('div');
  surface.className = 'preview-surface';
  stage.appendChild(surface);
  surface.appendChild(shell);
  return surface;
}

function applyPreviewScale(ref, scale, width, height) {
  ref.surface.style.width = `${Math.max(ref.stage.clientWidth, Math.ceil(width * scale + CARD_STAGE_FIT_PADDING))}px`;
  ref.surface.style.height = `${Math.max(ref.stage.clientHeight, Math.ceil(height * scale + CARD_STAGE_FIT_PADDING))}px`;
  ref.shell.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

function getDeviceZoom(deviceId) {
  return clampZoomPercent(Number(getActiveTab().deviceZooms?.[deviceId] ?? 100));
}

function createPreviewZoomControls(label, getValue, setValue) {
  const element = document.createElement('div');
  element.className = 'zoom-controls';
  const buttons = ['−', '100%', '+'].map((text, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.title = ['Zoom out', 'Reset this preview to 100%', 'Zoom in'][index];
    button.addEventListener('click', event => {
      event.stopPropagation();
      setValue(index === 1 ? 100 : getValue() + (index === 0 ? -10 : 10));
      update();
    });
    element.appendChild(button);
    return button;
  });
  elements.boardCancelEdit.addEventListener('click', cancelBoardEdit);
  function update() {
    const value = getValue();
    const name = typeof label === 'function' ? label() : label;
    buttons.forEach((button, index) => button.setAttribute('aria-label', `${name} ${['zoom out', 'reset zoom', 'zoom in'][index]}`));
    buttons[1].textContent = `${value}%`;
    buttons[0].disabled = value <= 25;
    buttons[2].disabled = value >= 200;
  }
  update();
  return { element, update };
}

function animatePreviewZoom(stage) {
  stage.classList.add('preview-zooming');
  clearTimeout(stage.zoomTimer);
  stage.zoomTimer = setTimeout(() => stage.classList.remove('preview-zooming'), 160);
}

function updateZoomControls() {
  const tab = getActiveTab();
  elements.zoomSlider.value = String(tab.zoomPercent);
  elements.zoomValue.textContent = `${tab.zoomPercent}%`;
  elements.gridZoomOut.disabled = tab.zoomPercent <= 25;
  elements.gridZoomIn.disabled = tab.zoomPercent >= 200;
  const boardZoom = getBoardZoom();
  elements.boardZoomSlider.value = String(boardZoom);
  elements.boardZoomValue.textContent = `${boardZoom}%`;
  elements.boardZoomOut.disabled = boardZoom <= 25;
  elements.boardZoomIn.disabled = boardZoom >= 200;
}

function setGridZoom(value) {
  getActiveTab().zoomPercent = clampZoomPercent(value);
  state.cardRefs.forEach(ref => animatePreviewZoom(ref.stage));
  updateZoomControls();
  persistWorkspace();
  scheduleViewportSync();
}

function syncFocusScale() {
  if ((!state.focused.deviceId && !state.focused.boardTileId) || elements.focusOverlay.hidden) {
    return;
  }

  const shellWidth = Number.parseFloat(
    elements.focusShell.style.getPropertyValue('--shell-width'),
  );
  const shellHeight = Number.parseFloat(
    elements.focusShell.style.getPropertyValue('--shell-height'),
  );

  if (!shellWidth || !shellHeight) {
    return;
  }

  const finalScale = getFitScale({
    container: elements.focusStage,
    shellWidth,
    shellHeight,
    padding: FOCUS_STAGE_FIT_PADDING,
    minScale: 0.1,
  });

  elements.focusShell.style.transform = `translate(-50%, -50%) scale(${finalScale})`;
}

function getFitScale({
  container,
  shellWidth,
  shellHeight,
  padding = 0,
  minScale = 0,
  maxScale = Number.POSITIVE_INFINITY,
}) {
  if (!container || !shellWidth || !shellHeight) {
    return minScale;
  }

  const availableWidth = Math.max(container.clientWidth - padding, 1);
  const availableHeight = Math.max(container.clientHeight - padding, 1);
  const widthFit = availableWidth / shellWidth;
  const heightFit = availableHeight / shellHeight;
  const fitScale = Math.min(widthFit, heightFit);

  return Math.max(minScale, Math.min(fitScale, maxScale));
}

function scheduleViewportSync() {
  if (pendingViewportSync) {
    return;
  }

  pendingViewportSync = window.requestAnimationFrame(() => {
    pendingViewportSync = 0;
    syncAllCardScales();
    syncAllBoardTileScales();
    syncBoardLayout();
    syncFocusScale();
  });
}

function openFocusPreview(deviceId, { fullscreen = false, boardTileId = null } = {}) {
  state.focused.deviceId = deviceId;
  state.focused.boardTileId = boardTileId;
  document.body.classList.add('focus-mode');
  elements.focusOverlay.hidden = false;
  elements.focusOverlay.setAttribute('aria-hidden', 'false');
  syncFocusPreview();

  if (fullscreen) {
    requestOverlayFullscreen();
  }
}

function closeFocusPreview() {
  state.focused.deviceId = null;
  state.focused.boardTileId = null;
  elements.focusOverlay.hidden = true;
  elements.focusOverlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('focus-mode');
  elements.focusFrame.src = 'about:blank';

  if (document.fullscreenElement === elements.focusOverlay) {
    document.exitFullscreen().catch(() => {
      // Ignore browser-specific fullscreen exit failures.
    });
  }
}

function syncFocusPreview() {
  if (!state.focused.deviceId) {
    return;
  }

  if (state.focused.boardTileId) {
    const tileRef = state.boardTileRefs.get(state.focused.boardTileId);
    if (!tileRef) {
      return;
    }
    syncFocusPreviewForFrame({
      preset: tileRef.preset,
      orientation: tileRef.tile.orientation,
      url: tileRef.tile.url,
      titleSuffix: tileRef.tile.name,
      rotatable: true,
    });
    return;
  }

  const cardRef = state.cardRefs.get(state.focused.deviceId);
  if (!cardRef) {
    return;
  }

  syncFocusPreviewForFrame({
    preset: cardRef.preset,
    orientation: getOrientation(state.focused.deviceId, getActiveTab()),
    url: getActiveTab().targetUrl,
    titleSuffix: null,
    rotatable: true,
    deviceId: state.focused.deviceId,
  });
}

function syncFocusPreviewForFrame({ preset, orientation, url, titleSuffix, rotatable, deviceId = null }) {
  const { width: frameWidth, height: frameHeight, shellWidth, shellHeight } = getFrameDimensions(preset, orientation);

  elements.focusShell.dataset.frameKind = preset.frameKind;
  elements.focusShell.style.setProperty('--shell-width', `${shellWidth}px`);
  elements.focusShell.style.setProperty('--shell-height', `${shellHeight}px`);
  elements.focusShell.style.setProperty('--frame-width', `${frameWidth}px`);
  elements.focusShell.style.setProperty('--frame-height', `${frameHeight}px`);
  elements.focusShell.style.setProperty('--frame-radius', `${preset.frameRadius}px`);
  elements.focusCanvas.style.setProperty('--frame-width', `${frameWidth}px`);
  elements.focusCanvas.style.setProperty('--frame-height', `${frameHeight}px`);
  elements.focusCanvas.style.setProperty('--frame-radius', `${preset.frameRadius}px`);

  elements.focusEyebrow.textContent = titleSuffix ? `${preset.subtitle} • ${titleSuffix}` : preset.subtitle;
  elements.focusTitle.textContent = titleSuffix ? `${preset.label} • ${titleSuffix}` : preset.label;
  elements.focusViewport.textContent = `${frameWidth} × ${frameHeight}`;
  elements.focusTarget.textContent = url;
  navigateFrameFresh(elements.focusFrame, url);
  elements.focusFrame.title = `${preset.label} focused preview`;
  elements.focusRotate.hidden = !(rotatable && preset.rotatable);
  elements.focusRotate.dataset.focusDeviceId = deviceId ?? '';

  syncFocusScale();
}

function reloadFocusFrame() {
  if (!state.focused.deviceId) {
    return;
  }

  if (state.focused.boardTileId) {
    const tileRef = state.boardTileRefs.get(state.focused.boardTileId);
    if (tileRef) {
      navigateFrameFresh(elements.focusFrame, tileRef.tile.url);
    }
    return;
  }

  navigateFrameFresh(elements.focusFrame, getActiveTab().targetUrl);
}

function requestOverlayFullscreen() {
  const fullscreenTarget = elements.focusOverlay;
  if (
    !fullscreenTarget ||
    typeof fullscreenTarget.requestFullscreen !== 'function'
  ) {
    syncFocusScale();
    return;
  }

  if (document.fullscreenElement === fullscreenTarget) {
    syncFocusScale();
    return;
  }

  fullscreenTarget.requestFullscreen().then(() => {
    scheduleViewportSync();
  }).catch(() => {
    // The overlay still covers the viewport even if the browser denies fullscreen.
    syncFocusScale();
  });
}

function validateAndApplyUrl(rawUrl) {
  const normalizedUrl = normalizeUrl(rawUrl);
  if (!normalizedUrl) {
    setStatus('Enter a valid http or https URL before loading previews.', 'error');
    return false;
  }

  const activeTab = getActiveTab();
  activeTab.targetUrl = normalizedUrl;
  elements.targetUrl.value = normalizedUrl;
  persistWorkspace();
  renderTabs();
  applyUrlToFrames(normalizedUrl);
  return true;
}

function applyUrlToFrames(url) {
  state.cardRefs.forEach(({ iframe }) => {
    navigateFrameFresh(iframe, url, { defer: state.mode !== 'grid' || state.workspaceView !== 'preview' });
  });

  if (state.focused.deviceId && !state.focused.boardTileId) {
    navigateFrameFresh(elements.focusFrame, url);
    elements.focusTarget.textContent = url;
  }
}

function reloadAllFrames() {
  applyUrlToFrames(getActiveTab().targetUrl);
}

function refreshAfterReconnect() {
  reloadAllFrames();
  reloadBoardTiles();
  setStatus('Connection restored. Fresh-reloaded every preview frame.', 'success');
}

function refreshAfterHistoryRestore(event) {
  if (!event.persisted) {
    return;
  }

  reloadAllFrames();
  reloadBoardTiles();
  refreshLocalServers({ silent: true });
  setStatus('Page restored. Fresh-reloaded every preview frame.', 'success');
}

function navigateFrameFresh(iframe, url, { defer = false } = {}) {
  if (defer) {
    iframe.dataset.pendingUrl = url;
    return;
  }
  delete iframe.dataset.pendingUrl;
  iframe.src = createFreshPreviewUrl(url);
}

function flushPendingPreviews(container) {
  container.querySelectorAll('iframe[data-pending-url]').forEach(iframe => navigateFrameFresh(iframe, iframe.dataset.pendingUrl));
}

function createFreshPreviewUrl(url) {
  const freshUrl = new URL(url);
  freshLoadCounter += 1;
  freshUrl.searchParams.set(
    FRESHNESS_PARAM,
    `${Date.now().toString(36)}-${freshLoadCounter.toString(36)}`,
  );
  return freshUrl.toString();
}

function normalizeUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const candidate = new URL(rawUrl);
    if (!['http:', 'https:'].includes(candidate.protocol)) {
      return null;
    }
    return candidate.toString();
  } catch {
    return null;
  }
}

function setStatus(message, stateName = 'info') {
  elements.statusMessage.textContent = message;
  elements.statusMessage.dataset.state = stateName;
}

function clampNumber(value, min, max) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

function clampZoomPercent(value) {
  if (!Number.isFinite(value)) {
    return 100;
  }
  return Math.min(200, Math.max(25, value));
}

function getActiveTab() {
  const found = state.tabs.find((tab) => tab.id === state.activeTabId);
  if (found) {
    return found;
  }
  state.activeTabId = state.tabs[0]?.id ?? null;
  return state.tabs[0];
}

function createId(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function createTab(options = {}) {
  const tab = {
    id: createId('tab'),
    name: options.name || `Tab ${state.tabs.length + 1}`,
    targetUrl: normalizeUrl(options.targetUrl ?? '') ?? DEFAULT_TARGET_URL,
    orientations: { ...(options.orientations ?? {}) },
    zoomPercent: clampZoomPercent(Number(options.zoomPercent ?? 100)),
    deviceZooms: {},
    boardZoomPercent: 100,
    boardTiles: [],
  };
  state.tabs.push(tab);
  if (options.activate !== false || !state.activeTabId) {
    state.activeTabId = tab.id;
  }
  persistWorkspace();
  if (options.activate !== false) {
    activateTab(tab.id, { silentStatus: true });
    setStatus(`Created tab “${tab.name}” with target ${tab.targetUrl}.`, 'success');
  } else {
    renderTabs();
  }
  return tab;
}

function activateTab(tabId, options = {}) {
  const tab = state.tabs.find((item) => item.id === tabId);
  if (!tab) {
    return;
  }
  flushBoardZoom();
  endBoardDrag();
  closeFocusPreview();
  state.activeTabId = tab.id;
  persistWorkspace();
  renderTabs();
  elements.targetUrl.value = tab.targetUrl;
  updateZoomControls();
  DEVICE_PRESETS.forEach((preset) => updateCardGeometry(preset.id));
  applyUrlToFrames(tab.targetUrl);
  renderBoard();
  setMode(state.mode, { silent: true });
  syncAllCardScales();
  if (!options.silentStatus) {
    setStatus(`Switched to tab “${tab.name}”. Target is ${tab.targetUrl}.`, 'success');
  }
}

function closeTab(tabId) {
  if (state.tabs.length <= 1) {
    setStatus('At least one tab must remain open.', 'error');
    return;
  }
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return;
  }
  const removed = state.tabs.splice(index, 1)[0];
  const wasActive = state.activeTabId === tabId;
  if (wasActive) {
    const nextTab = state.tabs[Math.min(index, state.tabs.length - 1)];
    activateTab(nextTab.id, { silentStatus: true });
  }
  persistWorkspace();
  renderTabs();
  const activeTab = getActiveTab();
  setStatus(`Closed tab “${removed.name}”. Now showing “${activeTab.name}”.`, 'success');
}

function renameTab(tabId) {
  const tab = state.tabs.find((item) => item.id === tabId);
  if (!tab) {
    return;
  }
  const nextName = window.prompt('Rename tab', tab.name);
  if (nextName === null) {
    return;
  }
  const trimmed = nextName.trim();
  if (!trimmed) {
    setStatus('Tab name cannot be empty.', 'error');
    return;
  }
  tab.name = trimmed.slice(0, 48);
  persistWorkspace();
  renderTabs();
  setStatus(`Renamed tab to “${tab.name}”.`, 'success');
}

function renderTabs() {
  const inHall = state.workspaceView === 'terminal';
  if (inHall) {
    for (const button of [elements.modeGrid, elements.modeBoard]) {
      button.setAttribute('aria-pressed', 'false');
      button.classList.remove('mode-toggle__button--active');
    }
  }
  elements.terminalHallTab.setAttribute('aria-pressed', String(inHall));
  elements.terminalHallTab.classList.toggle('button--primary', inHall);
  elements.tabList.innerHTML = '';
  const fragment = document.createDocumentFragment();
  state.tabs.forEach((tab) => {
    const item = document.createElement('div');
    item.className = 'tab-item';
    if (!inHall && tab.id === state.activeTabId) {
      item.classList.add('tab-item--active');
    }
    item.setAttribute('role', 'tab');
    item.tabIndex = 0;
    item.title = `${tab.name} — ${tab.targetUrl} (double-click to rename)`;
    item.setAttribute('aria-selected', !inHall && tab.id === state.activeTabId ? 'true' : 'false');

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'tab-item__label';
    label.textContent = tab.name;
    label.title = tab.targetUrl;
    label.addEventListener('click', () => activateTab(tab.id));
    item.appendChild(label);

    const url = document.createElement('span');
    url.className = 'tab-item__url';
    url.textContent = compactUrl(tab.targetUrl);
    item.appendChild(url);

    if (state.tabs.length > 1) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'tab-item__close';
      close.textContent = '×';
      close.title = `Close ${tab.name}`;
      close.setAttribute('aria-label', `Close ${tab.name}`);
      close.addEventListener('click', (event) => {
        event.stopPropagation();
        closeTab(tab.id);
      });
      item.appendChild(close);
    }

    item.addEventListener('keydown', (event) => {
      if (event.target !== item) {
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activateTab(tab.id);
      }
    });
    item.addEventListener('dblclick', () => renameTab(tab.id));
    fragment.appendChild(item);
  });
  elements.tabList.appendChild(fragment);
}

function compactUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    const compact = `${parsed.host}${path}${parsed.search}`;
    return compact.length > 34 ? `${compact.slice(0, 31)}…` : compact;
  } catch {
    return url;
  }
}

function setMode(mode, options = {}) {
  flushBoardZoom();
  state.workspaceView = 'preview';
  window.TerminalHall?.hide();
  renderTabs();
  state.mode = mode === 'board' ? 'board' : 'grid';
  const isBoard = state.mode === 'board';
  elements.modeGrid.setAttribute('aria-pressed', String(!isBoard));
  elements.modeBoard.setAttribute('aria-pressed', String(isBoard));
  elements.modeGrid.classList.toggle('mode-toggle__button--active', !isBoard);
  elements.modeBoard.classList.toggle('mode-toggle__button--active', isBoard);
  elements.deviceGrid.hidden = isBoard;
  elements.gridControls.hidden = isBoard;
  elements.boardPanel.hidden = !isBoard;
  flushPendingPreviews(isBoard ? elements.boardWorld : elements.deviceGrid);
  updateZoomControls();
  persistWorkspace();
  if (!options.silent) {
    setStatus(isBoard ? 'All in One board is active. Drag, resize, reload, or remove tiles.' : `Device grid is active for tab “${getActiveTab().name}”.`, 'success');
  }
  window.requestAnimationFrame(() => {
    if (isBoard) {
      syncBoardLayout();
      syncAllBoardTileScales();
    } else {
      syncAllCardScales();
    }
    syncFocusScale();
  });
}

function populateBoardDeviceOptions() {
  elements.boardDevice.innerHTML = '';
  DEVICE_PRESETS.forEach((preset) => {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = `${preset.label} — ${preset.width}×${preset.height}`;
    elements.boardDevice.appendChild(option);
  });
}

function getBoardTiles() {
  return getActiveTab().boardTiles;
}

function getPresetById(deviceId) {
  return DEVICE_PRESETS.find((preset) => preset.id === deviceId) ?? DEVICE_PRESETS[0];
}

function getFrameDimensions(preset, orientation) {
  const isLandscape = preset.rotatable ? orientation === 'landscape' : preset.defaultOrientation === 'landscape';
  const width = preset.rotatable ? (isLandscape ? preset.height : preset.width) : preset.width;
  const height = preset.rotatable ? (isLandscape ? preset.width : preset.height) : preset.height;
  const shellPadding = preset.frameKind === 'browser' ? 0 : 16;
  const chromeHeight = preset.frameKind === 'browser' ? 54 : 0;
  return {
    width,
    height,
    shellWidth: width + shellPadding * 2,
    shellHeight: height + shellPadding * 2 + chromeHeight,
  };
}

function deriveTileName(url) {
  try {
    const parsed = new URL(url);
    if (parsed.port) {
      return `${parsed.hostname}:${parsed.port}`;
    }
    return parsed.host;
  } catch {
    return BOARD_TILE_FALLBACK;
  }
}

function addBoardTile(rawUrl, deviceId) {
  const normalizedUrl = normalizeUrl(rawUrl);
  if (!normalizedUrl) {
    setBoardStatus('Enter a valid http or https server URL before adding a tile.', 'error');
    return false;
  }
  const tiles = getBoardTiles();
  const preset = getPresetById(deviceId);
  if (state.boardEditingTileId) {
    const tile = tiles.find(item => item.id === state.boardEditingTileId);
    if (!tile) {
      cancelBoardEdit();
      setBoardStatus('That tile is no longer available. Add a new tile instead.', 'error');
      return false;
    }
    if (tile.name === deriveTileName(tile.url)) tile.name = deriveTileName(normalizedUrl);
    tile.url = normalizedUrl;
    if (tile.deviceId !== preset.id) tile.orientation = preset.defaultOrientation;
    tile.deviceId = preset.id;
    const ref = state.boardTileRefs.get(tile.id);
    ref.title.textContent = tile.name;
    ref.title.title = tile.url;
    updateBoardTileGeometry(tile.id);
    syncBoardTileScale(tile.id);
    navigateBoardTileFresh(tile.id);
    if (state.focused.boardTileId === tile.id) syncFocusPreview();
    cancelBoardEdit();
    persistWorkspace();
    setBoardStatus(`Updated ${tile.name}. Its position, size and zoom were preserved.`, 'success');
    return true;
  }
  const frame = getFrameDimensions(preset, preset.defaultOrientation);
  const x = 24 + (tiles.length % 6) * 36;
  const y = 24 + (tiles.length % 6) * 28;
  const tile = {
    id: createId('tile'),
    name: deriveTileName(normalizedUrl),
    url: normalizedUrl,
    deviceId: preset.id,
    orientation: preset.defaultOrientation,
    x,
    y,
    width: clampNumber(Math.min(frame.shellWidth + 48, elements.boardCanvas.clientWidth / (getBoardZoom() / 100) - x - 24), BOARD_MIN_WIDTH, BOARD_MAX_WIDTH),
    height: clampNumber(Math.min(frame.shellHeight + 110, elements.boardCanvas.clientHeight / (getBoardZoom() / 100) - y - 24), BOARD_MIN_HEIGHT, BOARD_MAX_HEIGHT),
    zoomPercent: 100,
  };
  tiles.push(tile);
  persistWorkspace();
  renderBoardTile(tile);
  bringBoardTileToFront(tile.id, { persist: false });
  syncBoardLayout();
  elements.boardUrl.value = '';
  setBoardStatus(`Added ${tile.name} as ${preset.label}. Drag the header to move it, or drag the corner to resize.`, 'success');
  return true;
}

function removeBoardTile(tileId) {
  if (state.boardEditingTileId === tileId) cancelBoardEdit();
  const tiles = getBoardTiles();
  const index = tiles.findIndex((tile) => tile.id === tileId);
  if (index === -1) {
    return;
  }
  const removed = tiles.splice(index, 1)[0];
  const ref = state.boardTileRefs.get(tileId);
  if (ref) {
    stageObserver.unobserve(ref.stage);
    ref.element.remove();
    state.boardTileRefs.delete(tileId);
  }
  if (state.focused.boardTileId === tileId) {
    closeFocusPreview();
  }
  persistWorkspace();
  setBoardStatus(`Removed ${removed.name} from the board.`, 'success');
  syncBoardLayout();
}

function rotateBoardTile(tileId) {
  const tile = getBoardTiles().find((item) => item.id === tileId);
  if (!tile) {
    return;
  }
  const preset = getPresetById(tile.deviceId);
  if (!preset.rotatable) {
    setBoardStatus(`${preset.label} cannot rotate.`, 'error');
    return;
  }
  tile.orientation = tile.orientation === 'portrait' ? 'landscape' : 'portrait';
  persistWorkspace();
  updateBoardTileGeometry(tileId);
  syncBoardTileScale(tileId);
  if (state.focused.boardTileId === tileId) {
    syncFocusPreview();
  }
}

function reloadBoardTiles() {
  state.boardTileRefs.forEach((ref) => {
    navigateBoardTileFresh(ref.tile.id);
  });
  if (state.focused.boardTileId) {
    syncFocusPreview();
  }
}

function navigateBoardTileFresh(tileId) {
  const ref = state.boardTileRefs.get(tileId);
  if (!ref) {
    return;
  }
  navigateFrameFresh(ref.iframe, ref.tile.url, { defer: state.mode !== 'board' || state.workspaceView !== 'preview' });
}

function renderBoard() {
  endBoardDrag();
  cancelBoardEdit();
  state.boardTileRefs.forEach((ref) => stageObserver.unobserve(ref.stage));
  state.boardTileRefs.clear();
  elements.boardWorld.innerHTML = '';
  getBoardTiles().forEach((tile) => renderBoardTile(tile));
  getBoardTiles().forEach((tile, index) => {
    state.boardTileRefs.get(tile.id).element.style.zIndex = String(10 + index);
  });
  syncAllBoardTileScales();
  syncBoardLayout();
}

function updateBoardTileGeometry(tileId) {
  const ref = state.boardTileRefs.get(tileId);
  if (!ref) {
    return;
  }
  const preset = getPresetById(ref.tile.deviceId);
  ref.preset = preset;
  ref.element.dataset.accent = preset.accent;
  ref.element.style.left = `${ref.tile.x}px`;
  ref.element.style.top = `${ref.tile.y}px`;
  ref.element.style.width = `${ref.tile.width}px`;
  ref.element.style.height = `${ref.tile.height}px`;
  ref.shell.dataset.frameKind = preset.frameKind;

  const frame = getFrameDimensions(preset, ref.tile.orientation);
  ref.shell.style.setProperty('--shell-width', `${frame.shellWidth}px`);
  ref.shell.style.setProperty('--shell-height', `${frame.shellHeight}px`);
  ref.shell.style.setProperty('--frame-width', `${frame.width}px`);
  ref.shell.style.setProperty('--frame-height', `${frame.height}px`);
  ref.shell.style.setProperty('--frame-radius', `${preset.frameRadius}px`);
  ref.canvas.style.setProperty('--frame-width', `${frame.width}px`);
  ref.canvas.style.setProperty('--frame-height', `${frame.height}px`);
  ref.canvas.style.setProperty('--frame-radius', `${preset.frameRadius}px`);
  ref.viewportDimensions.textContent = `${frame.width} × ${frame.height}`;
  ref.viewport.title = `Viewport: ${frame.width} × ${frame.height}`;
  ref.viewport.setAttribute('aria-label', ref.viewport.title);
  ref.iframe.title = `${preset.label} preview for ${ref.tile.name}`;
  ref.title.title = `${ref.tile.name}\n${preset.label} • ${ref.tile.orientation}\n${ref.tile.url}`;
  ref.stage.setAttribute('aria-label', `Open ${ref.tile.name} in fullscreen focus mode`);

  ref.rotateButton.hidden = !preset.rotatable;
  ref.element.querySelector('.board-tile__resize')?.setAttribute('aria-label', `Resize ${ref.tile.name}`);
}

function syncAllBoardTileScales() {
  state.boardTileRefs.forEach((ref, tileId) => syncBoardTileScale(tileId));
}

function syncBoardTileScale(tileId) {
  const ref = state.boardTileRefs.get(tileId);
  if (!ref || elements.boardPanel.hidden) {
    return;
  }
  ref.zoomControls.update();
  const shellWidth = Number.parseFloat(ref.shell.style.getPropertyValue('--shell-width'));
  const shellHeight = Number.parseFloat(ref.shell.style.getPropertyValue('--shell-height'));
  if (!shellWidth || !shellHeight) {
    return;
  }
  const finalScale = getFitScale({
    container: ref.stage,
    shellWidth,
    shellHeight,
    padding: CARD_STAGE_FIT_PADDING,
    maxScale: 1.35,
  }) * clampZoomPercent(Number(ref.tile.zoomPercent ?? 100)) / 100;
  applyPreviewScale(ref, finalScale, shellWidth, shellHeight);
}

function createTileIcon(name) {
  const paths = {
    focus: 'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5',
    rotate: 'M5 4h9v16H5zM9 17h1M18 5a6 6 0 0 1 3 7M18 2v3h3',
    reload: 'M20 7a8 8 0 1 0 0 10M20 2v5h-5',
    url: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
    open: 'M14 3h7v7M21 3l-11 11M10 3H3v18h18v-7',
    remove: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
    viewport: 'M3 5h18v14H3zM8 9H6v2M16 15h2v-2',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths[name]);
  svg.appendChild(path);
  return svg;
}

function setTileActionIcon(button, name, label, hint = label) {
  button.classList.add('board-tile__action');
  button.setAttribute('aria-label', label);
  button.title = hint;
  button.appendChild(createTileIcon(name));
}

function renderBoardTile(tile) {
  const preset = getPresetById(tile.deviceId);
  const element = document.createElement('article');
  element.className = 'board-tile';
  element.dataset.accent = preset.accent;

  const header = document.createElement('header');
  header.className = 'board-tile__header';
  const titleWrap = document.createElement('div');
  titleWrap.className = 'board-tile__title-wrap';
  const title = document.createElement('h3');
  title.className = 'board-tile__title';
  title.textContent = tile.name;
  title.title = tile.url;
  titleWrap.appendChild(title);

  const controls = document.createElement('div');
  controls.className = 'board-tile__controls';
  const viewport = document.createElement('span');
  viewport.className = 'device-card__viewport';
  const viewportDimensions = document.createElement('span');
  viewportDimensions.className = 'board-tile__dimensions';
  viewport.append(createTileIcon('viewport'), viewportDimensions);

  const focusButton = document.createElement('button');
  focusButton.type = 'button';
  focusButton.className = 'device-card__focus';
  setTileActionIcon(focusButton, 'focus', 'Focus', 'Focus this preview in fullscreen');
  focusButton.addEventListener('click', (event) => {
    event.stopPropagation();
    openFocusPreview(tile.deviceId, { fullscreen: true, boardTileId: tile.id });
  });

  const rotateButton = document.createElement('button');
  rotateButton.type = 'button';
  rotateButton.className = 'device-card__rotate';
  setTileActionIcon(rotateButton, 'rotate', 'Rotate', 'Rotate this device');
  rotateButton.addEventListener('click', (event) => {
    event.stopPropagation();
    rotateBoardTile(tile.id);
  });

  const reloadButton = document.createElement('button');
  reloadButton.type = 'button';
  reloadButton.className = 'device-card__rotate';
  setTileActionIcon(reloadButton, 'reload', 'Reload', 'Fresh reload this tile');
  reloadButton.addEventListener('click', (event) => {
    event.stopPropagation();
    navigateBoardTileFresh(tile.id);
  });

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'board-tile__remove';
  setTileActionIcon(removeButton, 'remove', 'Remove', 'Remove this tile');
  removeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    removeBoardTile(tile.id);
  });

  const zoomControls = createPreviewZoomControls(() => tile.name, () => clampZoomPercent(Number(tile.zoomPercent ?? 100)), value => {
    tile.zoomPercent = clampZoomPercent(value);
    persistWorkspace();
    animatePreviewZoom(stage);
    scheduleViewportSync();
  });

  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.className = 'device-card__rotate';
  setTileActionIcon(editButton, 'url', 'URL', 'Change this tile’s URL or device without losing its layout');
  editButton.addEventListener('click', () => {
    state.boardEditingTileId = tile.id;
    elements.boardUrl.value = tile.url;
    elements.boardDevice.value = tile.deviceId;
    elements.boardSubmit.textContent = 'Save tile URL';
    elements.boardCancelEdit.hidden = false;
    elements.boardUrl.focus();
    setBoardStatus(`Editing ${tile.name}. Paste a URL or pick a detected server, then save.`, 'info');
  });
  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'device-card__rotate';
  setTileActionIcon(openButton, 'open', 'Open', 'Open this target in a browser tab');
  openButton.addEventListener('click', () => window.open(createFreshPreviewUrl(tile.url), '_blank', 'noopener,noreferrer'));
  controls.append(viewport, zoomControls.element, focusButton, rotateButton, reloadButton, editButton, openButton, removeButton);
  header.append(titleWrap, controls);
  element.appendChild(header);
  elements.boardWorld.appendChild(element);

  const stage = document.createElement('div');
  stage.className = 'device-stage board-tile__stage';
  stage.tabIndex = 0;
  stage.setAttribute('role', 'button');
  stage.addEventListener('click', event => {
    if (event.target === stage) return;
    openFocusPreview(tile.deviceId, { fullscreen: true, boardTileId: tile.id });
  });
  stage.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    openFocusPreview(tile.deviceId, { fullscreen: true, boardTileId: tile.id });
  });
  const shell = document.createElement('div');
  shell.className = 'device-shell';
  shell.dataset.frameKind = preset.frameKind;
  const chrome = document.createElement('div');
  chrome.className = 'shell-chrome';
  const canvas = document.createElement('div');
  canvas.className = 'device-canvas';
  const iframe = document.createElement('iframe');
  iframe.className = 'device-frame';
  iframe.loading = 'eager';
  iframe.referrerPolicy = 'no-referrer';
  iframe.title = `${preset.label} preview for ${tile.name}`;
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads');
  canvas.appendChild(iframe);
  shell.append(chrome, canvas);
  stage.appendChild(shell);
  const surface = wrapPreviewSurface(stage, shell);
  element.appendChild(stage);

  const resizeHandle = document.createElement('button');
  resizeHandle.type = 'button';
  resizeHandle.className = 'board-tile__resize';
  resizeHandle.title = 'Drag to resize, or use arrow keys (Shift for larger steps)';
  resizeHandle.setAttribute('aria-label', `Resize ${tile.name}`);
  resizeHandle.addEventListener('keydown', event => {
    const deltas = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    const step = event.shiftKey ? 50 : 10;
    tile.width = clampNumber(tile.width + delta[0] * step, BOARD_MIN_WIDTH, BOARD_MAX_WIDTH);
    tile.height = clampNumber(tile.height + delta[1] * step, BOARD_MIN_HEIGHT, BOARD_MAX_HEIGHT);
    updateBoardTileGeometry(tile.id);
    persistWorkspace();
    scheduleViewportSync();
  });
  element.appendChild(resizeHandle);

  header.addEventListener('pointerdown', (event) => beginBoardDrag(event, tile.id, 'move'));
  resizeHandle.addEventListener('pointerdown', (event) => beginBoardDrag(event, tile.id, 'resize'));

  stageObserver.observe(stage);
  state.boardTileRefs.set(tile.id, { tile, preset, element, header, stage, shell, canvas, iframe, viewport, viewportDimensions, title, rotateButton, surface, zoomControls });
  updateBoardTileGeometry(tile.id);
  navigateBoardTileFresh(tile.id);
}

function beginBoardDrag(event, tileId, action) {
  if ((action === 'move' && event.target.closest('button, input, select')) || state.boardDrag) {
    return;
  }
  if (event.button !== undefined && event.button !== 0) {
    return;
  }
  const ref = state.boardTileRefs.get(tileId);
  if (!ref) {
    return;
  }
  flushBoardZoom();
  event.preventDefault();
  bringBoardTileToFront(tileId);
  state.boardDrag = {
    tileId,
    action,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: ref.tile.x,
    originY: ref.tile.y,
    originWidth: ref.tile.width,
    originHeight: ref.tile.height,
    scale: getBoardZoom() / 100,
    scrollLeft: elements.boardCanvas.scrollLeft,
    scrollTop: elements.boardCanvas.scrollTop,
    frame: 0,
    point: null,
    captureTarget: event.currentTarget,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
  ref.element.classList.add(action === 'move' ? 'board-tile--dragging' : 'board-tile--resizing');
  document.body.classList.add('board-dragging');
  window.addEventListener('pointermove', handleBoardDragMove);
  window.addEventListener('pointerup', endBoardDrag);
  window.addEventListener('pointercancel', endBoardDrag);
  event.currentTarget.addEventListener('lostpointercapture', endBoardDrag);
  window.addEventListener('blur', cancelBoardDrag);
}

function handleBoardDragMove(event) {
  const drag = state.boardDrag;
  if (!drag || event.pointerId !== drag.pointerId) {
    return;
  }
  drag.point = { x: event.clientX, y: event.clientY };
  if (!drag.frame) {
    drag.frame = window.requestAnimationFrame(applyBoardDragMove);
  }
}

function applyBoardDragMove() {
  const drag = state.boardDrag;
  if (!drag) return;
  drag.frame = 0;
  if (!drag.point) return;
  const ref = state.boardTileRefs.get(drag.tileId);
  if (!ref) {
    return;
  }
  const deltaX = (drag.point.x - drag.startX + elements.boardCanvas.scrollLeft - drag.scrollLeft) / drag.scale;
  const deltaY = (drag.point.y - drag.startY + elements.boardCanvas.scrollTop - drag.scrollTop) / drag.scale;
  if (drag.action === 'move') {
    ref.tile.x = clampNumber(drag.originX + deltaX, 0, 4000);
    ref.tile.y = clampNumber(drag.originY + deltaY, 0, 3000);
    ref.element.style.left = `${ref.tile.x}px`;
    ref.element.style.top = `${ref.tile.y}px`;
  } else {
    ref.tile.width = clampNumber(drag.originWidth + deltaX, BOARD_MIN_WIDTH, BOARD_MAX_WIDTH);
    ref.tile.height = clampNumber(drag.originHeight + deltaY, BOARD_MIN_HEIGHT, BOARD_MAX_HEIGHT);
    ref.element.style.width = `${ref.tile.width}px`;
    ref.element.style.height = `${ref.tile.height}px`;
    syncBoardTileScale(drag.tileId);
  }
  syncBoardLayout();
}

function endBoardDrag(event) {
  const drag = state.boardDrag;
  if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) {
    return;
  }
  if (drag.frame) window.cancelAnimationFrame(drag.frame);
  applyBoardDragMove();
  state.boardDrag = null;
  window.removeEventListener('pointermove', handleBoardDragMove);
  window.removeEventListener('pointerup', endBoardDrag);
  window.removeEventListener('pointercancel', endBoardDrag);
  window.removeEventListener('blur', cancelBoardDrag);
  drag.captureTarget.removeEventListener('lostpointercapture', endBoardDrag);
  if (drag.captureTarget.hasPointerCapture(drag.pointerId)) {
    drag.captureTarget.releasePointerCapture(drag.pointerId);
  }
  document.body.classList.remove('board-dragging');
  const ref = state.boardTileRefs.get(drag.tileId);
  if (ref) {
    ref.element.classList.remove('board-tile--dragging', 'board-tile--resizing');
  }
  persistWorkspace();
  syncBoardTileScale(drag.tileId);
}

function cancelBoardDrag() {
  endBoardDrag();
}

function cancelBoardEdit() {
  if (!state.boardEditingTileId) return;
  state.boardEditingTileId = null;
  elements.boardSubmit.textContent = 'Add server tile';
  elements.boardCancelEdit.hidden = true;
  elements.boardUrl.value = '';
}

function getBoardZoom() {
  return clampZoomPercent(Number(getActiveTab().boardZoomPercent ?? 100));
}

function getBoardExtent() {
  return getBoardTiles().reduce((size, tile) => ({
    width: Math.max(size.width, tile.x + tile.width + 24),
    height: Math.max(size.height, tile.y + tile.height + 24),
  }), { width: 1, height: 1 });
}

function syncBoardLayout() {
  if (elements.boardPanel.hidden || pendingBoardZoom) return;
  const scale = getBoardZoom() / 100;
  const extent = getBoardExtent();
  const width = Math.max(extent.width, elements.boardCanvas.clientWidth / scale);
  const height = Math.max(extent.height, elements.boardCanvas.clientHeight / scale);
  elements.boardWorld.style.width = `${width}px`;
  elements.boardWorld.style.height = `${height}px`;
  elements.boardWorld.style.transform = `scale(${scale})`;
  elements.boardWorld.dataset.scale = String(scale);
  elements.boardSpace.style.width = `${Math.ceil(width * scale)}px`;
  elements.boardSpace.style.height = `${Math.ceil(height * scale)}px`;
}

function setBoardZoom(value) {
  endBoardDrag();
  const canvas = elements.boardCanvas;
  if (!pendingBoardZoom) {
    const oldScale = Number(elements.boardWorld.dataset.scale) || getBoardZoom() / 100;
    boardZoomAnchor = {
      x: (canvas.scrollLeft + canvas.clientWidth / 2) / oldScale,
      y: (canvas.scrollTop + canvas.clientHeight / 2) / oldScale,
    };
    pendingBoardZoom = window.requestAnimationFrame(flushBoardZoom);
  }
  getActiveTab().boardZoomPercent = clampZoomPercent(value);
  updateZoomControls();
  persistWorkspace();
}

function flushBoardZoom() {
  if (!pendingBoardZoom) return;
  window.cancelAnimationFrame(pendingBoardZoom);
  pendingBoardZoom = 0;
  const canvas = elements.boardCanvas;
  const scale = getBoardZoom() / 100;
  syncBoardLayout();
  canvas.scrollLeft = boardZoomAnchor.x * scale - canvas.clientWidth / 2;
  canvas.scrollTop = boardZoomAnchor.y * scale - canvas.clientHeight / 2;
  boardZoomAnchor = null;
}

function fitBoard() {
  endBoardDrag();
  const extent = getBoardExtent();
  setBoardZoom(Math.floor(Math.min(elements.boardCanvas.clientWidth / extent.width, elements.boardCanvas.clientHeight / extent.height, 1) * 100));
  flushBoardZoom();
  elements.boardCanvas.scrollLeft = 0;
  elements.boardCanvas.scrollTop = 0;
}

function bringBoardTileToFront(tileId, options = {}) {
  const tiles = getBoardTiles();
  const index = tiles.findIndex((tile) => tile.id === tileId);
  if (index === -1) {
    return;
  }
  const moved = tiles.splice(index, 1)[0];
  tiles.push(moved);
  tiles.forEach((item, position) => {
    const ref = state.boardTileRefs.get(item.id);
    if (ref) {
      ref.element.style.zIndex = String(10 + position);
    }
  });
  if (options.persist !== false) {
    persistWorkspace();
  }
}

function setBoardStatus(message, stateName = 'info') {
  elements.boardStatus.textContent = message;
  elements.boardStatus.dataset.state = stateName;
}

async function refreshLocalServers(options = {}) {
  if (state.localScan.status === 'scanning') {
    return;
  }

  state.localScan.status = 'scanning';
  state.localScan.error = null;
  setScanButtons(true);
  renderLocalServerOptions('Scanning local servers…');

  try {
    const servers = await discoverLocalServers();
    state.localServers = servers;
    state.localScan.status = 'ready';
    state.localScan.scannedAt = new Date().toISOString();
    renderLocalServerOptions();

    if (!options.silent) {
      if (servers.length > 0) {
        setStatus(`Detected ${servers.length} running local server${servers.length === 1 ? '' : 's'}. Pick one from the dropdown.`, 'success');
      } else {
        setStatus('No running local web servers were detected. You can still type any URL manually.', 'error');
      }
      setBoardStatus(
        servers.length > 0
          ? `Detected ${servers.length} running local server${servers.length === 1 ? '' : 's'}. Pick one from either dropdown.`
          : 'No running local web servers were detected. You can still type any URL manually.',
        servers.length > 0 ? 'success' : 'error',
      );
    }
  } catch (error) {
    state.localScan.status = 'error';
    state.localScan.error = error instanceof Error ? error.message : 'scan failed';
    renderLocalServerOptions('Local scan unavailable — type a URL manually');
    if (!options.silent) {
      setStatus('Local server scan is unavailable here. You can still type any URL manually.', 'error');
    }
  } finally {
    setScanButtons(false);
  }
}

function setScanButtons(disabled) {
  elements.targetScan.disabled = disabled;
  elements.boardScan.disabled = disabled;
  elements.targetScan.textContent = disabled ? 'Scanning…' : 'Scan';
  elements.boardScan.textContent = disabled ? 'Scanning…' : 'Scan';
}

async function discoverLocalServers() {
  const fromApi = await fetchLocalServersFromApi();
  if (fromApi) {
    return fromApi;
  }
  return probeLocalServersFromBrowser();
}

async function fetchLocalServersFromApi() {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(LOCAL_SERVERS_ENDPOINT, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) {
      if (response.status !== 404) throw new Error('Local server discovery is unavailable. Try Scan again.');
      return null;
    }
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.servers)) {
      throw new Error('The local server scan returned an invalid response.');
    }
    return normalizeServerEntries(payload.servers);
  } catch (error) {
    if (['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname)) throw error;
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

function probeLocalServersFromBrowser() {
  const probes = [];
  LOCAL_FALLBACK_HOSTS.forEach((host) => {
    LOCAL_FALLBACK_PORTS.forEach((port) => {
      probes.push(probeLocalUrl(`http://${host}:${port}/`));
    });
  });
  return Promise.all(probes).then((results) => normalizeServerEntries(results.filter(Boolean)));
}

function probeLocalUrl(url) {
  return new Promise((resolve) => {
    let settled = false;
    const controller = new AbortController();
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      controller.abort();
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), LOCAL_PROBE_TIMEOUT_MS);
    fetch(url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: controller.signal })
      .then(() => finish({ url, title: null }))
      .catch(() => finish(null));
  });
}

function normalizeServerEntries(entries) {
  const seen = new Set();
  const servers = [];
  entries.forEach((entry) => {
    const normalizedUrl = normalizeUrl(typeof entry === 'string' ? entry : entry?.url ?? '');
    if (!normalizedUrl || seen.has(normalizedUrl)) {
      return;
    }
    seen.add(normalizedUrl);
    const title = typeof entry === 'object' && entry !== null && typeof entry.title === 'string' && entry.title.trim()
      ? entry.title.trim()
      : null;
    servers.push({ url: normalizedUrl, title });
  });
  return servers.sort((a, b) => a.url.localeCompare(b.url));
}

function renderLocalServerOptions(placeholder = null) {
  const servers = state.localServers;
  const scanning = state.localScan.status === 'scanning';
  const label = placeholder
    ?? (servers.length > 0 ? `Detected servers (${servers.length})` : 'No servers detected');

  [elements.targetPick, elements.boardPick].forEach((select) => {
    select.innerHTML = '';
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = scanning ? 'Scanning…' : label;
    select.appendChild(placeholderOption);

    servers.forEach((server) => {
      const option = document.createElement('option');
      option.value = server.url;
      option.textContent = server.title ? `${server.url} — ${server.title}` : server.url;
      select.appendChild(option);
    });
  });

  elements.serversList.innerHTML = '';
  servers.forEach((server) => {
    const option = document.createElement('option');
    option.value = server.url;
    option.label = server.title ?? server.url;
    elements.serversList.appendChild(option);
  });
}

function loadWorkspace() {
  const migrated = migrateLegacyWorkspace();
  let parsed = null;
  const rawValue = readStorage(STORAGE_KEYS.workspace);
  if (rawValue) {
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      parsed = null;
    }
  }

  if (parsed && Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
    state.tabs = parsed.tabs.map((tab, index) => normalizeTab(tab, index));
    ensureUniqueIds(state.tabs, 'tab');
    state.activeTabId = state.tabs.some((tab) => tab.id === parsed.activeTabId) ? parsed.activeTabId : state.tabs[0].id;
    state.mode = parsed.mode === 'board' ? 'board' : 'grid';
  } else if (migrated) {
    state.tabs = [migrated];
    state.activeTabId = migrated.id;
    state.mode = 'grid';
  } else {
    const fallbackTarget = normalizeUrl(new URLSearchParams(window.location.search).get('target') ?? '') ?? DEFAULT_TARGET_URL;
    const tab = {
      id: createId('tab'),
      name: 'Tab 1',
      targetUrl: fallbackTarget,
      orientations: {},
      zoomPercent: 100,
      boardTiles: [],
    };
    state.tabs = [tab];
    state.activeTabId = tab.id;
    state.mode = 'grid';
  }

  const queryTarget = normalizeUrl(new URLSearchParams(window.location.search).get('target') ?? '');
  if (queryTarget) {
    getActiveTab().targetUrl = queryTarget;
  }
  persistWorkspace();
}

function normalizeTab(tab, index) {
  const orientations = tab && typeof tab.orientations === 'object' && tab.orientations !== null ? { ...tab.orientations } : {};
  const boardTiles = Array.isArray(tab?.boardTiles) ? tab.boardTiles.map((tile) => normalizeBoardTile(tile)).filter(Boolean) : [];
  ensureUniqueIds(boardTiles, 'tile');
  return {
    id: typeof tab?.id === 'string' && tab.id ? tab.id : createId('tab'),
    name: typeof tab?.name === 'string' && tab.name.trim() ? tab.name.trim().slice(0, 48) : `Tab ${index + 1}`,
    targetUrl: normalizeUrl(tab?.targetUrl ?? '') ?? DEFAULT_TARGET_URL,
    orientations,
    zoomPercent: clampZoomPercent(Number(tab?.zoomPercent ?? 100)),
    deviceZooms: Object.fromEntries(DEVICE_PRESETS.map(preset => [preset.id, clampZoomPercent(Number(tab?.deviceZooms?.[preset.id] ?? 100))])),
    boardZoomPercent: clampZoomPercent(Number(tab?.boardZoomPercent ?? 100)),
    boardTiles,
  };
}

function ensureUniqueIds(items, prefix) {
  const seen = new Set();
  items.forEach(item => {
    if (seen.has(item.id)) item.id = createId(prefix);
    seen.add(item.id);
  });
}

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function normalizeBoardTile(tile) {
  const url = normalizeUrl(tile?.url ?? '');
  if (!url) {
    return null;
  }
  const preset = getPresetById(tile?.deviceId);
  const orientation = preset.rotatable && (tile?.orientation === 'landscape' || tile?.orientation === 'portrait') ? tile.orientation : preset.defaultOrientation;
  const frame = getFrameDimensions(preset, orientation);
  return {
    id: typeof tile?.id === 'string' && tile.id ? tile.id : createId('tile'),
    name: typeof tile?.name === 'string' && tile.name.trim() ? tile.name.trim().slice(0, 64) : deriveTileName(url),
    url,
    deviceId: preset.id,
    orientation,
    x: clampNumber(Number(tile?.x ?? 24), 0, 4000),
    y: clampNumber(Number(tile?.y ?? 24), 0, 3000),
    width: clampNumber(Number(tile?.width ?? frame.shellWidth + 48), BOARD_MIN_WIDTH, BOARD_MAX_WIDTH),
    height: clampNumber(Number(tile?.height ?? frame.shellHeight + 148), BOARD_MIN_HEIGHT, BOARD_MAX_HEIGHT),
    zoomPercent: clampZoomPercent(Number(tile?.zoomPercent ?? 100)),
  };
}

function migrateLegacyWorkspace() {
  try {
    const hasLegacy = localStorage.getItem(STORAGE_KEYS.targetUrl) || localStorage.getItem(STORAGE_KEYS.orientations) || localStorage.getItem(STORAGE_KEYS.scaleMode);
    if (!hasLegacy) {
      return null;
    }
    const storedTarget = normalizeUrl(localStorage.getItem(STORAGE_KEYS.targetUrl) ?? '') ?? DEFAULT_TARGET_URL;
    const storedZoom = clampZoomPercent(Number.parseInt(localStorage.getItem(STORAGE_KEYS.scaleMode) ?? '100', 10));
    let orientations = {};
    try {
      const parsedOrientations = JSON.parse(localStorage.getItem(STORAGE_KEYS.orientations) ?? '{}');
      orientations = typeof parsedOrientations === 'object' && parsedOrientations !== null ? parsedOrientations : {};
    } catch {
      orientations = {};
    }
    return {
      id: createId('tab'),
      name: 'Tab 1',
      targetUrl: storedTarget,
      orientations,
      zoomPercent: storedZoom,
      boardTiles: [],
    };
  } catch {
    return null;
  }
}

function persistWorkspace() {
  try {
    localStorage.setItem(STORAGE_KEYS.workspace, JSON.stringify({
      tabs: state.tabs,
      activeTabId: state.activeTabId,
      mode: state.mode,
    }));
  } catch {
    // Storage may be unavailable/private; the UI still works for this session.
  }
}
