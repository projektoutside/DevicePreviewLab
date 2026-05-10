const STORAGE_KEYS = {
  targetUrl: 'device-preview.targetUrl',
  orientations: 'device-preview.orientations',
  scaleMode: 'device-preview.scaleMode',
};

const DEFAULT_TARGET_URL = 'http://127.0.0.1:8080';

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
  targetUrl: loadTargetUrl(),
  orientations: loadOrientations(),
  zoomPercent: loadZoomPercent(),
  focusedDeviceId: null,
  cardRefs: new Map(),
};

const elements = {
  form: document.querySelector('#preview-form'),
  targetUrl: document.querySelector('#target-url'),
  reloadAll: document.querySelector('#reload-all'),
  openTarget: document.querySelector('#open-target'),
  zoomSlider: document.querySelector('#zoom-slider'),
  zoomValue: document.querySelector('#zoom-value'),
  statusMessage: document.querySelector('#status-message'),
  deviceGrid: document.querySelector('#device-grid'),
  template: document.querySelector('#device-card-template'),
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

const stageObserver = new ResizeObserver(() => {
  syncAllCardScales();
  syncFocusScale();
});

bootstrap();

function bootstrap() {
  elements.targetUrl.value = state.targetUrl;
  elements.zoomSlider.value = String(state.zoomPercent);
  elements.zoomValue.textContent = `${state.zoomPercent}%`;

  renderCards();
  applyUrlToFrames(state.targetUrl, { announce: false });
  attachEvents();
  syncAllCardScales();

  setStatus(
    `Loaded device presets. Current target is ${state.targetUrl}.`,
    'success',
  );
}

function attachEvents() {
  elements.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const submittedUrl = elements.targetUrl.value.trim();
    if (!validateAndApplyUrl(submittedUrl)) {
      return;
    }
    setStatus(`Loaded ${submittedUrl} in all preview frames.`, 'success');
  });

  elements.reloadAll.addEventListener('click', () => {
    if (!validateAndApplyUrl(elements.targetUrl.value.trim())) {
      return;
    }
    reloadAllFrames();
    setStatus('Reloaded every preview frame.', 'success');
  });

  elements.openTarget.addEventListener('click', () => {
    const rawUrl = elements.targetUrl.value.trim();
    const normalizedUrl = normalizeUrl(rawUrl);
    if (!normalizedUrl) {
      setStatus('Enter a valid http or https URL before opening a new tab.', 'error');
      return;
    }

    window.open(normalizedUrl, '_blank', 'noopener,noreferrer');
    setStatus(`Opened ${normalizedUrl} in a new tab.`, 'success');
  });

  elements.zoomSlider.addEventListener('input', () => {
    state.zoomPercent = Number(elements.zoomSlider.value);
    localStorage.setItem(STORAGE_KEYS.scaleMode, String(state.zoomPercent));
    elements.zoomValue.textContent = `${state.zoomPercent}%`;
    syncAllCardScales();
    syncFocusScale();
  });

  elements.focusRotate.addEventListener('click', () => {
    if (state.focusedDeviceId) {
      toggleOrientation(state.focusedDeviceId);
      syncFocusPreview();
    }
  });

  elements.focusReload.addEventListener('click', () => {
    reloadFocusFrame();
    setStatus('Reloaded the focused preview.', 'success');
  });

  elements.focusFullscreen.addEventListener('click', () => {
    requestOverlayFullscreen();
  });

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

    card.dataset.deviceId = preset.id;
    card.dataset.accent = preset.accent;
    eyebrow.textContent = preset.subtitle;
    title.textContent = preset.label;
    shell.dataset.frameKind = preset.frameKind;
    iframe.title = `${preset.label} preview`;

    focusButton.addEventListener('click', () => {
      openFocusPreview(preset.id);
    });

    if (!preset.rotatable) {
      rotateButton.hidden = true;
    } else {
      rotateButton.addEventListener('click', () => {
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
    });

    fragment.appendChild(cardFragment);
    updateCardGeometry(preset.id);
  });

  elements.deviceGrid.appendChild(fragment);
  stageObserver.observe(elements.focusStage);
}

function toggleOrientation(deviceId) {
  const preset = DEVICE_PRESETS.find((item) => item.id === deviceId);
  if (!preset || !preset.rotatable) {
    return;
  }

  const currentOrientation = getOrientation(deviceId);
  state.orientations[deviceId] =
    currentOrientation === 'portrait' ? 'landscape' : 'portrait';
  persistOrientations();
  updateCardGeometry(deviceId);
  syncAllCardScales();
}

function getOrientation(deviceId) {
  return state.orientations[deviceId] ?? (
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
  const orientation = getOrientation(deviceId);
  const isLandscape = orientation === 'landscape';
  const frameWidth = preset.rotatable
    ? isLandscape
      ? preset.height
      : preset.width
    : preset.width;
  const frameHeight = preset.rotatable
    ? isLandscape
      ? preset.width
      : preset.height
    : preset.height;

  let shellPadding = 32;
  let chromeHeight = 0;

  if (preset.frameKind === 'browser') {
    shellPadding = 0;
    chromeHeight = 54;
  } else if (preset.frameKind === 'tablet') {
    shellPadding = 16;
  } else {
    shellPadding = 16;
  }

  const shellWidth = frameWidth + shellPadding * 2;
  const shellHeight = frameHeight + shellPadding * 2 + chromeHeight;

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
  const shellWidth = Number.parseFloat(
    shell.style.getPropertyValue('--shell-width'),
  );
  const shellHeight = Number.parseFloat(
    shell.style.getPropertyValue('--shell-height'),
  );

  if (!shellWidth || !shellHeight) {
    return;
  }

  const widthFit = (stage.clientWidth - 8) / shellWidth;
  const heightFit = (stage.clientHeight - 8) / shellHeight;
  const fitScale = Math.min(widthFit, heightFit, 1);
  const zoomScale = state.zoomPercent / 100;
  const finalScale = Math.max(0.28, Math.min(fitScale * zoomScale, 1.35));

  shell.style.transform = `translate(-50%, -50%) scale(${finalScale})`;
}

function syncFocusScale() {
  if (!state.focusedDeviceId || elements.focusOverlay.hidden) {
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

  const widthFit = (elements.focusStage.clientWidth - 12) / shellWidth;
  const heightFit = (elements.focusStage.clientHeight - 12) / shellHeight;
  const fitScale = Math.min(widthFit, heightFit, 1);
  const zoomScale = state.zoomPercent / 100;
  const finalScale = Math.max(0.28, Math.min(fitScale * zoomScale, 2));

  elements.focusShell.style.transform = `translate(-50%, -50%) scale(${finalScale})`;
}

function openFocusPreview(deviceId) {
  state.focusedDeviceId = deviceId;
  document.body.classList.add('focus-mode');
  elements.focusOverlay.hidden = false;
  elements.focusOverlay.setAttribute('aria-hidden', 'false');
  syncFocusPreview();
}

function closeFocusPreview() {
  state.focusedDeviceId = null;
  elements.focusOverlay.hidden = true;
  elements.focusOverlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('focus-mode');

  if (document.fullscreenElement === elements.focusOverlay) {
    document.exitFullscreen().catch(() => {
      // Ignore browser-specific fullscreen exit failures.
    });
  }
}

function syncFocusPreview() {
  if (!state.focusedDeviceId) {
    return;
  }

  const cardRef = state.cardRefs.get(state.focusedDeviceId);
  if (!cardRef) {
    return;
  }

  const { preset } = cardRef;
  const orientation = getOrientation(state.focusedDeviceId);
  const isLandscape = orientation === 'landscape';
  const frameWidth = preset.rotatable
    ? isLandscape
      ? preset.height
      : preset.width
    : preset.width;
  const frameHeight = preset.rotatable
    ? isLandscape
      ? preset.width
      : preset.height
    : preset.height;

  let shellPadding = 32;
  let chromeHeight = 0;

  if (preset.frameKind === 'browser') {
    shellPadding = 0;
    chromeHeight = 54;
  } else {
    shellPadding = 16;
  }

  const shellWidth = frameWidth + shellPadding * 2;
  const shellHeight = frameHeight + shellPadding * 2 + chromeHeight;

  elements.focusShell.dataset.frameKind = preset.frameKind;
  elements.focusShell.style.setProperty('--shell-width', `${shellWidth}px`);
  elements.focusShell.style.setProperty('--shell-height', `${shellHeight}px`);
  elements.focusShell.style.setProperty('--frame-width', `${frameWidth}px`);
  elements.focusShell.style.setProperty('--frame-height', `${frameHeight}px`);
  elements.focusShell.style.setProperty('--frame-radius', `${preset.frameRadius}px`);
  elements.focusCanvas.style.setProperty('--frame-width', `${frameWidth}px`);
  elements.focusCanvas.style.setProperty('--frame-height', `${frameHeight}px`);
  elements.focusCanvas.style.setProperty('--frame-radius', `${preset.frameRadius}px`);

  elements.focusEyebrow.textContent = preset.subtitle;
  elements.focusTitle.textContent = preset.label;
  elements.focusViewport.textContent = `${frameWidth} × ${frameHeight}`;
  elements.focusTarget.textContent = state.targetUrl;
  elements.focusFrame.src = state.targetUrl;
  elements.focusFrame.title = `${preset.label} focused preview`;
  elements.focusRotate.hidden = !preset.rotatable;

  syncFocusScale();
}

function reloadFocusFrame() {
  if (!state.focusedDeviceId) {
    return;
  }

  const currentUrl = elements.focusFrame.src || state.targetUrl;
  elements.focusFrame.src = 'about:blank';
  requestAnimationFrame(() => {
    elements.focusFrame.src = currentUrl;
  });
}

function requestOverlayFullscreen() {
  const fullscreenTarget = elements.focusOverlay;
  if (
    !fullscreenTarget ||
    document.fullscreenElement === fullscreenTarget ||
    typeof fullscreenTarget.requestFullscreen !== 'function'
  ) {
    return;
  }

  fullscreenTarget.requestFullscreen().catch(() => {
    // The overlay still covers the viewport even if the browser denies fullscreen.
  });
}

function validateAndApplyUrl(rawUrl) {
  const normalizedUrl = normalizeUrl(rawUrl);
  if (!normalizedUrl) {
    setStatus('Enter a valid http or https URL before loading previews.', 'error');
    return false;
  }

  state.targetUrl = normalizedUrl;
  elements.targetUrl.value = normalizedUrl;
  localStorage.setItem(STORAGE_KEYS.targetUrl, normalizedUrl);
  applyUrlToFrames(normalizedUrl, { announce: true });
  return true;
}

function applyUrlToFrames(url, { announce }) {
  state.cardRefs.forEach(({ iframe }) => {
    iframe.src = url;
  });

  if (state.focusedDeviceId) {
    elements.focusFrame.src = url;
    elements.focusTarget.textContent = url;
  }

  if (announce) {
    setStatus(`Loaded ${url} in all preview frames.`, 'success');
  }
}

function reloadAllFrames() {
  state.cardRefs.forEach(({ iframe }) => {
    const currentUrl = iframe.src || state.targetUrl;
    iframe.src = 'about:blank';
    requestAnimationFrame(() => {
      iframe.src = currentUrl;
    });
  });

  reloadFocusFrame();
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

function loadTargetUrl() {
  const queryTarget = new URLSearchParams(window.location.search).get('target');
  const normalizedQueryTarget = normalizeUrl(queryTarget ?? '');
  if (normalizedQueryTarget) {
    localStorage.setItem(STORAGE_KEYS.targetUrl, normalizedQueryTarget);
    return normalizedQueryTarget;
  }

  const storedValue = localStorage.getItem(STORAGE_KEYS.targetUrl);
  return normalizeUrl(storedValue ?? '') ?? DEFAULT_TARGET_URL;
}

function loadOrientations() {
  const rawValue = localStorage.getItem(STORAGE_KEYS.orientations);
  if (!rawValue) {
    return {};
  }

  try {
    const parsedValue = JSON.parse(rawValue);
    return typeof parsedValue === 'object' && parsedValue !== null
      ? parsedValue
      : {};
  } catch {
    return {};
  }
}

function loadZoomPercent() {
  const rawValue = localStorage.getItem(STORAGE_KEYS.scaleMode);
  const parsedValue = Number.parseInt(rawValue ?? '100', 10);
  if (Number.isNaN(parsedValue)) {
    return 100;
  }
  return Math.min(130, Math.max(60, parsedValue));
}

function persistOrientations() {
  localStorage.setItem(
    STORAGE_KEYS.orientations,
    JSON.stringify(state.orientations),
  );
}
