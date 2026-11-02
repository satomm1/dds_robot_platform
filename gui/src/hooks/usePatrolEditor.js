import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRobotPatrol, postRobotPatrol } from '../utils/robotLauncherApi';

const parseWaitSec = (value, fallback = 10) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
};

/**
 * Staging, loading, and saving patrol points for one robot host.
 * Entering/leaving patrol mode updates the shared map position mode via setPositionMode.
 */
export function usePatrolEditor({ setPositionMode, setMultiSubmitError }) {
  const [patrolHost, setPatrolHost] = useState('');
  const [patrolHostLabel, setPatrolHostLabel] = useState('');
  const [stagedPatrolPoints, setStagedPatrolPoints] = useState([]);
  const nextPatrolPointIdRef = useRef(1);
  const [patrolWaitMode, setPatrolWaitMode] = useState('global'); // 'global' | 'perPoint'
  const [patrolGlobalWaitSec, setPatrolGlobalWaitSec] = useState('10');
  const [patrolDefaultWaitSec, setPatrolDefaultWaitSec] = useState('10');
  const [patrolSaving, setPatrolSaving] = useState(false);
  const [patrolSaveError, setPatrolSaveError] = useState('');
  const [patrolLoadError, setPatrolLoadError] = useState('');
  const [patrolSuccessMessage, setPatrolSuccessMessage] = useState('');

  const exitPatrolMode = useCallback(
    (nextMode = 'goal') => {
      setPositionMode(nextMode);
      setPatrolHost('');
      setPatrolHostLabel('');
      setStagedPatrolPoints([]);
      setPatrolSaveError('');
      setPatrolLoadError('');
      setPatrolSaving(false);
      setPatrolSuccessMessage('');
    },
    [setPositionMode],
  );

  const dismissPatrolSuccess = useCallback(() => {
    exitPatrolMode('goal');
  }, [exitPatrolMode]);

  useEffect(() => {
    if (!patrolSuccessMessage) return undefined;
    const timer = setTimeout(() => {
      exitPatrolMode('goal');
    }, 5000);
    return () => clearTimeout(timer);
  }, [patrolSuccessMessage, exitPatrolMode]);

  const handleBeginSetPatrolPoints = useCallback(
    async ({ host, label }) => {
      const cleanHost = String(host || '').trim();
      if (!cleanHost) return;
      setMultiSubmitError('');
      setPositionMode('patrol');
      setPatrolHost(cleanHost);
      setPatrolHostLabel(String(label || cleanHost).trim());
      setStagedPatrolPoints([]);
      setPatrolSaveError('');
      setPatrolLoadError('');
      setPatrolSaving(false);
      setPatrolSuccessMessage('');
      try {
        const result = await fetchRobotPatrol(cleanHost);
        if (result.ok && Array.isArray(result.points) && result.points.length > 0) {
          const loaded = result.points.map((pt) => {
            const id = nextPatrolPointIdRef.current;
            nextPatrolPointIdRef.current += 1;
            return {
              id,
              mapX: Number(pt.x),
              mapY: Number(pt.y),
              theta: Number(pt.theta),
              waitSec: String(
                Number.isFinite(Number(pt.wait_sec)) ? Number(pt.wait_sec) : 10,
              ),
            };
          });
          setStagedPatrolPoints(loaded);
          const waits = loaded.map((p) => Number(p.waitSec));
          const allSame = waits.every((w) => w === waits[0]);
          if (allSame) {
            setPatrolWaitMode('global');
            setPatrolGlobalWaitSec(String(waits[0]));
          } else {
            setPatrolWaitMode('perPoint');
            setPatrolDefaultWaitSec(String(waits[0] ?? 10));
          }
        } else if (!result.ok && result.error) {
          setPatrolLoadError(result.error);
        }
      } catch (err) {
        setPatrolLoadError(err.message || 'Could not load existing patrol points.');
      }
    },
    [setPositionMode, setMultiSubmitError],
  );

  const handleStagePatrolPoint = useCallback(
    (mapX, mapY, thetaRad) => {
      const waitSeed =
        patrolWaitMode === 'global' ? patrolGlobalWaitSec : patrolDefaultWaitSec;
      const id = nextPatrolPointIdRef.current;
      nextPatrolPointIdRef.current += 1;
      setStagedPatrolPoints((prev) => [
        ...prev,
        {
          id,
          mapX,
          mapY,
          theta: thetaRad,
          waitSec: String(parseWaitSec(waitSeed, 10)),
        },
      ]);
      setPatrolSaveError('');
    },
    [patrolWaitMode, patrolGlobalWaitSec, patrolDefaultWaitSec],
  );

  const handlePatrolWaitSecChange = useCallback((pointId, value) => {
    setStagedPatrolPoints((prev) =>
      prev.map((pt) => (pt.id === pointId ? { ...pt, waitSec: value } : pt)),
    );
  }, []);

  const handleRemovePatrolPoint = useCallback((pointId) => {
    setStagedPatrolPoints((prev) => prev.filter((pt) => pt.id !== pointId));
  }, []);

  const handleClearPatrolPoints = useCallback(() => {
    setStagedPatrolPoints([]);
    setPatrolSaveError('');
  }, []);

  const handleCancelPatrolPoints = useCallback(() => {
    exitPatrolMode('goal');
  }, [exitPatrolMode]);

  const handleSavePatrolPoints = useCallback(async () => {
    if (!patrolHost || stagedPatrolPoints.length === 0 || patrolSaving) return;
    const globalWait = parseWaitSec(patrolGlobalWaitSec, 10);
    const points = stagedPatrolPoints.map((pt) => ({
      x: pt.mapX,
      y: pt.mapY,
      theta: pt.theta,
      wait_sec:
        patrolWaitMode === 'global' ? globalWait : parseWaitSec(pt.waitSec, globalWait),
    }));
    setPatrolSaving(true);
    setPatrolSaveError('');
    try {
      const result = await postRobotPatrol(patrolHost, points);
      if (!result.ok) {
        setPatrolSaveError(result.error || 'Failed to write patrol points.');
        setPatrolSaving(false);
        return;
      }
      const count = result.count || points.length;
      setStagedPatrolPoints([]);
      setPatrolSaving(false);
      setPatrolSaveError('');
      setPositionMode('goal');
      setPatrolSuccessMessage(
        `Wrote ${count} patrol point${count === 1 ? '' : 's'} to the robot. Takes effect on the next patrol start.`,
      );
    } catch (err) {
      setPatrolSaveError(err.message || 'Failed to write patrol points.');
      setPatrolSaving(false);
    }
  }, [
    patrolHost,
    stagedPatrolPoints,
    patrolSaving,
    patrolGlobalWaitSec,
    patrolWaitMode,
    setPositionMode,
  ]);

  return {
    patrolHost,
    patrolHostLabel,
    stagedPatrolPoints,
    patrolWaitMode,
    setPatrolWaitMode,
    patrolGlobalWaitSec,
    setPatrolGlobalWaitSec,
    patrolDefaultWaitSec,
    setPatrolDefaultWaitSec,
    patrolSaving,
    patrolSaveError,
    patrolLoadError,
    patrolSuccessMessage,
    exitPatrolMode,
    dismissPatrolSuccess,
    handleBeginSetPatrolPoints,
    handleStagePatrolPoint,
    handlePatrolWaitSecChange,
    handleRemovePatrolPoint,
    handleClearPatrolPoints,
    handleCancelPatrolPoints,
    handleSavePatrolPoints,
  };
}
