import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadDdsLocalSettings } from '../utils/ddsLocalStorage';
import { hasMapLibraryBridge, listSavedMaps, deleteSavedMap } from '../utils/ddsLocalApi';
import { loadSavedMapToCentral, syncMapFromRobot } from '../utils/mapSync';

function formatMapOptionLabel(entry) {
  const dims =
    entry.width > 0 && entry.height > 0
      ? `${entry.width}×${entry.height}`
      : 'unknown size';
  const res =
    typeof entry.resolution === 'number' ? `, ${entry.resolution} m/px` : '';
  return `${entry.name} (${dims}${res})`;
}

function SavedMapPicker({
  maps,
  activeMapId,
  selectedId,
  disabled,
  onSelect,
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

  const selected = maps.find((m) => m.id === selectedId);
  const displayText = selected ? formatMapOptionLabel(selected) : '— choose saved map —';

  return (
    <div className="central-maps__picker" ref={rootRef}>
      <button
        type="button"
        id="central-maps-saved"
        className="central-maps__picker-trigger"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled || maps.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected && selected.id === activeMapId ? (
          <span className="central-maps__active-dot" title="Active map" aria-label="Active map" />
        ) : null}
        <span className="central-maps__picker-label">{displayText}</span>
        <span className="central-maps__picker-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && maps.length > 0 && (
        <ul className="central-maps__picker-menu" role="listbox">
          <li role="option" aria-selected={!selectedId}>
            <button
              type="button"
              className="central-maps__picker-item central-maps__picker-item--plain"
              onClick={() => {
                onSelect('');
                setOpen(false);
              }}
            >
              — choose saved map —
            </button>
          </li>
          {maps.map((entry) => (
            <li key={entry.id} role="option" aria-selected={entry.id === selectedId}>
              <button
                type="button"
                className="central-maps__picker-item"
                onClick={() => {
                  onSelect(entry.id);
                  setOpen(false);
                }}
              >
                {entry.id === activeMapId ? (
                  <span className="central-maps__active-dot" title="Active map" aria-hidden />
                ) : (
                  <span className="central-maps__active-dot central-maps__active-dot--spacer" aria-hidden />
                )}
                {formatMapOptionLabel(entry)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const CentralMapSection = ({
  apolloClient,
  busy,
  setBusy,
  setStatus,
  canSyncMap,
  syncMapDisabledReason,
  activeHost,
  activeHostLabel,
  hostInput,
}) => {
  const [mapName, setMapName] = useState('');
  const [savedMaps, setSavedMaps] = useState([]);
  const [activeMapId, setActiveMapId] = useState(null);
  const [selectedMapId, setSelectedMapId] = useState('');
  const [libraryNote, setLibraryNote] = useState('');
  const [ddsDirHint, setDdsDirHint] = useState('');
  const [expanded, setExpanded] = useState(false);

  const hasLibrary = hasMapLibraryBridge();

  const defaultMapName = useMemo(() => {
    if (activeHostLabel) return `${activeHostLabel} map`;
    if (activeHost) return `${activeHost} map`;
    return '';
  }, [activeHost, activeHostLabel]);

  useEffect(() => {
    setMapName(defaultMapName);
  }, [defaultMapName]);

  const refreshSavedMaps = useCallback(async () => {
    if (!hasLibrary) {
      setLibraryNote('');
      setSavedMaps([]);
      setActiveMapId(null);
      setDdsDirHint('');
      return;
    }

    const platformSettings = loadDdsLocalSettings();
    if (!platformSettings.platformDir) {
      setLibraryNote('Set the platform folder in Local Stack to use saved maps.');
      setSavedMaps([]);
      setActiveMapId(null);
      setDdsDirHint('');
      return;
    }

    const result = await listSavedMaps(platformSettings);
    if (!result.ok) {
      setLibraryNote(result.error || 'Could not load saved maps.');
      setSavedMaps([]);
      setActiveMapId(null);
      setDdsDirHint('');
      return;
    }

    setLibraryNote('');
    setSavedMaps(result.maps || []);
    setActiveMapId(result.activeMapId || null);
    setSelectedMapId((prev) => prev || result.activeMapId || '');
    if (result.ddsDir) {
      setDdsDirHint(result.ddsDir);
    }
  }, [hasLibrary]);

  useEffect(() => {
    refreshSavedMaps();
  }, [refreshSavedMaps]);

  const canLoadSavedMap =
    Boolean(selectedMapId) && hasLibrary && !busy && savedMaps.length > 0;

  const canDeleteSavedMap = canLoadSavedMap;

  const loadDisabledReason = !hasLibrary
    ? 'Saved maps require the Electron app'
    : savedMaps.length === 0
      ? 'No saved maps yet'
      : !selectedMapId
        ? 'Choose a saved map'
        : '';

  const canSyncWithName = canSyncMap && mapName.trim().length > 0;

  const syncDisabledReason = !mapName.trim()
    ? 'Enter a map name'
    : syncMapDisabledReason;

  const handleSyncMap = async () => {
    const host = (hostInput || '').trim();
    if (!host) {
      setStatus({ type: 'error', message: 'Enter a robot IP.' });
      return;
    }

    const trimmedName = mapName.trim();
    if (!trimmedName) {
      setStatus({ type: 'error', message: 'Enter a map name before syncing.' });
      return;
    }

    const confirmLabel = activeHostLabel || host;
    const existing = savedMaps.find(
      (m) => String(m.name).toLowerCase() === trimmedName.toLowerCase(),
    );
    const overwriteNote = existing
      ? ` This will update the saved map "${existing.name}".`
      : '';

    const confirmed = window.confirm(
      `Sync map from ${confirmLabel} (${host}) as "${trimmedName}"? ` +
        'This updates the GUI, saves to the map library, and overwrites dds/user_map.json.' +
        overwriteNote,
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
        mapName: trimmedName,
      });
      let message =
        `Map "${summary.savedName || trimmedName}" synced ` +
        `(${summary.width}×${summary.height}, ${summary.resolution} m/px).`;
      if (summary.bytesWritten > 0) {
        message += ' Saved to map library and user_map.json.';
        if (summary.savedPath) {
          message += ` (${summary.savedPath})`;
        }
      } else if (summary.persistNote) {
        message += ` ${summary.persistNote}`;
      }
      setStatus({ type: 'success', message });
      if (summary.mapId) {
        setSelectedMapId(summary.mapId);
      }
      await refreshSavedMaps();
    } catch (err) {
      setStatus({
        type: 'error',
        message: err.message || 'Map sync failed.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleLoadSavedMap = async () => {
    if (!selectedMapId) {
      setStatus({ type: 'error', message: 'Choose a saved map.' });
      return;
    }

    const entry = savedMaps.find((m) => m.id === selectedMapId);
    const confirmed = window.confirm(
      entry
        ? `Load saved map "${entry.name}" as the central map? This updates the GUI and user_map.json.`
        : 'Load the selected saved map as the central map?',
    );
    if (!confirmed) return;

    setBusy(true);
    setStatus({ type: '', message: 'Loading saved map…' });
    try {
      const platformSettings = loadDdsLocalSettings();
      const summary = await loadSavedMapToCentral({
        mapId: selectedMapId,
        apolloClient,
        platformSettings,
      });
      let message =
        `Loaded "${summary.name}" ` +
        `(${summary.width}×${summary.height}, ${summary.resolution} m/px).`;
      if (summary.bytesWritten > 0) {
        message += ' Saved to user_map.json.';
        if (summary.savedPath) {
          message += ` (${summary.savedPath})`;
        }
      } else if (summary.persistNote) {
        message += ` ${summary.persistNote}`;
      }
      setStatus({ type: 'success', message });
      await refreshSavedMaps();
    } catch (err) {
      setStatus({
        type: 'error',
        message: err.message || 'Failed to load saved map.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSavedMap = async () => {
    if (!selectedMapId) {
      setStatus({ type: 'error', message: 'Choose a saved map.' });
      return;
    }

    const entry = savedMaps.find((m) => m.id === selectedMapId);
    const confirmed = window.confirm(
      entry
        ? `Delete saved map "${entry.name}" from the map library? This cannot be undone.`
        : 'Delete the selected saved map from the map library?',
    );
    if (!confirmed) return;

    setBusy(true);
    setStatus({ type: '', message: 'Deleting saved map…' });
    try {
      const platformSettings = loadDdsLocalSettings();
      const result = await deleteSavedMap({
        platformDir: platformSettings.platformDir || '',
        wslDistro: platformSettings.wslDistro || '',
        mapId: selectedMapId,
      });
      if (!result?.ok) {
        throw new Error(result?.error || 'Failed to delete saved map.');
      }
      setStatus({
        type: 'success',
        message: `Deleted "${result.name || entry?.name || 'map'}" from saved maps.`,
      });
      setSelectedMapId('');
      await refreshSavedMaps();
    } catch (err) {
      setStatus({
        type: 'error',
        message: err.message || 'Failed to delete saved map.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="central-maps">
      <div className="central-maps__head">
        <span className="central-maps__title">Load/Sync Map</span>
        <button
          type="button"
          className="central-maps__btn central-maps__btn--expand"
          onClick={() => setExpanded((o) => !o)}
          aria-expanded={expanded}
          aria-controls="central-maps-panel"
          title="Load or sync map"
        >
          {expanded ? '▴' : '▾'}
        </button>
      </div>

      {expanded && (
        <div className="central-maps__panel" id="central-maps-panel">
          <div className="central-maps__saved-section">
            <label className="central-maps__label" htmlFor="central-maps-saved">
              Load Previously Synced Map
            </label>
            <div className="central-maps__saved-row">
              <SavedMapPicker
                maps={savedMaps}
                activeMapId={activeMapId}
                selectedId={selectedMapId}
                disabled={busy}
                onSelect={setSelectedMapId}
              />
              <div className="central-maps__saved-actions">
                <button
                  type="button"
                  className="robot-startup__btn central-maps__btn-load"
                  onClick={handleLoadSavedMap}
                  disabled={!canLoadSavedMap}
                  title={canLoadSavedMap ? 'Load selected map into GUI' : loadDisabledReason}
                >
                  {busy ? '…' : 'Load'}
                </button>
                <button
                  type="button"
                  className="robot-startup__btn central-maps__btn-delete"
                  onClick={handleDeleteSavedMap}
                  disabled={!canDeleteSavedMap}
                  title={
                    canDeleteSavedMap
                      ? 'Remove selected map from saved maps'
                      : loadDisabledReason
                  }
                >
                  {busy ? '…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>

          <div className="central-maps__sync-row">
            <div className="central-maps__field">
              <label className="central-maps__label" htmlFor="central-maps-name">
                Map Name
              </label>
              <input
                id="central-maps-name"
                type="text"
                className="central-maps__input"
                placeholder="e.g. Lab floor 1"
                value={mapName}
                onChange={(e) => setMapName(e.target.value)}
                disabled={busy}
                autoComplete="off"
              />
            </div>
            <button
              type="button"
              className="robot-startup__btn central-maps__btn-sync"
              onClick={handleSyncMap}
              disabled={!canSyncWithName || busy}
              title={
                canSyncWithName
                  ? 'Fetch map from robot, save under map name, and activate'
                  : syncDisabledReason
              }
            >
              {busy ? '…' : 'Sync Map From Robot'}
            </button>
          </div>

          {libraryNote ? (
            <p className="central-maps__hint" role="note">
              {libraryNote}
            </p>
          ) : null}
          {ddsDirHint && !libraryNote ? (
            <p className="central-maps__hint" role="note">
              Maps stored under {ddsDirHint}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default CentralMapSection;
