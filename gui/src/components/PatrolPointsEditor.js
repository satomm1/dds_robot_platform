import React from 'react';

/**
 * Docked controls for editing patrol points on the map before writing patrol.txt.
 */
const PatrolPointsEditor = ({
  hostLabel,
  waitMode,
  onWaitModeChange,
  globalWaitSec,
  onGlobalWaitSecChange,
  defaultWaitSec,
  onDefaultWaitSecChange,
  stagedPoints,
  onWaitSecChange,
  onRemovePoint,
  onClear,
  onCancel,
  onSave,
  saving,
  saveError,
  loadError,
  successMessage = '',
  onDismissSuccess = null,
}) => {
  const canSave = stagedPoints.length > 0 && !saving;
  const title = hostLabel ? `Set Robot ${hostLabel} Patrol` : 'Set Robot Patrol';

  if (successMessage) {
    return (
      <div className="patrol-points-editor">
        <p className="patrol-points-editor__title">{title}</p>
        <p className="patrol-points-editor__success" role="status">
          {successMessage}
        </p>
        {typeof onDismissSuccess === 'function' && (
          <div className="patrol-points-editor__actions">
            <button
              type="button"
              className="patrol-points-editor__btn"
              onClick={onDismissSuccess}
            >
              Done
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="patrol-points-editor">
      <p className="patrol-points-editor__title">{title}</p>
      <p className="patrol-points-editor__hint">
        Click and drag on the map to add a pose.
      </p>

      <div className="patrol-points-editor__wait-modes">
        <label className="patrol-points-editor__radio">
          <input
            type="radio"
            name="patrol-wait-mode"
            checked={waitMode === 'global'}
            onChange={() => onWaitModeChange('global')}
            disabled={saving}
          />
          Global wait
        </label>
        <label className="patrol-points-editor__radio">
          <input
            type="radio"
            name="patrol-wait-mode"
            checked={waitMode === 'perPoint'}
            onChange={() => onWaitModeChange('perPoint')}
            disabled={saving}
          />
          Per-point wait
        </label>
      </div>

      {waitMode === 'global' ? (
        <label className="patrol-points-editor__field">
          <span>Wait after each point (s)</span>
          <input
            type="number"
            min="0"
            step="0.1"
            value={globalWaitSec}
            onChange={(e) => onGlobalWaitSecChange(e.target.value)}
            disabled={saving}
          />
        </label>
      ) : (
        <label className="patrol-points-editor__field">
          <span>Default wait for new points (s)</span>
          <input
            type="number"
            min="0"
            step="0.1"
            value={defaultWaitSec}
            onChange={(e) => onDefaultWaitSecChange(e.target.value)}
            disabled={saving}
          />
        </label>
      )}

      {stagedPoints.length > 0 ? (
        <ul className="patrol-points-editor__list">
          {stagedPoints.map((pt, index) => (
            <li key={pt.id} className="patrol-points-editor__item">
              <span className="patrol-points-editor__item-label">
                {index + 1}. ({pt.mapX.toFixed(2)}, {pt.mapY.toFixed(2)},{' '}
                {((Number(pt.theta) * 180) / Math.PI).toFixed(1)}°)
              </span>
              {waitMode === 'perPoint' && (
                <input
                  type="number"
                  className="patrol-points-editor__item-wait"
                  min="0"
                  step="0.1"
                  value={pt.waitSec}
                  onChange={(e) => onWaitSecChange(pt.id, e.target.value)}
                  disabled={saving}
                  aria-label={`Wait seconds for point ${index + 1}`}
                  title="Wait after arrival (s)"
                />
              )}
              <button
                type="button"
                className="patrol-points-editor__item-remove"
                onClick={() => onRemovePoint(pt.id)}
                disabled={saving}
                title="Remove point"
                aria-label={`Remove point ${index + 1}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="patrol-points-editor__empty">No points yet.</p>
      )}

      <div className="patrol-points-editor__actions">
        <button
          type="button"
          className="patrol-points-editor__btn"
          onClick={onClear}
          disabled={stagedPoints.length === 0 || saving}
        >
          Clear
        </button>
        <button
          type="button"
          className="patrol-points-editor__btn"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="patrol-points-editor__btn patrol-points-editor__btn--primary"
          onClick={onSave}
          disabled={!canSave}
        >
          {saving ? '…' : 'Send to Robot'}
        </button>
      </div>

      {loadError && <p className="patrol-points-editor__error">{loadError}</p>}
      {saveError && <p className="patrol-points-editor__error">{saveError}</p>}
    </div>
  );
};

export default PatrolPointsEditor;
