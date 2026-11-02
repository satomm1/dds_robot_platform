const { spawn } = require('child_process');
const { normalizeDdsSettings } = require('./ddsLocalPaths');

const FALLBACK_WSL_DISTRO = 'Ubuntu';
const WSL_LIST_TIMEOUT_MS = 5000;

function isWindows() {
  return process.platform === 'win32';
}

function getPlatform() {
  return process.platform;
}

/** First distro from `wsl -l -q`, or null. Output is UTF-16, so strip NULs after decoding. */
function detectWslDistro() {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const finish = (distro) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(distro);
    };

    let child;
    try {
      child = spawn('wsl.exe', ['-l', '-q'], { windowsHide: true });
    } catch {
      resolve(null);
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish(null);
    }, WSL_LIST_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', () => finish(null));
    child.on('close', () => {
      const line = stdout
        .split(/\r?\n/)
        .map((l) => l.replace(/\0/g, '').trim())
        .find((l) => l.length > 0);
      finish(line || null);
    });
  });
}

// Cached for the app lifetime once detected; the fallback is not cached so a
// slow WSL cold start can be retried on the next call.
let detectedWslDistroPromise = null;

async function defaultWslDistro() {
  if (!detectedWslDistroPromise) {
    detectedWslDistroPromise = detectWslDistro();
  }
  const distro = await detectedWslDistroPromise;
  if (!distro) {
    detectedWslDistroPromise = null;
    return FALLBACK_WSL_DISTRO;
  }
  return distro;
}

async function effectiveWslDistro(settings) {
  const distro = normalizeDdsSettings(settings).wslDistro;
  return distro || defaultWslDistro();
}

/** Start `bash -lc` (inside WSL on Windows) with piped stdio. */
function spawnShellChild(innerCommand, distro) {
  if (isWindows()) {
    return spawn('wsl.exe', ['-d', distro, '--', 'bash', '-lc', innerCommand], {
      stdio: 'pipe',
      windowsHide: true,
    });
  }
  return spawn('bash', ['-lc', innerCommand], { stdio: 'pipe' });
}

function combineShellOutput(result) {
  return [result.stdout, result.stderr, result.error?.message]
    .filter(Boolean)
    .join(' ')
    .trim();
}

/**
 * Non-blocking shell run (does not freeze Electron main / dev-server event loop).
 * @returns {Promise<{ status: number|null, stdout: string, stderr: string, error?: Error }>}
 */
async function spawnShellCommandAsync(innerCommand, settings, options = {}) {
  const { timeoutMs } = options;
  const distro = isWindows() ? await effectiveWslDistro(settings) : '';

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };

    let child;
    try {
      child = spawnShellChild(innerCommand, distro);
    } catch (err) {
      finish({ status: null, stdout: '', stderr: '', error: err });
      return;
    }

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            try {
              child.kill();
            } catch {
              /* ignore */
            }
            finish({
              status: null,
              stdout,
              stderr,
              error: new Error('Shell command timed out.'),
            });
          }, timeoutMs)
        : null;

    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
    }

    child.on('error', (err) => {
      finish({ status: null, stdout, stderr, error: err });
    });

    child.on('close', (code) => {
      finish({ status: code, stdout, stderr });
    });
  });
}

module.exports = {
  isWindows,
  getPlatform,
  defaultWslDistro,
  effectiveWslDistro,
  spawnShellCommandAsync,
  combineShellOutput,
};
