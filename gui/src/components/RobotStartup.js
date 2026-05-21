import React, { useCallback, useEffect, useState } from 'react';
import { requestRobotLauncher } from '../utils/robotLauncherApi';
import {
  createHostId,
  loadSavedHosts,
  normalizeHostInput,
  saveSavedHosts,
} from '../utils/robotLauncherStorage';

const STATUS_AUTO_DISMISS_MS = 5000;

const RobotStartup = () => {
  const [saved, setSaved] = useState(() => loadSavedHosts());
  const [selectedId, setSelectedId] = useState(saved.lastSelectedId || '');
  const [label, setLabel] = useState('');
  const [hostInput, setHostInput] = useState('');
  const [status, setStatus] = useState({ type: '', message: '' });
  const [busy, setBusy] = useState(false);

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

  const handleSelectSaved = (e) => {
    const id = e.target.value;
    setSelectedId(id);
    if (!id) return;
    const entry = saved.hosts.find((h) => h.id === id);
    applyEntry(entry);
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
            <select
              id="robot-startup-saved"
              className="robot-startup__select"
              value={selectedId}
              onChange={handleSelectSaved}
            >
              <option value="">— choose saved —</option>
              {saved.hosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label} ({h.host})
                </option>
              ))}
            </select>
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
          className="robot-startup__btn robot-startup__btn--start"
          onClick={handleStart}
          disabled={busy}
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
