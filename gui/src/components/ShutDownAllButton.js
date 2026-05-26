import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@apollo/client';
import { REQUEST_ROBOT_SHUTDOWN } from '../mutations';

const NOTICE_DISMISS_MS = 5000;

const ShutDownAllButton = ({
  robotPositions = [],
  positionsLoading,
  dismissPathForRobot,
}) => {
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const noticeTimerRef = useRef(null);
  const [requestRobotShutdown] = useMutation(REQUEST_ROBOT_SHUTDOWN);

  const onlineRobots = robotPositions;
  const canShutDownAll =
    onlineRobots.length > 0 && !busy && !(positionsLoading && onlineRobots.length === 0);

  useEffect(
    () => () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
    },
    [],
  );

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

  const handleShutDownAll = async () => {
    if (!canShutDownAll) return;

    setBusy(true);
    onlineRobots.forEach((robot) => dismissPathForRobot(robot.id));

    const results = await Promise.allSettled(
      onlineRobots.map((robot) =>
        requestRobotShutdown({ variables: { robotId: robot.id } }),
      ),
    );

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    const total = onlineRobots.length;

    if (sent === total) {
      showNotice(
        total === 1
          ? 'Shut down message sent to 1 robot'
          : `Shut down message sent to ${total} robots`,
      );
    } else if (sent === 0) {
      showNotice('Could not send shut down messages', 'error');
    } else {
      showNotice(`Shut down message sent to ${sent} of ${total} robots`, 'error');
    }

    setBusy(false);
  };

  const shutDownDisabledReason =
    onlineRobots.length === 0
      ? 'No robots online'
      : busy
        ? 'Please wait…'
        : '';

  return (
    <div className="shutdown-all">
      <button
        type="button"
        className="control-button shutdown shutdown-all__btn shutdown-all__btn--block"
        onClick={handleShutDownAll}
        disabled={!canShutDownAll}
        title={canShutDownAll ? 'Send shut down to all online robots' : shutDownDisabledReason}
      >
        {busy ? '…' : 'Shut Down All'}
      </button>
      {notice ? (
        <p
          className={`robot-controls__notice robot-controls__notice--${notice.type}`}
          role="status"
        >
          {notice.message}
        </p>
      ) : null}
    </div>
  );
};

export default ShutDownAllButton;
