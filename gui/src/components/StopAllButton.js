import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@apollo/client';
import { REQUEST_ROBOT_STOP } from '../mutations';

const NOTICE_DISMISS_MS = 5000;

const StopAllButton = ({
  robotPositions = [],
  positionsLoading,
  dismissPathForRobot,
}) => {
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const noticeTimerRef = useRef(null);
  const [requestRobotStop] = useMutation(REQUEST_ROBOT_STOP);

  const onlineRobots = robotPositions;
  const canStopAll =
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

  const handleStopAll = async () => {
    if (!canStopAll) return;

    setBusy(true);
    onlineRobots.forEach((robot) => dismissPathForRobot(robot.id));

    const results = await Promise.allSettled(
      onlineRobots.map((robot) =>
        requestRobotStop({ variables: { robotId: robot.id } }),
      ),
    );

    const sent = results.filter((r) => r.status === 'fulfilled').length;
    const total = onlineRobots.length;

    if (sent === total) {
      showNotice(
        total === 1
          ? 'Stop message sent to 1 robot'
          : `Stop message sent to ${total} robots`,
      );
    } else if (sent === 0) {
      showNotice('Could not send stop messages', 'error');
    } else {
      showNotice(`Stop message sent to ${sent} of ${total} robots`, 'error');
    }

    setBusy(false);
  };

  const stopDisabledReason =
    onlineRobots.length === 0
      ? 'No robots online'
      : busy
        ? 'Please wait…'
        : '';

  return (
    <div className="stop-all">
      <button
        type="button"
        className="control-button stop stop-all__btn stop-all__btn--block"
        onClick={handleStopAll}
        disabled={!canStopAll}
        title={
          canStopAll
            ? 'Stop all online robots and clear their paths'
            : stopDisabledReason
        }
      >
        {busy ? '…' : 'Stop All'}
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

export default StopAllButton;
