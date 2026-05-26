const { spawn, spawnSync } = require('child_process');
const { normalizeDdsSettings } = require('./ddsLocalPaths');

function isWindows() {
  return process.platform === 'win32';
}

function getPlatform() {
  return process.platform;
}

function defaultWslDistro() {
  try {
    const result = spawnSync('wsl.exe', ['-l', '-q'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    const line = (result.stdout || '')
      .split(/\r?\n/)
      .map((l) => l.replace(/\0/g, '').trim())
      .find((l) => l.length > 0);
    if (line) return line;
  } catch {
    /* ignore */
  }
  return 'Ubuntu';
}

function effectiveWslDistro(settings) {
  const distro = normalizeDdsSettings(settings).wslDistro;
  return distro || defaultWslDistro();
}

function spawnShellCommand(innerCommand, settings, options = {}) {
  const { detached = false, sync = false, timeoutMs } = options;

  if (isWindows()) {
    const distro = effectiveWslDistro(settings);
    const wslArgs = ['-d', distro, '--', 'bash', '-lc', innerCommand];
    if (sync) {
      return spawnSync('wsl.exe', wslArgs, {
        encoding: 'utf8',
        timeout: timeoutMs,
        windowsHide: true,
      });
    }
    return spawn('wsl.exe', wslArgs, {
      detached,
      stdio: detached ? 'ignore' : 'pipe',
      windowsHide: true,
    });
  }

  const bashArgs = ['-lc', innerCommand];
  if (sync) {
    return spawnSync('bash', bashArgs, {
      encoding: 'utf8',
      timeout: timeoutMs,
    });
  }
  return spawn('bash', bashArgs, {
    detached,
    stdio: detached ? 'ignore' : 'pipe',
  });
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
function spawnShellCommandAsync(innerCommand, settings, options = {}) {
  const { timeoutMs } = options;

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
      child = spawnShellCommand(innerCommand, settings, { sync: false });
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
  spawnShellCommand,
  spawnShellCommandAsync,
  combineShellOutput,
};
