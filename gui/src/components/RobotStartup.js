import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApolloClient } from '@apollo/client';
import RobotPowerOffModal from './RobotPowerOffModal';
import {
  fetchRobotLauncherStatus,
  requestRobotLauncher,
  requestRobotSoftwareUpdate,
  summarizeSoftwareUpdateBody,
} from '../utils/robotLauncherApi';
import {
  fetchRobotHostStatus,
  requestRobotDockerStart,
  requestRobotDockerStop,
  requestRobotHostPowerOff,
  summarizeHostPowerOffBody,
} from '../utils/robotHostApi';
import { loadDdsLocalSettings } from '../utils/ddsLocalStorage';
import { syncMapFromRobot } from '../utils/mapSync';
import {
  DOCKER_STATUS,
  HOST_REACHABILITY,
  dockerStatusFromHostBody,
  hostReachabilityFromFetch,
} from '../utils/robotHostStatus';
import {
  createHostId,
  loadSavedHosts,
  normalizeHostInput,
  saveSavedHosts,
} from '../utils/robotLauncherStorage';
import {
  HOST_STATUS,
  POLL_INTERVAL_MS,
  SELECTED_POLL_INTERVAL_MS,
  STATUS_LABELS,
  combineRobotReach,
  parseLauncherStatusBody,
} from '../utils/robotLauncherStatus';

const STATUS_AUTO_DISMISS_MS = 5000;
/** Failed polls before the status dot / actions show unreachable. */
const HOST_OFFLINE_FAIL_THRESHOLD = 3;
const LAUNCHER_OFFLINE_FAIL_THRESHOLD = 3;

function SavedHostPicker({ hosts, reachByHost, selectedId, disabled, onSelect }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const selected = hosts.find((h) => h.id === selectedId);
  const selectedReach = selected
    ? reachByHost[selected.host] || HOST_STATUS.OFFLINE
    : null;
  const displayText = selected
    ? `${selected.label} (${selected.host})`
    : '— choose saved —';

  return (
    <div className="robot-startup__picker" ref={rootRef}>
      <button
        type="button"
        id="robot-startup-saved"
        className="robot-startup__picker-trigger"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected ? (
          <span
            className={`robot-startup__reach robot-startup__reach--${selectedReach}`}
            title={STATUS_LABELS[selectedReach]}
            aria-label={STATUS_LABELS[selectedReach]}
          />
        ) : null}
        <span className="robot-startup__picker-label">{displayText}</span>
        <span className="robot-startup__picker-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul className="robot-startup__picker-menu" role="listbox">
          <li role="option" aria-selected={!selectedId}>
            <button
              type="button"
              className="robot-startup__picker-item robot-startup__picker-item--plain"
              onClick={() => {
                onSelect('');
                setOpen(false);
              }}
            >
              — choose saved —
            </button>
          </li>
          {hosts.map((h) => {
            const reach = reachByHost[h.host] || HOST_STATUS.OFFLINE;
            return (
              <li key={h.id} role="option" aria-selected={h.id === selectedId}>
                <button
                  type="button"
                  className="robot-startup__picker-item"
                  onClick={() => {
                    onSelect(h.id);
                    setOpen(false);
                  }}
                >
                  <span
                    className={`robot-startup__reach robot-startup__reach--${reach}`}
                    title={STATUS_LABELS[reach]}
                    aria-label={STATUS_LABELS[reach]}
                  />
                  {h.label} ({h.host})
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RobotActionsMenu({
  disabled,
  disabledReason,
  busy,
  showDockerInMenu,
  canPowerOff,
  canSoftwareUpdate,
  powerOffDisabledReason,
  softwareUpdateDisabledReason,
  onPowerOff,
  onSoftwareUpdate,
  onDockerStop,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  return (
    <div className="robot-startup__actions-menu" ref={rootRef}>
      <button
        type="button"
        className="robot-startup__btn robot-startup__actions-menu-trigger"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={disabled ? disabledReason : 'Docker, power off, or update robot software'}
      >
        More <span aria-hidden>▾</span>
      </button>
      {open && !disabled && (
        <ul className="robot-startup__actions-menu-list" role="menu">
          {showDockerInMenu && (
            <li role="none">
              <button
                type="button"
                className="robot-startup__actions-menu-item robot-startup__actions-menu-item--docker"
                role="menuitem"
                disabled={busy}
                title="Stop the ROS Docker container"
                onClick={() => {
                  setOpen(false);
                  onDockerStop();
                }}
              >
                Docker Stop
              </button>
            </li>
          )}
          <li role="none">
            <button
              type="button"
              className="robot-startup__actions-menu-item robot-startup__actions-menu-item--poweroff"
              role="menuitem"
              disabled={busy || !canPowerOff}
              title={!canPowerOff && powerOffDisabledReason ? powerOffDisabledReason : undefined}
              onClick={() => {
                setOpen(false);
                onPowerOff();
              }}
            >
              Power Off
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              className="robot-startup__actions-menu-item robot-startup__actions-menu-item--update"
              role="menuitem"
              disabled={busy || !canSoftwareUpdate}
              title={
                !canSoftwareUpdate && softwareUpdateDisabledReason
                  ? softwareUpdateDisabledReason
                  : undefined
              }
              onClick={() => {
                setOpen(false);
                onSoftwareUpdate();
              }}
            >
              Software Update
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

const RobotStartup = () => {
  const apolloClient = useApolloClient();
  const [saved, setSaved] = useState(() => loadSavedHosts());
  const [selectedId, setSelectedId] = useState(saved.lastSelectedId || '');
  const [label, setLabel] = useState('');
  const [hostInput, setHostInput] = useState('');
  const [status, setStatus] = useState({ type: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [useSocialPlanner, setUseSocialPlanner] = useState(false);
  const [useMultiRobotPlanner, setUseMultiRobotPlanner] = useState(false);
  const [useKaist, setUseKaist] = useState(false);
  const [launcherStatus, setLauncherStatus] = useState({});
  const [hostReachability, setHostReachability] = useState({});
  const [dockerStatus, setDockerStatus] = useState({});
  const [powerOffOpen, setPowerOffOpen] = useState(false);
  const hostFailCountRef = useRef({});
  const launcherFailCountRef = useRef({});

  const activeHost = useMemo(() => normalizeHostInput(hostInput), [hostInput]);

  const pollHosts = useMemo(() => {
    const hosts = new Set(saved.hosts.map((h) => h.host));
    if (activeHost) hosts.add(activeHost);
    return [...hosts];
  }, [saved.hosts, activeHost]);

  const reachByHost = useMemo(() => {
    const map = {};
    for (const host of pollHosts) {
      map[host] = combineRobotReach(
        launcherStatus[host],
        hostReachability[host],
        dockerStatus[host],
      );
    }
    return map;
  }, [pollHosts, launcherStatus, hostReachability, dockerStatus]);

  const activeLauncherReach = useMemo(
    () =>
      activeHost
        ? launcherStatus[activeHost] || HOST_STATUS.OFFLINE
        : HOST_STATUS.OFFLINE,
    [activeHost, launcherStatus],
  );

  const activeReach = useMemo(
    () => (activeHost ? reachByHost[activeHost] || HOST_STATUS.OFFLINE : HOST_STATUS.OFFLINE),
    [activeHost, reachByHost],
  );

  const activeHostReach = useMemo(
    () =>
      activeHost
        ? hostReachability[activeHost] || HOST_REACHABILITY.OFFLINE
        : HOST_REACHABILITY.OFFLINE,
    [activeHost, hostReachability],
  );

  const activeDockerReach = useMemo(
    () =>
      activeHost ? dockerStatus[activeHost] || DOCKER_STATUS.UNKNOWN : DOCKER_STATUS.UNKNOWN,
    [activeHost, dockerStatus],
  );

  const pollHost = useCallback(async (host) => {
    const clean = normalizeHostInput(host);
    if (!clean) return;
    setLauncherStatus((prev) => {
      const current = prev[clean];
      // Keep last known status during refresh polls to avoid Start-button flicker.
      if (current === HOST_STATUS.AVAILABLE || current === HOST_STATUS.RUNNING) {
        return prev;
      }
      return { ...prev, [clean]: HOST_STATUS.CHECKING };
    });
    const result = await fetchRobotLauncherStatus(clean);
    const reach = result.ok
      ? parseLauncherStatusBody(result.body)
      : HOST_STATUS.OFFLINE;

    if (reach === HOST_STATUS.AVAILABLE || reach === HOST_STATUS.RUNNING) {
      launcherFailCountRef.current[clean] = 0;
    } else if (!result.ok || reach === HOST_STATUS.OFFLINE) {
      launcherFailCountRef.current[clean] = (launcherFailCountRef.current[clean] || 0) + 1;
    }

    setLauncherStatus((prev) => {
      const previous = prev[clean];
      if (
        reach === HOST_STATUS.OFFLINE &&
        (previous === HOST_STATUS.AVAILABLE || previous === HOST_STATUS.RUNNING) &&
        (launcherFailCountRef.current[clean] || 0) < LAUNCHER_OFFLINE_FAIL_THRESHOLD
      ) {
        return prev;
      }
      return { ...prev, [clean]: reach };
    });
  }, []);

  const pollHostService = useCallback(async (host) => {
    const clean = normalizeHostInput(host);
    if (!clean) return;
    setHostReachability((prev) => {
      const current = prev[clean];
      if (current === HOST_REACHABILITY.ONLINE) {
        return prev;
      }
      return { ...prev, [clean]: HOST_REACHABILITY.CHECKING };
    });
    const result = await fetchRobotHostStatus(clean);
    const reach = hostReachabilityFromFetch(result.ok, result.body);
    const docker = dockerStatusFromHostBody(result.body);

    if (reach === HOST_REACHABILITY.ONLINE) {
      hostFailCountRef.current[clean] = 0;
    } else if (result.ok === false) {
      const fails = (hostFailCountRef.current[clean] || 0) + 1;
      hostFailCountRef.current[clean] = fails;
    }

    setHostReachability((prev) => {
      const previous = prev[clean];
      if (
        reach === HOST_REACHABILITY.OFFLINE &&
        previous === HOST_REACHABILITY.ONLINE &&
        (hostFailCountRef.current[clean] || 0) < HOST_OFFLINE_FAIL_THRESHOLD
      ) {
        return prev;
      }
      return { ...prev, [clean]: reach };
    });
    setDockerStatus((prev) => {
      if (!result.ok && prev[clean] === DOCKER_STATUS.RUNNING) {
        return prev;
      }
      return { ...prev, [clean]: docker };
    });
  }, []);

  const refreshHostAndLauncher = useCallback(
    async (host) => {
      await Promise.all([pollHostService(host), pollHost(host)]);
    },
    [pollHost, pollHostService],
  );

  const backgroundPollHosts = useMemo(
    () => pollHosts.filter((host) => host !== activeHost),
    [pollHosts, activeHost],
  );

  const pollBackgroundHosts = useCallback(async () => {
    if (backgroundPollHosts.length === 0) return;

    setLauncherStatus((prev) => {
      const next = { ...prev };
      for (const host of backgroundPollHosts) {
        const current = prev[host];
        if (current !== HOST_STATUS.AVAILABLE && current !== HOST_STATUS.RUNNING) {
          next[host] = HOST_STATUS.CHECKING;
        }
      }
      return next;
    });

    await Promise.all(backgroundPollHosts.map((host) => pollHost(host)));
  }, [backgroundPollHosts, pollHost]);

  const pollBackgroundHostServices = useCallback(async () => {
    if (backgroundPollHosts.length === 0) return;

    setHostReachability((prev) => {
      const next = { ...prev };
      for (const host of backgroundPollHosts) {
        if (next[host] !== HOST_REACHABILITY.ONLINE) {
          next[host] = HOST_REACHABILITY.CHECKING;
        }
      }
      return next;
    });

    await Promise.all(backgroundPollHosts.map((host) => pollHostService(host)));
  }, [backgroundPollHosts, pollHostService]);

  useEffect(() => {
    saveSavedHosts(saved);
  }, [saved]);

  useEffect(() => {
    if (!status.message || status.type !== 'success') return undefined;
    const timer = setTimeout(() => {
      setStatus({ type: '', message: '' });
    }, STATUS_AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [status.message, status.type]);

  useEffect(() => {
    pollBackgroundHosts();
    pollBackgroundHostServices();
    const interval = setInterval(() => {
      pollBackgroundHosts();
      pollBackgroundHostServices();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [pollBackgroundHosts, pollBackgroundHostServices]);

  useEffect(() => {
    if (!activeHost) return undefined;
    pollHost(activeHost);
    pollHostService(activeHost);
    const interval = setInterval(() => {
      pollHost(activeHost);
      pollHostService(activeHost);
    }, SELECTED_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [activeHost, pollHost, pollHostService]);

  const applyEntry = useCallback((entry) => {
    if (!entry) return;
    setHostInput(entry.host);
    setLabel(entry.label || '');
    setSelectedId(entry.id);
    setSaved((prev) => ({ ...prev, lastSelectedId: entry.id }));
  }, []);

  useEffect(() => {
    const initial = loadSavedHosts();
    if (!initial.lastSelectedId) return;
    const entry = initial.hosts.find((h) => h.id === initial.lastSelectedId);
    if (entry) {
      setHostInput(entry.host);
      setLabel(entry.label || '');
      setSelectedId(entry.id);
    }
  }, []);

  const launcherReachable =
    activeLauncherReach === HOST_STATUS.AVAILABLE ||
    activeLauncherReach === HOST_STATUS.RUNNING;
  const hostServiceReachable = activeHostReach === HOST_REACHABILITY.ONLINE;
  const dockerRunning =
    activeDockerReach === DOCKER_STATUS.RUNNING ||
    activeLauncherReach === HOST_STATUS.AVAILABLE ||
    activeLauncherReach === HOST_STATUS.RUNNING;

  const hostOnlineForDocker =
    hostServiceReachable ||
    activeReach === HOST_STATUS.HOST_ONLINE ||
    activeReach === HOST_STATUS.AVAILABLE ||
    activeReach === HOST_STATUS.RUNNING;

  const usePrimaryDockerStart =
    Boolean(activeHost) &&
    hostOnlineForDocker &&
    !dockerRunning &&
    activeReach !== HOST_STATUS.OFFLINE &&
    activeReach !== HOST_STATUS.CHECKING;

  const canStart =
    Boolean(activeHost) &&
    activeLauncherReach === HOST_STATUS.AVAILABLE &&
    !busy;

  const canPrimaryDockerStart = usePrimaryDockerStart && !busy;
  const canPrimaryRosStart = !usePrimaryDockerStart && canStart;
  const primaryActionReady = canPrimaryDockerStart || canPrimaryRosStart;

  const startDisabledReason =
    !activeHost
      ? 'Enter a robot IP'
      : activeReach === HOST_STATUS.CHECKING
        ? 'Checking robot…'
        : activeReach === HOST_STATUS.RUNNING
          ? 'ROS is already running on this robot'
          : activeReach === HOST_STATUS.OFFLINE
            ? 'Robot unreachable (is it powered on?)'
            : dockerRunning && activeLauncherReach !== HOST_STATUS.AVAILABLE
              ? 'Waiting for robot launcher…'
              : !dockerRunning && !hostOnlineForDocker
                ? 'Robot host not reachable (is it powered on?)'
                : 'Robot launcher not reachable';

  const canShowMoreMenu =
    Boolean(activeHost) && (hostOnlineForDocker || launcherReachable) && !busy;

  const moreMenuDisabledReason = !activeHost
    ? 'Enter a robot IP'
    : activeReach === HOST_STATUS.CHECKING || activeHostReach === HOST_REACHABILITY.CHECKING
      ? 'Checking robot…'
      : !hostOnlineForDocker && !launcherReachable
        ? 'Robot host service and launcher not reachable'
        : '';

  const dockerDisabledReason = !activeHost
    ? 'Enter a robot IP'
    : activeHostReach === HOST_REACHABILITY.CHECKING
      ? 'Checking host service…'
      : !hostOnlineForDocker
        ? 'Host service not reachable (is port 8081 open?)'
        : '';

  const canPowerOff = hostOnlineForDocker && !busy;
  const powerOffDisabledReason = dockerDisabledReason;

  const canSoftwareUpdate = launcherReachable && !busy;
  const softwareUpdateDisabledReason = !activeHost
    ? 'Enter a robot IP'
    : activeLauncherReach === HOST_STATUS.CHECKING || activeReach === HOST_STATUS.CHECKING
      ? 'Checking robot…'
      : activeReach === HOST_STATUS.HOST_ONLINE
        ? 'Start Docker first'
        : !launcherReachable
          ? 'Robot launcher not reachable (start Docker first)'
          : '';

  const canSyncMap =
    Boolean(activeHost) && activeHostReach === HOST_REACHABILITY.ONLINE && !busy;

  const syncMapDisabledReason = !activeHost
    ? 'Enter a robot IP'
    : activeHostReach === HOST_REACHABILITY.CHECKING
      ? 'Checking robot…'
      : activeHostReach !== HOST_REACHABILITY.ONLINE
        ? 'Host service not reachable (port 8081)'
        : '';

  const activeHostLabel = useMemo(() => {
    const entry = saved.hosts.find((h) => h.id === selectedId);
    return (label || entry?.label || activeHost || '').trim();
  }, [saved.hosts, selectedId, label, activeHost]);

  const handleSyncMap = async () => {
    const host = normalizeHostInput(hostInput);
    if (!host) {
      setStatus({ type: 'error', message: 'Enter a robot IP.' });
      return;
    }

    const confirmLabel = activeHostLabel || host;
    const confirmed = window.confirm(
      `Replace the central map with the map from ${confirmLabel} (${host})? ` +
        'This updates the GUI and overwrites dds/user_map.json.',
    );
    if (!confirmed) return;

    setBusy(true);
    setStatus({ type: '', message: 'Syncing map…' });
    try {
      const platformSettings = loadDdsLocalSettings();
      const summary = await syncMapFromRobot({
        host,
        apolloClient,
        platformSettings,
      });
      let message =
        `Map synced (${summary.width}×${summary.height}, ${summary.resolution} m/px).`;
      if (summary.bytesWritten > 0) {
        message += ' Saved to user_map.json.';
      }
      if (summary.persistNote) {
        message += ` ${summary.persistNote}`;
      }
      setStatus({ type: 'success', message });
    } catch (err) {
      setStatus({
        type: 'error',
        message: err.message || 'Map sync failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handlePowerOffConfirm = async () => {
    const host = normalizeHostInput(hostInput);
    if (!host) {
      setStatus({ type: 'error', message: 'Enter a robot IP.' });
      return;
    }
    setBusy(true);
    setStatus({ type: '', message: '' });
    try {
      const result = await requestRobotHostPowerOff(host, '');
      if (result.ok) {
        setPowerOffOpen(false);
        setStatus({
          type: 'success',
          message: summarizeHostPowerOffBody(result.body),
        });
        setLauncherStatus((prev) => ({ ...prev, [host]: HOST_STATUS.OFFLINE }));
        setHostReachability((prev) => ({ ...prev, [host]: HOST_REACHABILITY.OFFLINE }));
        setDockerStatus((prev) => ({ ...prev, [host]: DOCKER_STATUS.STOPPED }));
      } else {
        setStatus({
          type: 'error',
          message: result.body
            ? `Power off failed: ${result.body}`
            : `Power off failed (HTTP ${result.status}).`,
        });
      }
    } catch (err) {
      setStatus({
        type: 'error',
        message: err.message || 'Power off request failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDockerStart = async () => {
    const host = normalizeHostInput(hostInput);
    if (!host) {
      setStatus({ type: 'error', message: 'Enter a robot IP.' });
      return;
    }
    setBusy(true);
    setStatus({ type: '', message: '' });
    try {
      const result = await requestRobotDockerStart(host);
      if (result.ok) {
        setStatus({
          type: 'success',
          message: result.body?.trim() || 'Docker container started.',
        });
        await refreshHostAndLauncher(host);
      } else {
        setStatus({
          type: 'error',
          message: result.body
            ? `Docker start failed: ${result.body}`
            : `Docker start failed (HTTP ${result.status}).`,
        });
      }
    } catch (err) {
      setStatus({
        type: 'error',
        message: err.message || 'Docker start request failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDockerStop = async () => {
    const host = normalizeHostInput(hostInput);
    if (!host) {
      setStatus({ type: 'error', message: 'Enter a robot IP.' });
      return;
    }
    setBusy(true);
    setStatus({ type: '', message: '' });
    try {
      const result = await requestRobotDockerStop(host);
      if (result.ok) {
        setStatus({
          type: 'success',
          message: result.body?.trim() || 'Docker container stopped.',
        });
        setLauncherStatus((prev) => ({ ...prev, [host]: HOST_STATUS.OFFLINE }));
        await refreshHostAndLauncher(host);
      } else {
        setStatus({
          type: 'error',
          message: result.body
            ? `Docker stop failed: ${result.body}`
            : `Docker stop failed (HTTP ${result.status}).`,
        });
      }
    } catch (err) {
      setStatus({
        type: 'error',
        message: err.message || 'Docker stop request failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSoftwareUpdate = async () => {
    const host = normalizeHostInput(hostInput);
    if (!host) {
      setStatus({ type: 'error', message: 'Enter a robot IP.' });
      return;
    }
    setBusy(true);
    setStatus({ type: '', message: '' });
    try {
      const result = await requestRobotSoftwareUpdate(host, {
        stopRos: true,
        build: true,
      });
      const summary = summarizeSoftwareUpdateBody(result.body);
      if (result.ok) {
        setStatus({ type: 'success', message: summary });
        fetchRobotLauncherStatus(host).then((r) => {
          if (r.ok) {
            setLauncherStatus((prev) => ({
              ...prev,
              [host]: parseLauncherStatusBody(r.body),
            }));
          }
        });
      } else {
        setStatus({
          type: 'error',
          message: summary || `Software update failed (HTTP ${result.status}).`,
        });
      }
    } catch (err) {
      setStatus({
        type: 'error',
        message: err.message || 'Software update request failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSelectSaved = (id) => {
    setSelectedId(id);
    if (!id) return;
    const entry = saved.hosts.find((h) => h.id === id);
    applyEntry(entry);
    pollHost(entry.host);
  };

  const handleRemoveSelected = () => {
    if (!selectedId) return;
    const removed = saved.hosts.find((h) => h.id === selectedId);
    setSaved((prev) => {
      const hosts = prev.hosts.filter((h) => h.id !== selectedId);
      const lastSelectedId =
        prev.lastSelectedId === selectedId ? (hosts[0]?.id ?? null) : prev.lastSelectedId;
      return { hosts, lastSelectedId };
    });
    setSelectedId('');
    if (removed && normalizeHostInput(hostInput) === removed.host) {
      setHostInput('');
      setLabel('');
    }
    setStatus({ type: 'success', message: 'Removed saved address.' });
  };

  const handleSaveHost = () => {
    const host = normalizeHostInput(hostInput);
    if (!host) {
      setStatus({ type: 'error', message: 'Enter a robot IP before saving.' });
      return;
    }
    const entryLabel = (label || host).trim();
    const existing = saved.hosts.find((h) => h.host === host);
    if (existing) {
      const updated = { ...existing, label: entryLabel };
      setSaved((prev) => ({
        ...prev,
        hosts: prev.hosts.map((h) => (h.id === existing.id ? updated : h)),
        lastSelectedId: existing.id,
      }));
      setSelectedId(existing.id);
      setStatus({ type: 'success', message: 'Saved address updated.' });
      return;
    }
    const id = createHostId();
    const entry = { id, label: entryLabel, host };
    setSaved((prev) => ({
      ...prev,
      hosts: [...prev.hosts, entry],
      lastSelectedId: id,
    }));
    setSelectedId(id);
    setStatus({ type: 'success', message: 'Address saved.' });
  };

  const handleStart = async () => {
    const host = normalizeHostInput(hostInput);
    if (!host) {
      setStatus({ type: 'error', message: 'Enter a robot IP.' });
      return;
    }
    setBusy(true);
    setStatus({ type: '', message: '' });
    try {
      const result = await requestRobotLauncher(host, '/start', {
        social: useSocialPlanner,
        multi: useMultiRobotPlanner,
        kaist: useKaist,
      });
      const detail = result.body ? `: ${result.body}` : '';
      if (result.ok) {
        setStatus({
          type: 'success',
          message: result.body?.trim() || 'ROS launch started successfully.',
        });
        setLauncherStatus((prev) => ({ ...prev, [host]: HOST_STATUS.RUNNING }));
        fetchRobotLauncherStatus(host).then((r) => {
          if (r.ok) {
            setLauncherStatus((prev) => ({
              ...prev,
              [host]: parseLauncherStatusBody(r.body),
            }));
          }
        });
      } else {
        setStatus({
          type: 'error',
          message: `Server returned ${result.status}${detail}`,
        });
      }
    } catch (err) {
      setStatus({
        type: 'error',
        message: err.message || 'Request failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="robot-startup" aria-label="Robot Startup">
      <h3 className="robot-startup__title">Robot Startup</h3>

      {saved.hosts.length > 0 && (
        <div className="robot-startup__field">
          <label className="robot-startup__label" htmlFor="robot-startup-saved">
            Saved addresses
          </label>
          <div className="robot-startup__saved-row">
            <SavedHostPicker
              hosts={saved.hosts}
              reachByHost={reachByHost}
              selectedId={selectedId}
              disabled={busy}
              onSelect={handleSelectSaved}
            />
            <button
              type="button"
              className="robot-startup__delete-saved"
              onClick={handleRemoveSelected}
              disabled={!selectedId || busy}
              aria-label="Remove saved address"
              title="Remove saved address"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div className="robot-startup__row">
        <div className="robot-startup__cell">
          <label className="robot-startup__label" htmlFor="robot-startup-label">
            Label
          </label>
          <input
            id="robot-startup-label"
            type="text"
            className="robot-startup__input"
            placeholder="e.g. Lab robot 1"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="robot-startup__cell robot-startup__cell--ip">
          <label className="robot-startup__label" htmlFor="robot-startup-host">
            Robot IP
            {activeHost ? (
              <span
                className={`robot-startup__reach robot-startup__reach--${activeReach}`}
                title={STATUS_LABELS[activeReach]}
                aria-label={STATUS_LABELS[activeReach]}
              />
            ) : null}
          </label>
          <input
            id="robot-startup-host"
            type="text"
            className="robot-startup__input"
            placeholder="192.168.1.10"
            value={hostInput}
            onChange={(e) => setHostInput(e.target.value)}
            autoComplete="off"
          />
        </div>
        <button
          type="button"
          className="robot-startup__btn robot-startup__btn--save"
          onClick={handleSaveHost}
          disabled={busy}
        >
          Save
        </button>
      </div>

      <div className="robot-startup__planner-settings">
        <p className="robot-startup__planner-settings-title">Planner Settings (beta)</p>
        <div className="robot-startup__planner-settings-row">
          <label
            className="robot-startup__planner-option"
            title="Unchecked uses regular A* planner; checked uses social planner"
          >
            <input
              type="checkbox"
              checked={useSocialPlanner}
              onChange={(e) => {
                const checked = e.target.checked;
                setUseSocialPlanner(checked);
                if (checked) setUseKaist(false);
              }}
              disabled={busy || usePrimaryDockerStart || useKaist}
            />
            Social
          </label>
          <label
            className="robot-startup__planner-option"
            title="Enable multi-robot planning on this robot at launch"
          >
            <input
              type="checkbox"
              checked={useMultiRobotPlanner}
              onChange={(e) => {
                const checked = e.target.checked;
                setUseMultiRobotPlanner(checked);
                if (checked) setUseKaist(false);
              }}
              disabled={busy || usePrimaryDockerStart || useKaist}
            />
            Multi
          </label>
          <label
            className="robot-startup__planner-option"
            title="Launch kaist.launch for KAIST collaborator robots"
          >
            <input
              type="checkbox"
              checked={useKaist}
              onChange={(e) => {
                const checked = e.target.checked;
                setUseKaist(checked);
                if (checked) {
                  setUseSocialPlanner(false);
                  setUseMultiRobotPlanner(false);
                }
              }}
              disabled={busy || usePrimaryDockerStart}
            />
            KAIST
          </label>
        </div>
      </div>

      <div className="robot-startup__actions">
        <button
          type="button"
          className={`robot-startup__btn robot-startup__btn--start${
            primaryActionReady ? ' robot-startup__btn--start-ready' : ''
          }`}
          onClick={usePrimaryDockerStart ? handleDockerStart : handleStart}
          disabled={!primaryActionReady}
          title={
            primaryActionReady
              ? usePrimaryDockerStart
                ? 'Start the ROS Docker container on this robot'
                : 'Start ROS on this robot (roslaunch via robot launcher)'
              : usePrimaryDockerStart
                ? dockerDisabledReason
                : startDisabledReason
          }
        >
          {busy && !powerOffOpen ? '…' : usePrimaryDockerStart ? 'Docker Start' : 'Start ROS'}
        </button>
        <button
          type="button"
          className="robot-startup__btn robot-startup__btn--sync-map"
          onClick={handleSyncMap}
          disabled={!canSyncMap}
          title={
            canSyncMap
              ? 'Fetch current_map.json from robot and update central map'
              : syncMapDisabledReason
          }
        >
          {busy ? '…' : 'Sync map'}
        </button>
        <RobotActionsMenu
          disabled={!canShowMoreMenu}
          disabledReason={moreMenuDisabledReason}
          busy={busy}
          showDockerInMenu={dockerRunning}
          canPowerOff={canPowerOff}
          canSoftwareUpdate={canSoftwareUpdate}
          powerOffDisabledReason={powerOffDisabledReason}
          softwareUpdateDisabledReason={softwareUpdateDisabledReason}
          onPowerOff={() => setPowerOffOpen(true)}
          onSoftwareUpdate={handleSoftwareUpdate}
          onDockerStop={handleDockerStop}
        />
      </div>

      <RobotPowerOffModal
        open={powerOffOpen}
        host={activeHost}
        label={label}
        busy={busy}
        onCancel={() => {
          if (!busy) {
            setPowerOffOpen(false);
          }
        }}
        onConfirm={handlePowerOffConfirm}
      />

      {status.message && (
        <p
          className={
            status.type === 'error'
              ? 'robot-startup__status robot-startup__status--error'
              : 'robot-startup__status robot-startup__status--success'
          }
          role="status"
        >
          {status.message}
        </p>
      )}
    </section>
  );
};

export default RobotStartup;
