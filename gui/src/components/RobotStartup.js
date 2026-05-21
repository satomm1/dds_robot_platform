import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchRobotLauncherStatus, requestRobotLauncher } from '../utils/robotLauncherApi';
import {
  createHostId,
  loadSavedHosts,
  normalizeHostInput,
  saveSavedHosts,
} from '../utils/robotLauncherStorage';
import {
  HOST_STATUS,
  POLL_INTERVAL_MS,
  STATUS_LABELS,
  parseLauncherStatusBody,
} from '../utils/robotLauncherStatus';

const STATUS_AUTO_DISMISS_MS = 5000;

function SavedHostPicker({ hosts, hostStatus, selectedId, disabled, onSelect }) {
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
    ? hostStatus[selected.host] || HOST_STATUS.OFFLINE
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
            aria-hidden
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
            const reach = hostStatus[h.host] || HOST_STATUS.OFFLINE;
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
                    aria-hidden
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

const RobotStartup = () => {
  const [saved, setSaved] = useState(() => loadSavedHosts());
  const [selectedId, setSelectedId] = useState(saved.lastSelectedId || '');
  const [label, setLabel] = useState('');
  const [hostInput, setHostInput] = useState('');
  const [status, setStatus] = useState({ type: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [hostStatus, setHostStatus] = useState({});

  const activeHost = useMemo(() => normalizeHostInput(hostInput), [hostInput]);

  const pollHosts = useMemo(() => {
    const hosts = new Set(saved.hosts.map((h) => h.host));
    if (activeHost) hosts.add(activeHost);
    return [...hosts];
  }, [saved.hosts, activeHost]);

  const pollHost = useCallback(async (host) => {
    const clean = normalizeHostInput(host);
    if (!clean) return;
    setHostStatus((prev) => ({ ...prev, [clean]: HOST_STATUS.CHECKING }));
    const result = await fetchRobotLauncherStatus(clean);
    const reach = result.ok
      ? parseLauncherStatusBody(result.body)
      : HOST_STATUS.OFFLINE;
    setHostStatus((prev) => ({ ...prev, [clean]: reach }));
  }, []);

  const pollAllHosts = useCallback(async () => {
    if (pollHosts.length === 0) return;

    setHostStatus((prev) => {
      const next = { ...prev };
      for (const host of pollHosts) {
        next[host] = HOST_STATUS.CHECKING;
      }
      return next;
    });

    await Promise.all(pollHosts.map((host) => pollHost(host)));
  }, [pollHosts, pollHost]);

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
    pollAllHosts();
    const interval = setInterval(pollAllHosts, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [pollAllHosts]);

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

  const activeReach = activeHost
    ? hostStatus[activeHost] || HOST_STATUS.OFFLINE
    : HOST_STATUS.OFFLINE;

  const canStart =
    Boolean(activeHost) &&
    activeReach === HOST_STATUS.AVAILABLE &&
    !busy;

  const startDisabledReason =
    !activeHost
      ? 'Enter a robot IP'
      : activeReach === HOST_STATUS.CHECKING
        ? 'Checking robot…'
        : activeReach === HOST_STATUS.RUNNING
          ? 'ROS is already running on this robot'
          : activeReach === HOST_STATUS.OFFLINE
            ? 'Robot launcher not reachable (is the robot on?)'
            : '';

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
      const result = await requestRobotLauncher(host, '/start');
      const detail = result.body ? `: ${result.body}` : '';
      if (result.ok) {
        setStatus({
          type: 'success',
          message: result.body?.trim() || 'ROS launch started successfully.',
        });
        setHostStatus((prev) => ({ ...prev, [host]: HOST_STATUS.RUNNING }));
        fetchRobotLauncherStatus(host).then((r) => {
          if (r.ok) {
            setHostStatus((prev) => ({
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
              hostStatus={hostStatus}
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

      <div className="robot-startup__start-wrap">
        <button
          type="button"
          className={`robot-startup__btn robot-startup__btn--start${
            canStart ? ' robot-startup__btn--start-ready' : ''
          }`}
          onClick={handleStart}
          disabled={!canStart}
          title={canStart ? 'Start ROS launch on this robot' : startDisabledReason}
        >
          {busy ? '…' : 'Start'}
        </button>
      </div>

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
