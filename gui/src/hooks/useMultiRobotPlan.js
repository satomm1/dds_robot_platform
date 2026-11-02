import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation } from '@apollo/client';
import { SET_MULTI_ROBOT_GOAL_PLAN } from '../mutations';

/** Fleet selection, staged goals, and submission for coordinated multi-robot plans. */
export function useMultiRobotPlan({ robotPositions, clearPathDismissalForRobots }) {
  const [multiFleet, setMultiFleet] = useState({});
  const [stagedMultiGoals, setStagedMultiGoals] = useState({});
  const [multiPlanId, setMultiPlanId] = useState('gui_1');
  const nextMultiPlanSuffixRef = useRef(2);
  const [multiCoordinated, setMultiCoordinated] = useState(true);
  const [multiSubmitError, setMultiSubmitError] = useState('');

  const [setMultiRobotGoalPlan, { loading: multiSubmitting }] = useMutation(SET_MULTI_ROBOT_GOAL_PLAN);

  const multiPlanFleetIds = useMemo(
    () =>
      Object.keys(multiFleet)
        .map(Number)
        .filter((id) => multiFleet[id]),
    [multiFleet],
  );

  const handleStageMultiGoal = useCallback((robotId, mapX, mapY, thetaRad) => {
    setStagedMultiGoals((prev) => ({
      ...prev,
      [robotId]: { mapX, mapY, theta: thetaRad },
    }));
    setMultiSubmitError('');
  }, []);

  const toggleMultiFleet = useCallback((robotId) => {
    setMultiFleet((prev) => ({
      ...prev,
      [robotId]: !prev[robotId],
    }));
    setMultiSubmitError('');
  }, []);

  const setMultiFleetAll = useCallback(
    (checked) => {
      if (checked) {
        const next = {};
        robotPositions.forEach((robot) => {
          next[robot.id] = true;
        });
        setMultiFleet(next);
      } else {
        setMultiFleet({});
      }
      setMultiSubmitError('');
    },
    [robotPositions],
  );

  const clearStagedMultiGoals = useCallback(() => {
    setStagedMultiGoals({});
    setMultiSubmitError('');
  }, []);

  const handleSubmitMultiRobotPlan = useCallback(() => {
    const fleetIds = Object.keys(multiFleet)
      .map(Number)
      .filter((id) => multiFleet[id])
      .sort((a, b) => a - b);
    const missing = fleetIds.filter((id) => !stagedMultiGoals[id]);
    if (fleetIds.length < 2) {
      setMultiSubmitError('Select at least two robots in the fleet.');
      return;
    }
    if (missing.length > 0) {
      setMultiSubmitError(`Stage a map goal for robot(s): ${missing.join(', ')}`);
      return;
    }
    const planTimestamp = new Date().getTime() / 1000;
    const goals = fleetIds.map((robotId) => ({
      robot_id: robotId,
      x_goal: stagedMultiGoals[robotId].mapX,
      y_goal: stagedMultiGoals[robotId].mapY,
      theta_goal: stagedMultiGoals[robotId].theta,
    }));
    setMultiSubmitError('');
    setMultiRobotGoalPlan({
      variables: {
        planId: multiPlanId.trim() || 'gui_1',
        coordinated: multiCoordinated,
        planTimestamp,
        goals,
      },
    })
      .then(() => {
        clearPathDismissalForRobots(fleetIds);
        setStagedMultiGoals({});
        setMultiFleet({});
        const next = nextMultiPlanSuffixRef.current;
        nextMultiPlanSuffixRef.current += 1;
        setMultiPlanId(`gui_${next}`);
      })
      .catch((err) => {
        console.error('setMultiRobotGoalPlan:', err);
        setMultiSubmitError(err.message || 'Failed to send multi-robot plan');
      });
  }, [
    multiFleet,
    stagedMultiGoals,
    multiPlanId,
    multiCoordinated,
    setMultiRobotGoalPlan,
    clearPathDismissalForRobots,
  ]);

  return {
    multiFleet,
    multiPlanFleetIds,
    stagedMultiGoals,
    multiPlanId,
    setMultiPlanId,
    multiCoordinated,
    setMultiCoordinated,
    multiSubmitError,
    setMultiSubmitError,
    multiSubmitting,
    handleStageMultiGoal,
    toggleMultiFleet,
    setMultiFleetAll,
    clearStagedMultiGoals,
    handleSubmitMultiRobotPlan,
  };
}
