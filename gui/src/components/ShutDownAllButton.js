import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@apollo/client';
import { REQUEST_ROBOT_SHUTDOWN } from '../mutations';
import { requestRobotHostPowerOff } from '../utils/robotLauncherApi';
import { normalizeHostInput } from '../utils/robotLauncherStorage';
import { HOST_STATUS } from '../utils/robotLauncherStatus';
import RobotPowerOffModal from './RobotPowerOffModal';

const NOTICE_DISMISS_MS = 5000;

const ShutDownAllButton = ({
  robotPositions = [],
  positionsLoading,
  dismissPathForRobot,
  launcherHost = '',
  launcherLabel = '',
  launcherReach = HOST_STATUS.OFFLINE,
}) => {
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [powerOffOpen, setPowerOffOpen] = useState(false);
  const noticeTimerRef = useRef(null);
  const [requestRobotShutdown] = useMutation(REQUEST_ROBOT_SHUTDOWN);

  const onlineRobots = robotPositions;
  const activeHost = normalizeHostInput(launcherHost);
  const canShutDownAll =
    onlineRobots.length > 0 && !busy && !(positionsLoading && onlineRobots.length === 0);
  const launcherReachable =
    launcherReach === HOST_STATUS.AVAILABLE ||
    launcherReach === HOST_STATUS.RUNNING;
  const canPowerOff = Boolean(activeHost) && launcherReachable && !busy;

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

  const handlePowerOffConfirm = async () => {
    if (!activeHost) {
      showNotice('Enter a robot IP in Robot Startup', 'error');
      return;
    }

    setBusy(true);
    try {
      const result = await requestRobotHostPowerOff(activeHost, '');
      if (result.ok) {
        setPowerOffOpen(false);
        showNotice(
          result.body?.trim() || 'Power off scheduled. The robot PC should halt shortly.',
        );
      } else {
        showNotice(
          result.body
            ? `Power off failed: ${result.body}`
            : `Power off failed (HTTP ${result.status}).`,
          'error',
        );
      }
    } catch (err) {
      showNotice(err.message || 'Power off request failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const shutDownDisabledReason =
    onlineRobots.length === 0
      ? 'No robots online'
      : busy
        ? 'Please wait…'
        : '';

  const powerOffDisabledReason = !activeHost
    ? 'Enter a robot IP in Robot Startup'
    : launcherReach === HOST_STATUS.CHECKING
      ? 'Checking robot…'
      : !launcherReachable
        ? 'Robot launcher not reachable (is the robot on?)'
        : busy
          ? 'Please wait…'
          : '';

  return (
    <div className="shutdown-all">
      <div className="shutdown-all__row">
        <button
          type="button"
          className="control-button shutdown shutdown-all__btn"
          onClick={handleShutDownAll}
          disabled={!canShutDownAll}
          title={canShutDownAll ? 'Send shut down to all online robots' : shutDownDisabledReason}
        >
          {busy && !powerOffOpen ? '…' : 'Shut Down All'}
        </button>
        <button
          type="button"
          className="control-button shutdown-all__btn shutdown-all__btn--poweroff"
          onClick={() => setPowerOffOpen(true)}
          disabled={!canPowerOff}
          title={
            canPowerOff
              ? 'Stop ROS, stop container, and power off the Robot Startup PC'
              : powerOffDisabledReason
          }
        >
          Power Off
        </button>
      </div>

      <RobotPowerOffModal
        open={powerOffOpen}
        host={activeHost}
        label={launcherLabel}
        busy={busy}
        onCancel={() => {
          if (!busy) {
            setPowerOffOpen(false);
          }
        }}
        onConfirm={handlePowerOffConfirm}
      />

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
