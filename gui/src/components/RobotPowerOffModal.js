import React, { useEffect, useRef } from 'react';

const RobotPowerOffModal = ({
  open,
  host,
  label,
  busy,
  onCancel,
  onConfirm,
}) => {
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !busy) {
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) {
    return null;
  }

  const displayName = (label || host || '').trim() || 'this robot';
  const hostLine = host ? ` (${host})` : '';

  return (
    <div
      className="robot-poweroff-modal"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) {
          onCancel();
        }
      }}
    >
      <div
        className="robot-poweroff-modal__dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="robot-poweroff-title"
        aria-describedby="robot-poweroff-desc"
      >
        <h2 id="robot-poweroff-title" className="robot-poweroff-modal__title">
          Power off robot computer?
        </h2>
        <p id="robot-poweroff-desc" className="robot-poweroff-modal__body">
          This will stop ROS, stop the Docker container, and shut down the physical machine for{' '}
          <strong>
            {displayName}
            {hostLine}
          </strong>
          . You may need to power it on manually before using it again.
        </p>
        <p className="robot-poweroff-modal__note">
          This is not the same as <strong>Shut Down</strong> in the right sidebar (software/DDS
          shutdown only).
        </p>
        <div className="robot-poweroff-modal__actions">
          <button
            ref={cancelRef}
            type="button"
            className="robot-poweroff-modal__btn robot-poweroff-modal__btn--cancel"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="robot-poweroff-modal__btn robot-poweroff-modal__btn--confirm"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Sending…' : 'Power Off'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RobotPowerOffModal;
