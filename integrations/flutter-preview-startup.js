(() => {
  const preview = new URLSearchParams(window.location.search).has('__dpl_fresh');
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
  if (!preview || !loopback) return;
  const builds = window._flutter?.buildConfig?.builds;
  if (builds && !builds.some(build => build.compileTarget === 'dartdevc')) return;

  // Four debug views can otherwise enqueue thousands of DDC scripts at once.
  // Use the SDK's pool setting before its bootstrap begins loading libraries.
  let restoreConfig = null;
  const capRequests = config => {
    if (config && Number.isFinite(config.maxRequestPoolSize) && config.maxRequestPoolSize > 32) {
      config.maxRequestPoolSize = 32;
    }
  };
  const configureLoader = () => {
    const loader = window.$dartLoader;
    const descriptor = loader && Object.getOwnPropertyDescriptor(loader, 'loadConfig');
    if (!descriptor || !('value' in descriptor) || !descriptor.configurable || !descriptor.writable) return false;
    if (descriptor.value) {
      capRequests(descriptor.value);
    } else {
      restoreConfig = () => Object.defineProperty(loader, 'loadConfig', descriptor);
      Object.defineProperty(loader, 'loadConfig', {
        configurable: true, enumerable: descriptor.enumerable,
        get: () => descriptor.value,
        set: config => {
          capRequests(config);
          Object.defineProperty(loader, 'loadConfig', { ...descriptor, value: config });
          restoreConfig = null;
        },
      });
    }
    return true;
  };
  const loaderLoaded = event => {
    if (event.target?.tagName !== 'SCRIPT'
        || !new URL(event.target.src, window.location.href).pathname.endsWith('/ddc_module_loader.js')) return;
    if (configureLoader()) document.removeEventListener('load', loaderLoaded, true);
  };
  // Capture runs before the script's onload promise starts SDK initialization.
  if (!configureLoader()) document.addEventListener('load', loaderLoaded, true);

  const deadline = Date.now() + 30000;
  let readyAt = null;
  const stop = () => {
    clearInterval(timer);
    document.removeEventListener('load', loaderLoaded, true);
    restoreConfig?.();
    restoreConfig = null;
  };
  const timer = setInterval(() => {
    const builds = window._flutter?.buildConfig?.builds;
    if (builds && !builds.some(build => build.compileTarget === 'dartdevc')) {
      stop();
      return;
    }
    if (window.$dartMainExecuted) {
      stop();
      return;
    }
    if (Date.now() >= deadline) {
      stop();
      console.warn('Device Preview Lab: Flutter debug startup was not ready within 30 seconds.');
      return;
    }
    if (!window.$dwdsInitialized || typeof window.$dartRunMain !== 'function'
        || typeof window.$dartReadyToRunMain !== 'function') return;

    // Give the attached debugger its normal opportunity to start this page.
    readyAt ??= Date.now();
    if (Date.now() - readyAt < 750) return;
    stop();
    const startMain = window.$dartRunMain;
    // DWDS may deliver RunRequest later. Its generated entrypoint sets this flag;
    // honour it to avoid a second runApp, while allowing SDK-managed restarts.
    window.$dartRunMain = function (...args) {
      if (window.$dartMainExecuted) return;
      return Reflect.apply(startMain, this, args);
    };
    window.$dartRunMain();
  }, 100);
})();
