import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchDdsLocalDefaults,
  hasDdsBridge,
  validateDdsLocalSettings,
} from '../utils/ddsLocalApi';
import {
  captureDockerComposeDown,
  captureDockerComposeUp,
  dockerComposeDown,
  dockerComposeUp,
  fetchCaptureDockerComposeStatus,
  fetchDockerComposeStatus,
  hasDockerBridge,
} from '../utils/dockerComposeApi';
import { loadDdsLocalSettings, saveDdsLocalSettings } from '../utils/ddsLocalStorage';
import { isPageHidden } from '../utils/pageVisibility';
import {
  DDS_POLL_INTERVAL_MS,
  DDS_STATUS,
  parseDdsStatusPayload,
} from '../utils/ddsLocalStatus';

const STATUS_AUTO_DISMISS_MS = 5000;

const LocalStackContext = createContext(null);

/**
 * Local Docker stack (compose + capture): settings, status polling and actions. One instance is
 * shared by the sidebar Local Stack panel and the start card shown over the map while the stack is off,
 * and it keeps polling even when the right sidebar is collapsed.
 */
export function LocalStackProvider({ children }) {
  const ddsBridgeAvailable = useMemo(() => hasDdsBridge(), []);
  const dockerBridgeAvailable = useMemo(() => hasDockerBridge(), []);
  const bridgeAvailable = ddsBridgeAvailable && dockerBridgeAvailable;

  const [platformDir, setPlatformDir] = useState(() => loadDdsLocalSettings().platformDir);
  const [wslDistro, setWslDistro] = useState(() => loadDdsLocalSettings().wslDistro);
  const [showWslDistro, setShowWslDistro] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(() => !loadDdsLocalSettings().platformDir);
  // Settings that last passed validation; null when none has.
  const [validatedSettings, setValidatedSettings] = useState(null);
  const [dockerReach, setDockerReach] = useState(DDS_STATUS.CHECKING);
  const [captureReach, setCaptureReach] = useState(DDS_STATUS.CHECKING);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ type: '', message: '' });
  // Set while `docker compose up` runs, so the start card can show progress.
  const [dockerStarting, setDockerStarting] = useState(false);
  // The start card's "Continue without starting" (this session only).
  const [launchDismissed, setLaunchDismissed] = useState(false);
  const dismissLaunch = useCallback(() => setLaunchDismissed(true), []);
  // True once saved/default settings are loaded and the startup path check has finished,
  // so the start card does not flash "Set up" while that is still in progress.
  const [startupChecked, setStartupChecked] = useState(false);
  const startupCheckDoneRef = useRef(false);
  const pollInFlightRef = useRef(false);

  const settings = useMemo(
    () => ({ platformDir: platformDir.trim(), wslDistro: wslDistro.trim() }),
    [platformDir, wslDistro],
  );

  useEffect(() => {
    saveDdsLocalSettings(settings);
  }, [settings]);

  // The path counts as verified only while the current settings are the ones that were checked.
  // (A separate "settings changed -> unverified" effect raced the startup check and could undo it.)
  const pathValidated =
    validatedSettings != null &&
    validatedSettings.platformDir === settings.platformDir &&
    validatedSettings.wslDistro === settings.wslDistro;

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
      setReachIfChanged(setCaptureReach, DDS_STATUS.UNSUPPORTED);
      return;
    }

    if (!pathValidated) {
      setReachIfChanged(setDockerReach, DDS_STATUS.UNCONFIGURED);
      setReachIfChanged(setCaptureReach, DDS_STATUS.UNCONFIGURED);
      return;
    }

    if (pollInFlightRef.current) {
      return;
    }
    pollInFlightRef.current = true;

    try {
      const [dockerPayload, capturePayload] = await Promise.all([
        fetchDockerComposeStatus(settings),
        fetchCaptureDockerComposeStatus(settings),
      ]);
      setReachIfChanged(setDockerReach, reachFromPayload(dockerPayload, true));
      setReachIfChanged(setCaptureReach, reachFromPayload(capturePayload, true));
    } catch {
      setReachIfChanged(setDockerReach, DDS_STATUS.STOPPED);
      setReachIfChanged(setCaptureReach, DDS_STATUS.STOPPED);
    } finally {
      pollInFlightRef.current = false;
    }
  }, [bridgeAvailable, pathValidated, reachFromPayload, setReachIfChanged, settings]);

  useEffect(() => {
    if (!pathValidated) {
      setReachIfChanged(setDockerReach, DDS_STATUS.UNCONFIGURED);
      setReachIfChanged(setCaptureReach, DDS_STATUS.UNCONFIGURED);
      return undefined;
    }

    pollDockerStatus();
    const interval = setInterval(() => {
      if (!isPageHidden()) pollDockerStatus();
    }, DDS_POLL_INTERVAL_MS);
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
          setValidatedSettings({ platformDir: toValidate.platformDir, wslDistro: toValidate.wslDistro });
          setDockerReach(DDS_STATUS.STOPPED);
          setCaptureReach(DDS_STATUS.STOPPED);
          // Newly verified: the [pathValidated] effect starts polling. Already verified: poll now,
          // since this closure's pollDockerStatus only polls when the path was verified at render.
          if (pathValidated) pollDockerStatus();
          return true;
        }
        setValidatedSettings(null);
        setStatus({
          type: 'error',
          message: result.error || 'Invalid path.',
        });
        return false;
      } catch (err) {
        setValidatedSettings(null);
        setStatus({
          type: 'error',
          message: err.message || 'Check failed.',
        });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [settings, pathValidated, pollDockerStatus],
  );

  useEffect(() => {
    let cancelled = false;

    const startupCheck = async () => {
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
    };

    startupCheck().finally(() => {
      if (!cancelled) setStartupChecked(true);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startup check once
  }, []);

  const handleValidate = () => runValidate({ silent: false });

  const handleDockerStart = async () => {
    setBusy(true);
    setDockerStarting(true);
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
      setDockerStarting(false);
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

  const handleCaptureStart = async () => {
    setBusy(true);
    setStatus({ type: '', message: '' });
    try {
      const result = await captureDockerComposeUp(settings);
      if (result.ok) {
        setStatus({ type: '', message: '' });
        setCaptureReach(DDS_STATUS.RUNNING);
        setTimeout(pollDockerStatus, 2000);
      } else {
        setStatus({
          type: 'error',
          message: result.error || 'Capture start failed.',
        });
      }
    } catch (err) {
      setStatus({ type: 'error', message: err.message || 'Capture start failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleCaptureStop = async () => {
    setBusy(true);
    setStatus({ type: '', message: '' });
    try {
      const result = await captureDockerComposeDown(settings);
      if (result.ok) {
        setStatus({ type: '', message: '' });
        setCaptureReach(DDS_STATUS.STOPPED);
        pollDockerStatus();
      } else {
        setStatus({
          type: 'error',
          message: result.error || 'Capture stop failed.',
        });
      }
    } catch (err) {
      setStatus({ type: 'error', message: err.message || 'Capture stop failed.' });
    } finally {
      setBusy(false);
    }
  };

  const value = {
    bridgeAvailable,
    platformDir,
    setPlatformDir,
    wslDistro,
    setWslDistro,
    showWslDistro,
    settingsOpen,
    setSettingsOpen,
    settings,
    pathValidated,
    dockerReach,
    captureReach,
    busy,
    status,
    dockerStarting,
    launchDismissed,
    dismissLaunch,
    startupChecked,
    handleValidate,
    handleDockerStart,
    handleDockerStop,
    handleCaptureStart,
    handleCaptureStop,
  };

  return <LocalStackContext.Provider value={value}>{children}</LocalStackContext.Provider>;
}

export function useLocalStack() {
  const ctx = useContext(LocalStackContext);
  if (!ctx) {
    throw new Error('useLocalStack must be used within LocalStackProvider');
  }
  return ctx;
}
