import React, {
  forwardRef,
  useRef,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useImperativeHandle,
} from 'react';
import { Stage } from 'react-konva';
import { useQuery, useMutation } from '@apollo/client';
import { GET_OCCUPANCY_GRID, GET_ROBOT_GOALS, GET_ROBOT_PATHS, GET_OBJECT_POSITIONS } from '../queries';
import { CLEAR_ALL_OBJECTS } from '../mutations';
import { useRobotColors } from '../hooks/useRobotColors';
import { mapDragToRobotThetaRad } from '../utils';
import MapControlsPanel from './MapControlsPanel';
import { mapToPixel } from './robotMap/mapTransform';
import { createPointerStore } from './robotMap/pointerStore';
import CursorOverlay from './robotMap/CursorOverlay';
import MapImageLayer from './robotMap/MapImageLayer';
import { createOccupancyCanvas } from './robotMap/occupancyImage';
import PathsLayer from './robotMap/PathsLayer';
import RobotsLayer from './robotMap/RobotsLayer';
import PoseDragLayer from './robotMap/PoseDragLayer';
import GoalsLayer from './robotMap/GoalsLayer';
import ObjectsLayer from './robotMap/ObjectsLayer';

const devLog = (...args) => {
  if (process.env.NODE_ENV === 'development') console.log(...args);
};
const devWarn = (...args) => {
  if (process.env.NODE_ENV === 'development') console.warn(...args);
};

const MIN_DRAG_PX = 8;
const ZOOM_TO_ROBOT_SCALE = 1;
const INVALID_GOAL_DISPLAY_SEC = 5;
const EMPTY_ARRAY = [];

// Polling interval (in milliseconds)
const POLL_INTERVAL = 1000; // Fetch every 1 seconds
const OBJECT_POLL_INTERVAL = 500; // Faster than other queries so departed people clear quickly

const gridCellSize = 5;

// Zoom scale limits
const minScale = 0.1;
const maxScale = 3;

// No notifyOnNetworkStatusChange: unchanged poll results keep the same `data`
// reference, so idle polls do not re-render the map.
const defaultPollOptions = {
  pollInterval: POLL_INTERVAL,
  fetchPolicy: 'network-only',
};

function pointerToWorld(stage, pointerPosition) {
  const transform = stage.getAbsoluteTransform().copy().invert();
  return transform.point(pointerPosition);
}

function worldToMapCoords(worldPos, occGridWidth, gridCellSize, occGridResolution) {
  return {
    mapX: (occGridWidth - worldPos.x / gridCellSize) * occGridResolution,
    mapY: (worldPos.y * occGridResolution) / gridCellSize,
  };
}

function worldToStagePointer(stage, worldPoint) {
  return stage.getAbsoluteTransform().point(worldPoint);
}

function resolveInvalidGoalOverlayPosition(stage, info) {
  if (info?.screenX != null && info?.screenY != null) {
    return { x: info.screenX, y: info.screenY };
  }
  if (stage && info?.worldX != null && info?.worldY != null) {
    return worldToStagePointer(stage, { x: info.worldX, y: info.worldY });
  }
  return null;
}

// Calculate distance between two points
const calculateDistance = (x1, y1, x2, y2) => {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
};

const RobotMap = forwardRef(({
  selectedRobotId,
  robotMarkerRadius = 12,
  showPaths = true,
  pathStrokeWidth = 2,
  showCursorCoordinates = true,
  showSelectedRobotOnly = false,
  showAirQualityOnHover = false,
  showMapControls = true,
  airQualities = EMPTY_ARRAY,
  positionStaleSec = 31,
  robotPositions = EMPTY_ARRAY,
  positionsLoading,
  positionsError,
  onSetGoal,
  onSetInitialPosition,
  positionMode,
  multiPlanFleetIds = EMPTY_ARRAY,
  stagedMultiGoals = {},
  onStageMultiGoal = () => {},
  stagedPatrolPoints = EMPTY_ARRAY,
  onStagePatrolPoint = () => {},
  pathDisplayDismissed = {},
  dismissPathForRobot = () => {},
  clearPathDismissalForRobot = () => {},
}, ref) => {
  const { getRobotColor } = useRobotColors();
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  // Local goal edits layered over server goals: marker = optimistic click, null = cleared.
  // An override is dropped once that robot's goal on the server changes.
  const [goalOverrides, setGoalOverrides] = useState({});
  const [objectsCleared, setObjectsCleared] = useState(false);
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const [occGridWidth, setOccGridWidth] = useState(0);
  const [occGridHeight, setOccGridHeight] = useState(0);
  const [occGridResolution, setOccGridResolution] = useState(1);
  const pointerStoreRef = useRef(null);
  if (!pointerStoreRef.current) {
    pointerStoreRef.current = createPointerStore({ x: 0, y: 0, worldX: 0, worldY: 0 });
  }
  const [confirmationMessage, setConfirmationMessage] = useState('');
  const [confirmationIsWarning, setConfirmationIsWarning] = useState(false);
  const confirmationTimeoutRef = useRef(null);
  const [invalidGoalMessages, setInvalidGoalMessages] = useState({});
  const [hoveredRobotId, setHoveredRobotId] = useState(null);
  const hoveredRobotIdRef = useRef(null);
  hoveredRobotIdRef.current = hoveredRobotId;
  const [airQualityHoverPointer, setAirQualityHoverPointer] = useState(null);
  const [poseDrag, setPoseDrag] = useState(null);
  const [spacePanActive, setSpacePanActive] = useState(false);
  const [shiftPanActive, setShiftPanActive] = useState(false);
  const poseDragRef = useRef(null);
  const middlePanRef = useRef(null);
  poseDragRef.current = poseDrag;

  const [mapImage, setMapImage] = useState(null);
  const prevRobotCountRef = useRef(null);
  const prevGoalSignaturesRef = useRef({});
  const goalClickScreenRef = useRef({});
  const proximityDismissLatchRef = useRef(new Set());
  const prevPathDismissedRef = useRef({});

  const transform = useMemo(
    () => ({ occGridWidth, occGridResolution, gridCellSize }),
    [occGridWidth, occGridResolution],
  );

  // Query for occupancy grid (server returns width/height 0 when no map is loaded yet)
  const { loading: mapLoading, error: mapError, data: mapData, refetch: refetchMap } = useQuery(
    GET_OCCUPANCY_GRID,
    { fetchPolicy: 'cache-and-network', notifyOnNetworkStatusChange: true }
  );

  const hasMap = mapData?.map?.width > 0 && mapData?.map?.height > 0;

  // The map is fetched once, not polled. When GraphQL comes back (e.g. the local stack was just
  // started), retry a failed map load instead of waiting for the Retry button.
  const prevPositionsErrorRef = useRef(positionsError);
  useEffect(() => {
    const recovered = prevPositionsErrorRef.current && !positionsError;
    prevPositionsErrorRef.current = positionsError;
    if (recovered && mapError && !hasMap) {
      refetchMap().catch(() => {});
    }
  }, [positionsError, mapError, hasMap, refetchMap]);

  // Keep Konva stage matched to the map panel (resize with window / column drag)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const updateSize = () => {
      const width = Math.floor(el.clientWidth);
      const height = Math.floor(el.clientHeight);
      if (width <= 0 || height <= 0) return;
      setMapSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasMap]);

  useEffect(() => {
    const prev = prevPathDismissedRef.current;
    const next = pathDisplayDismissed;
    Object.keys(prev).forEach((key) => {
      const id = Number(key);
      if (prev[key] && !next[id]) {
        proximityDismissLatchRef.current.delete(id);
      }
    });
    prevPathDismissedRef.current = { ...next };
  }, [pathDisplayDismissed]);

  // Query for robot goals with explicit polling
  const { data: goalsData } = useQuery(GET_ROBOT_GOALS, defaultPollOptions);

  const serverGoalMarkers = useMemo(() => {
    const markers = {};
    (goalsData?.robotGoals ?? EMPTY_ARRAY).forEach((goal) => {
      if (goal.goal_valid) {
        markers[goal.id] = mapToPixel(transform, goal.x_goal, goal.y_goal);
      }
    });
    return markers;
  }, [goalsData, transform]);

  const goalMarkers = useMemo(() => {
    const overrideIds = Object.keys(goalOverrides);
    if (overrideIds.length === 0) return serverGoalMarkers;
    const merged = { ...serverGoalMarkers };
    overrideIds.forEach((id) => {
      if (goalOverrides[id]) {
        merged[id] = goalOverrides[id];
      } else {
        delete merged[id];
      }
    });
    return merged;
  }, [serverGoalMarkers, goalOverrides]);

  useEffect(() => {
    const goals = goalsData?.robotGoals;
    if (!goals) return;
    devLog('Fetched robot goals:', goalsData);

    const changedIds = [];
    const nextInvalidGoalMessages = {};
    const nowSec = Date.now() / 1000;

    goals.forEach((goal) => {
      const sig = `${goal.x_goal},${goal.y_goal},${goal.goal_timestamp}`;
      const prevSig = prevGoalSignaturesRef.current[goal.id];
      if (prevSig !== undefined && prevSig !== sig) {
        clearPathDismissalForRobot(goal.id);
        proximityDismissLatchRef.current.delete(goal.id);
        changedIds.push(goal.id);
      }
      prevGoalSignaturesRef.current[goal.id] = sig;

      if (goal.goal_valid) {
        delete goalClickScreenRef.current[goal.id];
        return;
      }

      // Show near the click for a few seconds after the robot rejects the goal.
      const goalTimeSec = Number(goal.goal_timestamp);
      const timeDiffInSeconds = nowSec - goalTimeSec;
      if (timeDiffInSeconds >= 0 && timeDiffInSeconds < INVALID_GOAL_DISPLAY_SEC) {
        devWarn(`Invalid goal for robot ${goal.id} at (${goal.x_goal}, ${goal.y_goal})`);
        const world = mapToPixel(transform, goal.x_goal, goal.y_goal);
        const clickPos = goalClickScreenRef.current[goal.id];
        nextInvalidGoalMessages[goal.id] = {
          timestamp: goalTimeSec,
          screenX: clickPos?.x,
          screenY: clickPos?.y,
          worldX: world.x,
          worldY: world.y,
        };
      }
    });

    if (changedIds.length > 0) {
      setGoalOverrides((prev) => {
        let next = prev;
        changedIds.forEach((id) => {
          if (!(id in next)) return;
          if (next === prev) next = { ...prev };
          delete next[id];
        });
        return next;
      });
    }
    setInvalidGoalMessages((prev) =>
      Object.keys(prev).length === 0 && Object.keys(nextInvalidGoalMessages).length === 0
        ? prev
        : nextInvalidGoalMessages,
    );
    // transform is read for tooltip placement only; recompute when goals change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalsData, clearPathDismissalForRobot]);

  // Expire invalid-goal tooltips; polls no longer re-render the map while data is unchanged.
  useEffect(() => {
    const timestamps = Object.values(invalidGoalMessages).map((info) => info.timestamp);
    if (timestamps.length === 0) return undefined;
    const expiresAtMs = (Math.min(...timestamps) + INVALID_GOAL_DISPLAY_SEC) * 1000;
    const timer = setTimeout(() => {
      const nowSec = Date.now() / 1000;
      setInvalidGoalMessages((prev) => {
        const next = {};
        Object.entries(prev).forEach(([id, info]) => {
          if (nowSec - info.timestamp < INVALID_GOAL_DISPLAY_SEC) next[id] = info;
        });
        return next;
      });
    }, Math.max(0, expiresAtMs - Date.now()));
    return () => clearTimeout(timer);
  }, [invalidGoalMessages]);

  // Query for robot paths with explicit polling
  const { data: pathsData, error: pathsError } = useQuery(GET_ROBOT_PATHS, {
    ...defaultPollOptions,
    skip: !showPaths,
  });

  useEffect(() => {
    if (pathsError) console.error('Error fetching robot paths:', pathsError);
  }, [pathsError]);

  // Robot id → flat [x0, y0, x1, y1, ...] pixel points
  const robotPaths = useMemo(() => {
    const pathsByRobot = {};
    (pathsData?.robotPaths ?? EMPTY_ARRAY).forEach((point) => {
      if (!pathsByRobot[point.id]) {
        pathsByRobot[point.id] = [];
      }
      point.x.forEach((xValue, index) => {
        const p = mapToPixel(transform, xValue, point.y[index]);
        pathsByRobot[point.id].push(p.x, p.y);
      });
    });
    return pathsByRobot;
  }, [pathsData, transform]);

  const { data: objectsData, error: objectsError } = useQuery(GET_OBJECT_POSITIONS, {
    ...defaultPollOptions,
    pollInterval: OBJECT_POLL_INTERVAL,
  });

  useEffect(() => {
    if (objectsError) console.error('Error fetching object positions:', objectsError);
  }, [objectsError]);

  useEffect(() => {
    setObjectsCleared(false);
  }, [objectsData]);

  const detectedObjects = objectsCleared
    ? EMPTY_ARRAY
    : objectsData?.objectPositions ?? EMPTY_ARRAY;

  // Add the mutation
  const [clearAllObjects] = useMutation(CLEAR_ALL_OBJECTS, {
    refetchQueries: [{ query: GET_OBJECT_POSITIONS }],
    onCompleted: () => {
      devLog('All objects cleared successfully');
      // Clear locally for faster UI response until the next object poll result.
      setObjectsCleared(true);
    },
    onError: (error) => {
      console.error('Error clearing objects:', error);
    }
  });

  // When every robot leaves the environment, clear objects the same way as the toolbar button.
  useEffect(() => {
    if (positionsError) return;
    const n = robotPositions.length;
    const prev = prevRobotCountRef.current;
    if (prev !== null && prev > 0 && n === 0) {
      clearAllObjects();
    }
    prevRobotCountRef.current = n;
  }, [robotPositions, positionsError, clearAllObjects]);

  const hidePathThresholdPx = 30;

  // Hide a robot's path once it gets close to its goal.
  useEffect(() => {
    if (!hasMap || occGridWidth <= 0) return;
    robotPositions.forEach((robot) => {
      const goal = goalMarkers[robot.id];
      if (!goal) return;
      if (pathDisplayDismissed[robot.id]) return;
      const robotPx = mapToPixel(transform, robot.x, robot.y);
      const distance = calculateDistance(robotPx.x, robotPx.y, goal.x, goal.y);
      if (distance < hidePathThresholdPx) {
        if (!proximityDismissLatchRef.current.has(robot.id)) {
          proximityDismissLatchRef.current.add(robot.id);
          dismissPathForRobot(robot.id);
        }
      }
    });
  }, [
    robotPositions,
    goalMarkers,
    hasMap,
    occGridWidth,
    transform,
    pathDisplayDismissed,
    dismissPathForRobot,
  ]);

  useEffect(() => {
    if (!mapData || !mapData.map) return;

    const { width, height, resolution, occupancy } = mapData.map;
    if (!width || !height) {
      setOccGridWidth(0);
      setOccGridHeight(0);
      setOccGridResolution(1);
      setMapImage(null);
      return;
    }

    setOccGridWidth(width);
    setOccGridHeight(height);
    setOccGridResolution(resolution);

    devLog('Pre-rendering map image:', width, 'x', height);

    // One pixel per cell; MapImageLayer scales it up by gridCellSize.
    setMapImage(createOccupancyCanvas(occupancy, width, height));
  }, [mapData]);

  const isPosePlacementMode =
    positionMode === 'goal' ||
    positionMode === 'initial' ||
    positionMode === 'multiPlan' ||
    positionMode === 'patrol';

  const canStartPoseDrag =
    isPosePlacementMode &&
    (positionMode === 'patrol' ||
      (Boolean(selectedRobotId) &&
        (positionMode !== 'multiPlan' || multiPlanFleetIds.includes(selectedRobotId))));

  const commitPoseDrag = useCallback(
    (drag) => {
      const { anchorWorld, pointerWorld, mapX, mapY } = drag;
      const thetaRad = mapDragToRobotThetaRad(anchorWorld, pointerWorld);

      if (positionMode === 'patrol') {
        devLog(`Staging patrol point at`, mapX, mapY, thetaRad);
        onStagePatrolPoint(mapX, mapY, thetaRad);
      } else if (positionMode === 'multiPlan') {
        devLog(`Staging multi goal for robot ${selectedRobotId} at`, mapX, mapY, thetaRad);
        onStageMultiGoal(selectedRobotId, mapX, mapY, thetaRad);
      } else if (positionMode === 'goal') {
        devLog(`Setting goal for robot ${selectedRobotId} at`, mapX, mapY, thetaRad);
        goalClickScreenRef.current[selectedRobotId] = {
          x: drag.anchorScreen.x,
          y: drag.anchorScreen.y,
        };
        setGoalOverrides((prev) => ({
          ...prev,
          [selectedRobotId]: { x: anchorWorld.x, y: anchorWorld.y },
        }));
        onSetGoal(selectedRobotId, mapX, mapY, thetaRad);
      } else {
        devLog(`Setting initial position for robot ${selectedRobotId} at`, mapX, mapY, thetaRad);
        const initResultPromise = Promise.resolve(
          onSetInitialPosition(selectedRobotId, mapX, mapY, thetaRad),
        );
        if (confirmationTimeoutRef.current) {
          clearTimeout(confirmationTimeoutRef.current);
          confirmationTimeoutRef.current = null;
        }
        setConfirmationIsWarning(false);
        setConfirmationMessage(`Initial position set for Robot ${selectedRobotId}`);
        confirmationTimeoutRef.current = setTimeout(() => {
          setConfirmationMessage('');
          setConfirmationIsWarning(false);
          confirmationTimeoutRef.current = null;
        }, 1500);

        initResultPromise.then((result) => {
          if (result?.mcuConnected !== false) return;
          if (confirmationTimeoutRef.current) {
            clearTimeout(confirmationTimeoutRef.current);
            confirmationTimeoutRef.current = null;
          }
          setConfirmationIsWarning(true);
          setConfirmationMessage(
            `Microcontroller is not connected on robot ${selectedRobotId}: check that the power is on and the 5V battery is charged.`,
          );
          confirmationTimeoutRef.current = setTimeout(() => {
            setConfirmationMessage('');
            setConfirmationIsWarning(false);
            confirmationTimeoutRef.current = null;
          }, 10000);
        });
      }
    },
    [
      positionMode,
      selectedRobotId,
      onStageMultiGoal,
      onStagePatrolPoint,
      onSetGoal,
      onSetInitialPosition,
    ],
  );

  const cancelPoseDrag = useCallback(() => {
    if (!poseDragRef.current) return;
    poseDragRef.current = null;
    setPoseDrag(null);
    if (stageRef.current) {
      stageRef.current.draggable(true);
    }
  }, []);

  const finishPoseDrag = useCallback(() => {
    const drag = poseDragRef.current;
    if (!drag) return;

    poseDragRef.current = null;
    setPoseDrag(null);
    if (stageRef.current) {
      stageRef.current.draggable(true);
    }

    const screenDist = Math.hypot(
      drag.pointerScreen.x - drag.anchorScreen.x,
      drag.pointerScreen.y - drag.anchorScreen.y,
    );
    if (screenDist < MIN_DRAG_PX) {
      return;
    }

    commitPoseDrag(drag);
  }, [commitPoseDrag]);

  useEffect(() => {
    if (!poseDrag) return undefined;
    const onWindowMouseUp = () => finishPoseDrag();
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cancelPoseDrag();
    };
    window.addEventListener('mouseup', onWindowMouseUp);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('mouseup', onWindowMouseUp);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [poseDrag, finishPoseDrag, cancelPoseDrag]);

  useEffect(() => {
    const isTypingTarget = (el) =>
      el &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable);

    const onKeyDown = (e) => {
      if (isTypingTarget(e.target)) return;
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setSpacePanActive(true);
      } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        setShiftPanActive(true);
      }
    };
    const onKeyUp = (e) => {
      if (e.code === 'Space') {
        setSpacePanActive(false);
      } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        setShiftPanActive(false);
      }
    };
    const onBlur = () => {
      setSpacePanActive(false);
      setShiftPanActive(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const handleStageMouseUp = () => {
    middlePanRef.current = null;
    finishPoseDrag();
  };

  const handlePoseMouseDown = (e) => {
    if (!stageRef.current) return;

    const stage = stageRef.current;
    const button = e.evt?.button ?? 0;

    if (button === 1) {
      middlePanRef.current = {
        clientX: e.evt.clientX,
        clientY: e.evt.clientY,
        stageX: stage.x(),
        stageY: stage.y(),
      };
      return;
    }

    const modifierPan = spacePanActive || shiftPanActive || e.evt?.shiftKey;
    if (!canStartPoseDrag || button !== 0 || modifierPan) return;
    const pointerPosition = stage.getPointerPosition();
    if (!pointerPosition) return;

    const worldPos = pointerToWorld(stage, pointerPosition);
    const { mapX, mapY } = worldToMapCoords(
      worldPos,
      occGridWidth,
      gridCellSize,
      occGridResolution,
    );

    const drag = {
      anchorWorld: { x: worldPos.x, y: worldPos.y },
      pointerWorld: { x: worldPos.x, y: worldPos.y },
      anchorScreen: { x: pointerPosition.x, y: pointerPosition.y },
      pointerScreen: { x: pointerPosition.x, y: pointerPosition.y },
      mapX,
      mapY,
    };
    poseDragRef.current = drag;
    setPoseDrag(drag);
    stage.stopDrag();
    stage.draggable(false);

    if (e.evt) {
      e.evt.preventDefault();
    }
  };

  const handleMouseMove = (e) => {
    if (!stageRef.current) return;

    const stage = stageRef.current;

    if (middlePanRef.current && e?.evt) {
      const mp = middlePanRef.current;
      stage.position({
        x: mp.stageX + (e.evt.clientX - mp.clientX),
        y: mp.stageY + (e.evt.clientY - mp.clientY),
      });
      stage.batchDraw();
    }

    const pointerPosition = stage.getPointerPosition();

    if (pointerPosition) {
      const worldPos = pointerToWorld(stage, pointerPosition);
      const { mapX, mapY } = worldToMapCoords(
        worldPos,
        occGridWidth,
        gridCellSize,
        occGridResolution,
      );

      if (poseDragRef.current) {
        const next = {
          ...poseDragRef.current,
          pointerWorld: { x: worldPos.x, y: worldPos.y },
          pointerScreen: { x: pointerPosition.x, y: pointerPosition.y },
        };
        poseDragRef.current = next;
        setPoseDrag(next);
      }

      // Only CursorOverlay subscribes to this, so the map itself does not re-render.
      pointerStoreRef.current.set({
        x: pointerPosition.x,
        y: pointerPosition.y,
        worldX: mapX,
        worldY: mapY,
      });
    }
  };

  const handleRobotPointerEnter = useCallback(
    (robotId, pointer) => {
      if (!showAirQualityOnHover) return;
      setHoveredRobotId(robotId);
      if (pointer) setAirQualityHoverPointer(pointer);
    },
    [showAirQualityOnHover],
  );

  const handleRobotPointerMove = useCallback(
    (robotId, pointer) => {
      if (!showAirQualityOnHover || hoveredRobotIdRef.current !== robotId) return;
      if (pointer) setAirQualityHoverPointer(pointer);
    },
    [showAirQualityOnHover],
  );

  const handleRobotPointerLeave = useCallback(() => {
    setHoveredRobotId(null);
    setAirQualityHoverPointer(null);
  }, []);

  const handleWheel = (e) => {
    e.evt.preventDefault();

    if (!stageRef.current) return;

    const stage = stageRef.current;
    const oldScale = stage.scaleX();

    const pointerPosition = stage.getPointerPosition();

    // Calculate new scale
    // The zoom speed factor can be adjusted (0.1 is a moderate speed)
    const zoomSpeed = 0.1;
    let newScale = e.evt.deltaY < 0 ? oldScale * (1 + zoomSpeed) : oldScale * (1 - zoomSpeed);

    // Limit scale
    newScale = Math.max(minScale, Math.min(newScale, maxScale));

    // Calculate new position so we zoom toward the pointer position
    const mousePointTo = {
      x: (pointerPosition.x - stage.x()) / oldScale,
      y: (pointerPosition.y - stage.y()) / oldScale,
    };

    const newPos = {
      x: pointerPosition.x - mousePointTo.x * newScale,
      y: pointerPosition.y - mousePointTo.y * newScale,
    };

    // Zoom is applied directly to the stage (uncontrolled) to avoid re-rendering the map.
    stage.scale({ x: newScale, y: newScale });
    stage.position(newPos);
    stage.batchDraw();
  };

  const handleDragStart = (e) => {
    if (poseDragRef.current) {
      e.target.stopDrag();
    }
  };

  // Clear goal for the selected robot
  const clearGoal = () => {
    if (!selectedRobotId) return;
    setGoalOverrides((prev) => ({ ...prev, [selectedRobotId]: null }));
  };

  // Clear all goals
  const clearAllGoals = () => {
    setGoalOverrides(() => {
      const next = {};
      Object.keys(goalMarkers).forEach((id) => {
        next[id] = null;
      });
      return next;
    });
  };

  // Handler for clearing all objects
  const handleClearAllObjects = () => {
    clearAllObjects();
  };

  const [mapControlsDragging, setMapControlsDragging] = useState(false);

  useEffect(() => {
    if (!showMapControls) {
      setMapControlsDragging(false);
    }
  }, [showMapControls]);

  const isRobotVisibleOnMap = useCallback(
    (robotId) => {
      if (!showSelectedRobotOnly) return true;
      if (selectedRobotId == null) return false;
      return Number(robotId) === Number(selectedRobotId);
    },
    [showSelectedRobotOnly, selectedRobotId],
  );

  const zoomToRobot = useCallback(
    (robotId) => {
      if (!hasMap || occGridWidth <= 0 || !stageRef.current) return;
      const robot = robotPositions.find((r) => r.id === robotId);
      if (!robot || mapSize.width <= 0 || mapSize.height <= 0) return;

      const { x: cx, y: cy } = mapToPixel(transform, robot.x, robot.y);
      const targetScale = Math.min(
        maxScale,
        Math.max(minScale, ZOOM_TO_ROBOT_SCALE),
      );
      const stage = stageRef.current;
      const newPos = {
        x: mapSize.width / 2 - cx * targetScale,
        y: mapSize.height / 2 - cy * targetScale,
      };

      stage.scale({ x: targetScale, y: targetScale });
      stage.position(newPos);
      stage.batchDraw();
    },
    [
      robotPositions,
      hasMap,
      occGridWidth,
      transform,
      mapSize.width,
      mapSize.height,
    ],
  );

  useImperativeHandle(ref, () => ({ zoomToRobot }), [zoomToRobot]);

  const mapSlotStyle = {
    width: '100%',
    minHeight: 280,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
    background: '#f0f6fa',
    color: '#333',
  };

  const mapRetryButtonStyle = {
    padding: '10px 20px',
    fontSize: 15,
    cursor: mapLoading ? 'wait' : 'pointer',
    borderRadius: 6,
    border: '1px solid #90a4ae',
    background: mapLoading ? '#e0e0e0' : '#fff',
  };

  // Display loading or error states
  if (mapLoading && !mapData && !mapError) return <div>Loading map...</div>;

  if (mapError && !hasMap) {
    return (
      <div ref={containerRef} className="robot-map-host" style={mapSlotStyle}>
        <p style={{ margin: 0, maxWidth: 420, textAlign: 'center', lineHeight: 1.45 }}>
          Error loading map: {mapError.message}
        </p>
        <p style={{ margin: 0, maxWidth: 420, textAlign: 'center', lineHeight: 1.45, fontSize: 14, color: '#555' }}>
          The GraphQL endpoint could not be reached (network, CORS, or server down). Fix connectivity,
          then try again.
        </p>
        <button
          type="button"
          onClick={() => refetchMap()}
          disabled={mapLoading}
          style={mapRetryButtonStyle}
        >
          {mapLoading ? 'Retrying…' : 'Retry loading map'}
        </button>
      </div>
    );
  }

  if (positionsLoading && !robotPositions.length && !mapData) {
    return <div>Loading robot positions...</div>;
  }

  if (mapData && !hasMap) {
    return (
      <div ref={containerRef} className="robot-map-host" style={mapSlotStyle}>
        <p style={{ margin: 0, maxWidth: 420, textAlign: 'center', lineHeight: 1.45 }}>
          No occupancy map is available from the server yet. After a map has been published to
          the backend, use the button below to query again.
        </p>
        <button
          type="button"
          onClick={() => refetchMap()}
          disabled={mapLoading}
          style={mapRetryButtonStyle}
        >
          {mapLoading ? 'Refreshing map…' : 'Refresh map'}
        </button>
      </div>
    );
  }

  const modifierPanActive = spacePanActive || shiftPanActive;

  const hostClass = [
    'robot-map-host',
    mapControlsDragging ? 'robot-map-host--panel-drag' : '',
    modifierPanActive ? 'robot-map-host--modifier-pan' : '',
    canStartPoseDrag && !modifierPanActive ? 'robot-map-host--pose-place' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const mapHostTitle = canStartPoseDrag
    ? positionMode === 'patrol'
      ? 'Click and drag to add a patrol pose and heading. Hold Space or Shift and drag, or middle-mouse drag, to pan.'
      : 'Click and drag to set pose and heading. Hold Space or Shift and drag, or middle-mouse drag, to pan.'
    : 'Drag to pan. Scroll to zoom.';

  const posePreviewColor =
    positionMode === 'initial'
      ? '#2196F3'
      : positionMode === 'patrol'
        ? '#0d6e4f'
        : selectedRobotId != null
          ? getRobotColor(selectedRobotId)
          : '#333';

  const poseDragScreenDist = poseDrag
    ? Math.hypot(
        poseDrag.pointerScreen.x - poseDrag.anchorScreen.x,
        poseDrag.pointerScreen.y - poseDrag.anchorScreen.y,
      )
    : 0;
  const showPoseDragHint = poseDrag != null && poseDragScreenDist >= MIN_DRAG_PX;

  return (
    <div ref={containerRef} className={hostClass} title={mapHostTitle}>
      {positionMode === 'patrol' && (
        <div className="robot-map__patrol-banner" role="status">
          Setting patrol points — click and drag on the map to add poses
        </div>
      )}
      {/* Transient poll failures keep the map mounted; Apollo still holds the last positions. */}
      {positionsError && (
        <div
          className={`robot-map__connection-banner${
            positionMode === 'patrol' ? ' robot-map__connection-banner--below-patrol' : ''
          }`}
          role="status"
        >
          Lost connection to robot positions: {positionsError.message}. Showing last known
          positions.
        </div>
      )}
      {mapSize.width > 0 && mapSize.height > 0 && (
      <Stage
        ref={stageRef}
        width={mapSize.width}
        height={mapSize.height}
        onMouseDown={handlePoseMouseDown}
        onMouseUp={handleStageMouseUp}
        onWheel={handleWheel}
        onMouseMove={handleMouseMove}
        draggable={!poseDrag && (!canStartPoseDrag || modifierPanActive)}
        onDragStart={handleDragStart}
        // Initial zoom only; afterwards the stage scale is changed imperatively.
        scaleX={minScale}
        scaleY={minScale}
      >
        <MapImageLayer
          mapImage={mapImage}
          width={occGridWidth * gridCellSize}
          height={occGridHeight * gridCellSize}
        />
        <PathsLayer
          robotPaths={robotPaths}
          visible={showPaths}
          strokeWidth={pathStrokeWidth}
          getRobotColor={getRobotColor}
          isRobotVisibleOnMap={isRobotVisibleOnMap}
          pathDisplayDismissed={pathDisplayDismissed}
        />
        <RobotsLayer
          robotPositions={robotPositions}
          transform={transform}
          selectedRobotId={selectedRobotId}
          robotMarkerRadius={robotMarkerRadius}
          getRobotColor={getRobotColor}
          isRobotVisibleOnMap={isRobotVisibleOnMap}
          onRobotPointerEnter={handleRobotPointerEnter}
          onRobotPointerMove={handleRobotPointerMove}
          onRobotPointerLeave={handleRobotPointerLeave}
        />
        <PoseDragLayer poseDrag={poseDrag} color={posePreviewColor} />
        <GoalsLayer
          goalMarkers={goalMarkers}
          stagedMultiGoals={stagedMultiGoals}
          stagedPatrolPoints={stagedPatrolPoints}
          robotPositions={robotPositions}
          transform={transform}
          robotMarkerRadius={robotMarkerRadius}
          getRobotColor={getRobotColor}
          isRobotVisibleOnMap={isRobotVisibleOnMap}
          pathDisplayDismissed={pathDisplayDismissed}
        />
        <ObjectsLayer detectedObjects={detectedObjects} transform={transform} />
      </Stage>
      )}

      {showPoseDragHint && (
        <div className="robot-map__pose-drag-hint" role="status" aria-live="polite">
          Press <kbd>Esc</kbd> to cancel
        </div>
      )}

      <CursorOverlay
        pointerStore={pointerStoreRef.current}
        showCursorCoordinates={showCursorCoordinates}
        confirmationMessage={confirmationMessage}
        confirmationIsWarning={confirmationIsWarning}
      />

      {showAirQualityOnHover &&
        hoveredRobotId != null &&
        airQualityHoverPointer &&
        (() => {
          const aq = airQualities.find(
            (row) => Number(row.robot_id) === Number(hoveredRobotId),
          );
          if (!aq) return null;
          const robot = robotPositions.find((r) => Number(r.id) === Number(hoveredRobotId));
          const nowSec = Date.now() / 1000;
          const readingAgeSec = Math.max(0, Math.round(nowSec - Number(aq.timestamp)));
          const posTs = robot?.position_timestamp;
          const poseStale =
            posTs == null ||
            Number(posTs) <= 0 ||
            nowSec - Number(posTs) > positionStaleSec;
          return (
            <div
              className="robot-map__air-quality-tooltip"
              style={{
                left: `${airQualityHoverPointer.x + 14}px`,
                top: `${airQualityHoverPointer.y}px`,
              }}
              role="status"
            >
              <div className="robot-map__air-quality-tooltip-title">
                Robot {hoveredRobotId} Air Quality
              </div>
              <div>Temp: {Number(aq.temperature).toFixed(1)} °F</div>
              <div>Humidity: {Number(aq.relative_humidity).toFixed(1)} %</div>
              <div>VOC: {Number(aq.voc_index).toFixed(0)}</div>
              <div>NOx: {Number(aq.nox_index).toFixed(0)}</div>
              <div className="robot-map__air-quality-tooltip-meta">
                Reading {readingAgeSec}s ago
              </div>
              {poseStale && (
                <div className="robot-map__air-quality-tooltip-warn">Pose outdated</div>
              )}
            </div>
          );
        })()}

      {/* Render tooltips for invalid goals */}
      {Object.entries(invalidGoalMessages).map(([robotId, info]) => {
        if (!isRobotVisibleOnMap(robotId)) {
          return null;
        }
        const overlayPos = resolveInvalidGoalOverlayPosition(
          stageRef.current,
          info,
        );
        if (!overlayPos) return null;

        return (
        <div
          key={`tooltip-${robotId}`}
          style={{
            position: 'absolute',
            left: `${overlayPos.x}px`,
            top: `${overlayPos.y}px`,
            backgroundColor: '#F44336',
            color: 'white',
            padding: '5px 10px',
            borderRadius: '4px',
            fontSize: '12px',
            pointerEvents: 'none',
            zIndex: 1000,
            transform: 'translate(-50%, -100%)',
            whiteSpace: 'nowrap',
          }}
        >
          Goal is invalid
        </div>
        );
      })}

      {showMapControls && (
        <MapControlsPanel
          containerRef={containerRef}
          onDraggingChange={setMapControlsDragging}
        >
          <div className="map-controls__group">
            <button type="button" onClick={clearGoal} disabled={!selectedRobotId}>
              Clear Selected Goal
            </button>
            <button type="button" onClick={clearAllGoals}>
              Clear All Goals
            </button>
            <button type="button" onClick={handleClearAllObjects}>
              Clear All Objects
            </button>
          </div>
          <div className="map-controls__zoom">
            <button
              type="button"
              onClick={() => {
                if (stageRef.current) {
                  const stage = stageRef.current;
                  const oldScale = stage.scaleX();
                  const newScale = Math.min(maxScale, oldScale * 1.2);
                  stage.scale({ x: newScale, y: newScale });
                  stage.batchDraw();
                }
              }}
            >
              +
            </button>
            <button
              type="button"
              onClick={() => {
                if (stageRef.current) {
                  const stage = stageRef.current;
                  const oldScale = stage.scaleX();
                  const newScale = Math.max(minScale, oldScale / 1.2);
                  stage.scale({ x: newScale, y: newScale });
                  stage.batchDraw();
                }
              }}
            >
              -
            </button>
            <button
              type="button"
              onClick={() => {
                if (stageRef.current) {
                  const stage = stageRef.current;
                  stage.scale({ x: minScale, y: minScale });
                  stage.position({ x: 0, y: 0 });
                  stage.batchDraw();
                }
              }}
            >
              Reset
            </button>
          </div>
        </MapControlsPanel>
      )}

    </div>
  );
});

RobotMap.displayName = 'RobotMap';

export default React.memo(RobotMap);
