import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchDdsLocalDefaults,
  hasDdsBridge,
  validateDdsLocalSettings,
} from '../utils/ddsLocalApi';
import {
  dockerComposeDown,
  dockerComposeUp,
  fetchDockerComposeStatus,
  hasDockerBridge,
} from '../utils/dockerComposeApi';
import { loadDdsLocalSettings, saveDdsLocalSettings } from '../utils/ddsLocalStorage';
import {
  DDS_POLL_INTERVAL_MS,
  DDS_STATUS,
  DDS_STATUS_LABELS,
  parseDdsStatusPayload,
} from '../utils/ddsLocalStatus';

const STATUS_AUTO_DISMISS_MS = 5000;
const PATH_INVALID_TITLE = 'Check path in Settings first';

/** One action per row: Start when stopped, Stop when running; Start disabled if path not verified. */
function StackRowActions({
  reach,
  pathValidated,
  bridgeAvailable,
  busy,
  onStart,
  onStop,
  startTitle,
  stopTitle,
}) {
  const isRunning = reach === DDS_STATUS.RUNNING;
  const startReady =
    bridgeAvailable &&
    pathValidated &&
    !busy &&
    !isRunning &&
    reach !== DDS_STATUS.CHECKING &&
    reach !== DDS_STATUS.UNSUPPORTED;

  if (isRunning) {
    const stopEnabled = bridgeAvailable && pathValidated && !busy;
    return (
      <button
        type="button"
        className="dds-local__btn dds-local__btn--stop"
        onClick={onStop}
        disabled={!stopEnabled}
        title={stopEnabled ? stopTitle : 'Stopping…'}
      >
        {busy ? '…' : 'Stop'}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`dds-local__btn dds-local__btn--start${
        startReady ? ' dds-local__btn--start-ready' : ''
      }`}
      onClick={onStart}
      disabled={!startReady}
      title={!pathValidated ? PATH_INVALID_TITLE : startTitle}
    >
      {busy ? '…' : 'Start'}
    </button>
  );
}

const DdsLocalControl = () => {
  const ddsBridgeAvailable = useMemo(() => hasDdsBridge(), []);
  const dockerBridgeAvailable = useMemo(() => hasDockerBridge(), []);
  const bridgeAvailable = ddsBridgeAvailable && dockerBridgeAvailable;

  const [platformDir, setPlatformDir] = useState(() => loadDdsLocalSettings().platformDir);
  const [wslDistro, setWslDistro] = useState(() => loadDdsLocalSettings().wslDistro);
  const [showWslDistro, setShowWslDistro] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(() => !loadDdsLocalSettings().platformDir);
  const [pathValidated, setPathValidated] = useState(false);
  const [dockerReach, setDockerReach] = useState(DDS_STATUS.CHECKING);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ type: '', message: '' });
  const startupCheckDoneRef = useRef(false);
  const pollInFlightRef = useRef(false);

  const settings = useMemo(
    () => ({ platformDir: platformDir.trim(), wslDistro: wslDistro.trim() }),
    [platformDir, wslDistro],
  );

  useEffect(() => {
    saveDdsLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    setPathValidated(false);
  }, [settings.platformDir, settings.wslDistro]);

  const reachFromPayload = useCallback(
    (payload, pathValid) => {
      let next = parseDdsStatusPayload(payload, {
        hasBridge: bridgeAvailable,
        platformDir: settings.platformDir,
      });
      if (pathValid && next === DDS_STATUS.UNCONFIGURED) {
        next = DDS_STATUS.STOPPED;
      }
      return next;
    },
    [bridgeAvailable, settings.platformDir],
  );

  const setReachIfChanged = useCallback((setter, next) => {
    setter((prev) => (prev === next ? prev : next));
  }, []);

  const pollDockerStatus = useCallback(async () => {
    if (!bridgeAvailable) {
      setReachIfChanged(setDockerReach, DDS_STATUS.UNSUPPORTED);
      return;
    }

    if (!pathValidated) {
      setReachIfChanged(setDockerReach, DDS_STATUS.UNCONFIGURED);
      return;
    }

    if (pollInFlightRef.current) {
      return;
    }
    pollInFlightRef.current = true;

    try {
      const dockerPayload = await fetchDockerComposeStatus(settings);
      setReachIfChanged(setDockerReach, reachFromPayload(dockerPayload, true));
    } catch {
      setReachIfChanged(setDockerReach, DDS_STATUS.STOPPED);
    } finally {
      pollInFlightRef.current = false;
    }
  }, [bridgeAvailable, pathValidated, reachFromPayload, setReachIfChanged, settings]);

  useEffect(() => {
    if (!pathValidated) {
      setReachIfChanged(setDockerReach, DDS_STATUS.UNCONFIGURED);
      return undefined;
    }

    pollDockerStatus();
    const interval = setInterval(pollDockerStatus, DDS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [pathValidated, pollDockerStatus, setReachIfChanged]);

  useEffect(() => {
    if (!status.message || status.type !== 'success') return undefined;
    const timer = setTimeout(() => {
      setStatus({ type: '', message: '' });
    }, STATUS_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [status.message, status.type]);

  const runValidate = useCallback(
    async ({ silent = false, settings: settingsOverride } = {}) => {
      const toValidate = settingsOverride || settings;
      if (!toValidate.platformDir) {
        if (!silent) {
          setStatus({
            type: 'error',
            message: 'Enter the path to the dds_robot_platform folder.',
          });
        }
        return false;
      }

      setBusy(true);
      if (!silent) {
        setStatus({ type: '', message: '' });
      }

      try {
        const result = await validateDdsLocalSettings(toValidate);
        if (result.valid) {
          if (!silent) {
            setStatus({ type: 'success', message: 'Verified' });
          }
          setSettingsOpen(false);
          setPathValidated(true);
          setDockerReach(DDS_STATUS.STOPPED);
          pollDockerStatus();
          return true;
        }
        setPathValidated(false);
        setStatus({
          type: 'error',
          message: result.error || 'Invalid path.',
        });
        return false;
      } catch (err) {
        setPathValidated(false);
        setStatus({
          type: 'error',
          message: err.message || 'Check failed.',
        });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [settings, pollDockerStatus],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const defaults = await fetchDdsLocalDefaults();
      if (cancelled) return;

      if (defaults.platform === 'win32') {
        setShowWslDistro(true);
      }

      const nextDir = platformDir.trim() || defaults.platformDir || '';
      const nextWsl = wslDistro.trim() || defaults.wslDistro || '';

      if (!platformDir.trim() && defaults.platformDir) {
        setPlatformDir(defaults.platformDir);
        setSettingsOpen(false);
      }
      if (!wslDistro.trim() && defaults.wslDistro) {
        setWslDistro(defaults.wslDistro);
      }

      if (startupCheckDoneRef.current || !bridgeAvailable || !nextDir) {
        return;
      }
      startupCheckDoneRef.current = true;

      await runValidate({
        silent: true,
        settings: { platformDir: nextDir, wslDistro: nextWsl },
      });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startup check once
  }, []);

  const handleValidate = () => runValidate({ silent: false });

  const handleDockerStart = async () => {
    setBusy(true);
    setStatus({ type: '', message: '' });
    try {
      const result = await dockerComposeUp(settings);
      if (result.ok) {
        setStatus({ type: '', message: '' });
        setDockerReach(DDS_STATUS.RUNNING);
        setTimeout(pollDockerStatus, 2000);
      } else {
        setStatus({
          type: 'error',
          message: result.error || 'Docker start failed.',
        });
      }
    } catch (err) {
      setStatus({ type: 'error', message: err.message || 'Docker start failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDockerStop = async () => {
    setBusy(true);
    setStatus({ type: '', message: '' });
    try {
      const result = await dockerComposeDown(settings);
      if (result.ok) {
        setStatus({ type: '', message: '' });
        setDockerReach(DDS_STATUS.STOPPED);
        pollDockerStatus();
      } else {
        setStatus({
          type: 'error',
          message: result.error || 'Docker stop failed.',
        });
      }
    } catch (err) {
      setStatus({ type: 'error', message: err.message || 'Docker stop failed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dds-local" aria-label="Local Stack">
      <div className="dds-local__head">
        <span className="dds-local__panel-title">Local Stack</span>
        <button
          type="button"
          className="dds-local__btn dds-local__btn--settings"
          onClick={() => setSettingsOpen((o) => !o)}
          aria-expanded={settingsOpen}
          title="Platform folder path and WSL options"
        >
          {settingsOpen ? '▴' : '▾'}
        </button>
      </div>

      <div className="dds-local__stack-row">
        <span className="dds-local__row-label">
          <span
            className={`dds-local__reach dds-local__reach--${dockerReach}`}
            title={DDS_STATUS_LABELS[dockerReach]}
            aria-label={`Docker: ${DDS_STATUS_LABELS[dockerReach]}`}
          />
          Docker
        </span>
        <div className="dds-local__row-actions">
          <StackRowActions
            reach={dockerReach}
            pathValidated={pathValidated}
            bridgeAvailable={bridgeAvailable}
            busy={busy}
            onStart={handleDockerStart}
            onStop={handleDockerStop}
            startTitle="Start Docker Compose"
            stopTitle="Stop Docker Compose"
          />
        </div>
      </div>

      {settingsOpen && (
        <div className="dds-local__settings">
          <input
            id="dds-local-dir"
            type="text"
            className="dds-local__input"
            placeholder="Path to dds_robot_platform"
            value={platformDir}
            onChange={(e) => setPlatformDir(e.target.value)}
            disabled={busy}
            autoComplete="off"
            aria-label="dds_robot_platform folder path"
          />
          {showWslDistro && (
            <input
              id="dds-local-wsl"
              type="text"
              className="dds-local__input dds-local__input--wsl"
              placeholder="WSL distro"
              value={wslDistro}
              onChange={(e) => setWslDistro(e.target.value)}
              disabled={busy}
              autoComplete="off"
              aria-label="WSL distro"
            />
          )}
          <button
            type="button"
            className="dds-local__btn dds-local__btn--check"
            onClick={handleValidate}
            disabled={busy || !settings.platformDir}
          >
            Check
          </button>
        </div>
      )}

      {status.message && (
        <p
          className={
            status.type === 'error'
              ? 'dds-local__status dds-local__status--error'
              : 'dds-local__status dds-local__status--success'
          }
          role="status"
        >
          {status.message}
        </p>
      )}
    </section>
  );
};

export default DdsLocalControl;
