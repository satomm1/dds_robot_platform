import React from 'react';
import { useLocalStack } from '../hooks/useLocalStack';
import { DDS_STATUS, DDS_STATUS_LABELS } from '../utils/ddsLocalStatus';

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
  const {
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
    handleValidate,
    handleDockerStart,
    handleDockerStop,
    handleCaptureStart,
    handleCaptureStop,
  } = useLocalStack();

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

      <div className="dds-local__stack-row">
        <span className="dds-local__row-label">
          <span
            className={`dds-local__reach dds-local__reach--${captureReach}`}
            title={DDS_STATUS_LABELS[captureReach]}
            aria-label={`Capture: ${DDS_STATUS_LABELS[captureReach]}`}
          />
          Capture
        </span>
        <div className="dds-local__row-actions">
          <StackRowActions
            reach={captureReach}
            pathValidated={pathValidated}
            bridgeAvailable={bridgeAvailable}
            busy={busy}
            onStart={handleCaptureStart}
            onStop={handleCaptureStop}
            startTitle="Start Capture Docker Compose"
            stopTitle="Stop Capture Docker Compose"
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

export default React.memo(DdsLocalControl);
