import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchDdsLocalDefaults,
  fetchDdsLocalStatus,
  hasDdsBridge,
  startDdsLocal,
  stopDdsLocal,
  validateDdsLocalSettings,
} from '../utils/ddsLocalApi';
import { loadDdsLocalSettings, saveDdsLocalSettings } from '../utils/ddsLocalStorage';
import {
  DDS_POLL_INTERVAL_MS,
  DDS_STATUS,
  DDS_STATUS_LABELS,
  parseDdsStatusPayload,
} from '../utils/ddsLocalStatus';

const STATUS_AUTO_DISMISS_MS = 5000;

const DdsLocalControl = () => {
  const bridgeAvailable = useMemo(() => hasDdsBridge(), []);
  const [ddsDir, setDdsDir] = useState(() => loadDdsLocalSettings().ddsDir);
  const [wslDistro, setWslDistro] = useState(() => loadDdsLocalSettings().wslDistro);
  const [showWslDistro, setShowWslDistro] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(() => !loadDdsLocalSettings().ddsDir);
  const [pathValidated, setPathValidated] = useState(false);
  const [reach, setReach] = useState(DDS_STATUS.CHECKING);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ type: '', message: '' });
  const startupCheckDoneRef = useRef(false);

  const settings = useMemo(
    () => ({ ddsDir: ddsDir.trim(), wslDistro: wslDistro.trim() }),
    [ddsDir, wslDistro],
  );

  useEffect(() => {
    saveDdsLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    setPathValidated(false);
  }, [settings.ddsDir, settings.wslDistro]);

  const pollStatus = useCallback(async () => {
    if (!bridgeAvailable) {
      setReach(DDS_STATUS.UNSUPPORTED);
      return;
    }
    setReach((prev) =>
      prev === DDS_STATUS.RUNNING || prev === DDS_STATUS.STOPPED
        ? prev
        : DDS_STATUS.CHECKING,
    );
    try {
      const payload = await fetchDdsLocalStatus(settings);
      let next = parseDdsStatusPayload(payload, {
        hasBridge: bridgeAvailable,
        ddsDir: settings.ddsDir,
      });
      if (pathValidated && next === DDS_STATUS.UNCONFIGURED) {
        next = DDS_STATUS.STOPPED;
      }
      setReach(next);
    } catch {
      setReach(
        settings.ddsDir && pathValidated
          ? DDS_STATUS.STOPPED
          : settings.ddsDir
            ? DDS_STATUS.STOPPED
            : DDS_STATUS.UNCONFIGURED,
      );
    }
  }, [bridgeAvailable, settings, pathValidated]);

  useEffect(() => {
    pollStatus();
    const interval = setInterval(pollStatus, DDS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [pollStatus]);

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
      if (!toValidate.ddsDir) {
        if (!silent) {
          setStatus({ type: 'error', message: 'Enter the path to the dds folder.' });
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
          setReach(DDS_STATUS.STOPPED);
          pollStatus();
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
    [settings, pollStatus],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const defaults = await fetchDdsLocalDefaults();
      if (cancelled) return;

      if (defaults.platform === 'win32') {
        setShowWslDistro(true);
      }

      const nextDir = ddsDir.trim() || defaults.ddsDir || '';
      const nextWsl = wslDistro.trim() || defaults.wslDistro || '';

      if (!ddsDir.trim() && defaults.ddsDir) {
        setDdsDir(defaults.ddsDir);
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
        settings: { ddsDir: nextDir, wslDistro: nextWsl },
      });
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startup check once
  }, []);

  const canStart =
    bridgeAvailable &&
    pathValidated &&
    reach !== DDS_STATUS.RUNNING &&
    !busy;

  const canStop =
    bridgeAvailable &&
    Boolean(settings.ddsDir) &&
    reach === DDS_STATUS.RUNNING &&
    !busy;

  const handleValidate = () => runValidate({ silent: false });

  const handleStart = async () => {
    setBusy(true);
    setStatus({ type: '', message: '' });
    try {
      const result = await startDdsLocal(settings);
      if (result.ok) {
        setStatus({ type: '', message: '' });
        setReach(DDS_STATUS.RUNNING);
        setTimeout(pollStatus, 1500);
      } else {
        setStatus({
          type: 'error',
          message: result.error || 'Start failed.',
        });
      }
    } catch (err) {
      setStatus({ type: 'error', message: err.message || 'Start failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    setStatus({ type: '', message: '' });
    try {
      const result = await stopDdsLocal(settings);
      if (result.ok) {
        setStatus({ type: '', message: '' });
        setReach(DDS_STATUS.STOPPED);
        pollStatus();
      } else {
        setStatus({
          type: 'error',
          message: result.error || 'Stop failed.',
        });
      }
    } catch (err) {
      setStatus({ type: 'error', message: err.message || 'Stop failed.' });
    } finally {
      setBusy(false);
    }
  };

  const startDisabledReason =
    !bridgeAvailable
      ? DDS_STATUS_LABELS[DDS_STATUS.UNSUPPORTED]
      : !pathValidated
        ? 'Check path in Settings first'
        : reach === DDS_STATUS.RUNNING
          ? 'DDS already running — use Stop'
          : '';

  return (
    <section className="dds-local" aria-label="Local DDS">
      <div className="dds-local__head">
        <span className="dds-local__title-row">
          <span
            className={`dds-local__reach dds-local__reach--${reach}`}
            title={DDS_STATUS_LABELS[reach]}
            aria-label={DDS_STATUS_LABELS[reach]}
          />
          <span className="dds-local__title">Local DDS</span>
        </span>
        <div className="dds-local__actions">
          <button
            type="button"
            className={`dds-local__btn dds-local__btn--start${
              canStart ? ' dds-local__btn--start-ready' : ''
            }`}
            onClick={handleStart}
            disabled={!canStart}
            title={canStart ? 'Start local DDS' : startDisabledReason}
          >
            {busy ? '…' : 'Start'}
          </button>
          <button
            type="button"
            className="dds-local__btn dds-local__btn--stop"
            onClick={handleStop}
            disabled={!canStop}
            title={canStop ? 'Stop local DDS' : 'DDS not running'}
          >
            Stop
          </button>
          <button
            type="button"
            className="dds-local__btn dds-local__btn--settings"
            onClick={() => setSettingsOpen((o) => !o)}
            aria-expanded={settingsOpen}
            title="dds folder path and WSL options"
          >
            {settingsOpen ? '▴' : '▾'}
          </button>
        </div>
      </div>

      {settingsOpen && (
        <div className="dds-local__settings">
          <input
            id="dds-local-dir"
            type="text"
            className="dds-local__input"
            placeholder="Path to dds folder"
            value={ddsDir}
            onChange={(e) => setDdsDir(e.target.value)}
            disabled={busy}
            autoComplete="off"
            aria-label="dds folder path"
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
            disabled={busy || !settings.ddsDir}
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
