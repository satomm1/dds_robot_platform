// src/components/RobotControls.js
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@apollo/client';
import { REQUEST_ROBOT_SHUTDOWN, REQUEST_ROBOT_STOP } from '../mutations';

const NOTICE_DISMISS_MS = 5000;

const RobotControls = ({
  selectedRobotId,
  robotPositions = [],
  positionsLoading,
  positionsError,
  dismissPathForRobot,
}) => {
  const [notice, setNotice] = useState(null);
  const noticeTimerRef = useRef(null);
  const [requestRobotStop, { loading: stopLoading }] = useMutation(REQUEST_ROBOT_STOP);
  const [requestRobotShutdown, { loading: shutdownLoading }] = useMutation(
    REQUEST_ROBOT_SHUTDOWN,
  );

  const selectedRobot = robotPositions.find((r) => r.id === selectedRobotId);
  const canStop =
    selectedRobotId != null && Boolean(selectedRobot) && !stopLoading && !positionsLoading;

  const showNotice = useCallback((message, type = 'success') => {
    setNotice({ message, type });
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, NOTICE_DISMISS_MS);
  }, []);

  const handleStop = useCallback(() => {
    if (!canStop) return;
    const label = selectedRobot.name || `Robot ${selectedRobotId}`;
    dismissPathForRobot(selectedRobotId);
    requestRobotStop({
      variables: { robotId: selectedRobotId },
    })
      .then(() => {
        showNotice(`${label} stop message sent`);
      })
      .catch((error) => {
        console.error('Error requesting robot stop:', error);
        showNotice(`Could not send stop message to ${label}`, 'error');
      });
  }, [
    canStop,
    dismissPathForRobot,
    requestRobotStop,
    selectedRobot,
    selectedRobotId,
    showNotice,
  ]);

  useEffect(() => {
    const isTypingTarget = (el) =>
      el &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable);

    const onKeyDown = (e) => {
      if (isTypingTarget(e.target) || e.repeat) return;
      if (e.key !== 's' && e.key !== 'S') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      handleStop();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleStop]);

  useEffect(
    () => () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
    },
    [],
  );

  const renderNotice = () =>
    notice ? (
      <p
        className={`robot-controls__notice robot-controls__notice--${notice.type}`}
        role="status"
      >
        {notice.message}
      </p>
    ) : null;

  const wrap = (body) => (
    <>
      {body}
      {renderNotice()}
    </>
  );

  if (positionsError) {
    return wrap(
      <div className="robot-controls">Error: {positionsError.message}</div>,
    );
  }

  if (selectedRobotId == null || (!selectedRobot && !positionsLoading)) {
    return wrap(
      <div className="robot-controls robot-controls--placeholder">
        No robot selected
      </div>,
    );
  }

  if (positionsLoading && !selectedRobot) {
    return wrap(<div className="robot-controls">Loading robot data...</div>);
  }

  const robotLabel = selectedRobot.name || `Robot ${selectedRobotId}`;

  const handleShutdown = () => {
    const label = robotLabel;
    const robotId = selectedRobotId;
    dismissPathForRobot(robotId);
    requestRobotShutdown({
      variables: { robotId },
    })
      .then(() => {
        showNotice(`${label} shut down message sent`);
      })
      .catch((error) => {
        console.error('Error requesting robot shutdown:', error);
        showNotice(`Could not send shut down message to ${label}`, 'error');
      });
  };

  return wrap(
    <div className="robot-controls">
      <h3>{robotLabel}</h3>
      <div className="control-stats">
        <p>
          <strong>Position:</strong> ({selectedRobot.x.toFixed(2)},{' '}
          {selectedRobot.y.toFixed(2)})
        </p>
        <p>
          <strong>Heading:</strong>{' '}
          {(selectedRobot.theta * (180 / Math.PI)).toFixed(1)}°
        </p>
      </div>
      <div className="control-buttons">
        <button
          type="button"
          onClick={handleStop}
          disabled={!canStop}
          className="control-button stop"
        >
          Stop
        </button>
        <button
          type="button"
          onClick={handleShutdown}
          disabled={shutdownLoading}
          className="control-button shutdown"
        >
          Shut Down
        </button>
      </div>
    </div>,
  );
};

export default RobotControls;
