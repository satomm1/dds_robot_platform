import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import './App.css';
import { ApolloProvider, useMutation, useQuery } from '@apollo/client';
import client from './apolloClient';
import RobotMap from './components/RobotMap';
import RobotSelector from './components/RobotSelector';
import RobotControls from './components/RobotControls';
import ShutDownAllButton from './components/ShutDownAllButton';
import DdsLocalControl from './components/DdsLocalControl';
import RobotStartup from './components/RobotStartup';
import ColumnResizeHandle from './components/ColumnResizeHandle';
import { useResizableColumnWidth } from './hooks/useResizableColumnWidth';
import MultiRobotGoalPlanner from './components/MultiRobotGoalPlanner';
import HelpModal from './components/HelpModal';
import MapSettingsModal from './components/MapSettingsModal';
import SystemHealthBar from './components/SystemHealthBar';
import {
  readStoredRobotMarkerRadius,
  ROBOT_MARKER_RADIUS_KEY,
} from './components/RobotMarkerSizeSlider';
import {
  MAP_PATH_WIDTH_KEY,
  MAP_SHOW_CURSOR_COORDS_KEY,
  MAP_SHOW_PATHS_KEY,
  MAP_SHOW_AIR_QUALITY_HOVER_KEY,
  MAP_SHOW_MAP_CONTROLS_KEY,
  MAP_SHOW_SELECTED_ROBOT_ONLY_KEY,
  readStoredMapPathWidth,
  readStoredMapShowAirQualityHover,
  readStoredMapShowCursorCoords,
  readStoredMapShowMapControls,
  readStoredMapShowPaths,
  readStoredMapShowSelectedRobotOnly,
} from './utils/mapDisplaySettings';
import { RobotColorProvider } from './hooks/useRobotColors';
import { SET_ROBOT_GOAL, SET_ROBOT_INITIAL_POSITION, SET_MULTI_ROBOT_GOAL_PLAN, CLEAR_ROBOT_PATH } from './mutations';
import { GET_ROBOT_POSITIONS, GET_ROBOT_PATHS, GET_AIR_QUALITIES } from './queries';

const ROBOT_POSITIONS_POLL_MS = 2000;
const POSITION_STALE_SEC = 31;
const SIDEBAR_LEFT_WIDTH_KEY = 'dds_gui_sidebar_left_width';
const SIDEBAR_RIGHT_WIDTH_KEY = 'dds_gui_sidebar_right_width';
const devLog = (...args) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(...args);
  }
};

function App() {
  return (
    <ApolloProvider client={client}>
      <RobotColorProvider>
        <AppContent />
      </RobotColorProvider>
    </ApolloProvider>
  );
}

// Create a new component that's wrapped by ApolloProvider
function AppContent() {
  const { width: leftSidebarWidth, beginResize: beginLeftResize } = useResizableColumnWidth({
    storageKey: SIDEBAR_LEFT_WIDTH_KEY,
    defaultWidth: 250,
    minWidth: 180,
    maxWidth: 520,
    side: 'left',
  });
  const { width: rightSidebarWidth, beginResize: beginRightResize } = useResizableColumnWidth({
    storageKey: SIDEBAR_RIGHT_WIDTH_KEY,
    defaultWidth: 280,
    minWidth: 220,
    maxWidth: 520,
    side: 'right',
  });

  const [helpOpen, setHelpOpen] = useState(false);
  const [mapSettingsOpen, setMapSettingsOpen] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const [selectedRobotId, setSelectedRobotId] = useState(null);
  const mapRef = useRef(null);

  const handleCenterOnRobot = useCallback((robotId) => {
    mapRef.current?.zoomToRobot(robotId);
  }, []);

  const setRightSidebarCollapsedPersisted = useCallback((collapsed) => {
    setRightSidebarCollapsed(collapsed);
  }, []);
  const [robotMarkerRadius, setRobotMarkerRadius] = useState(readStoredRobotMarkerRadius);
  const [mapShowPaths, setMapShowPaths] = useState(readStoredMapShowPaths);
  const [mapPathWidth, setMapPathWidth] = useState(readStoredMapPathWidth);
  const [mapShowCursorCoords, setMapShowCursorCoords] = useState(
    readStoredMapShowCursorCoords,
  );
  const [mapShowSelectedRobotOnly, setMapShowSelectedRobotOnly] = useState(
    readStoredMapShowSelectedRobotOnly,
  );
  const [mapShowAirQualityOnHover, setMapShowAirQualityOnHover] = useState(
    readStoredMapShowAirQualityHover,
  );
  const [mapShowMapControls, setMapShowMapControls] = useState(readStoredMapShowMapControls);

  useEffect(() => {
    localStorage.setItem(ROBOT_MARKER_RADIUS_KEY, String(robotMarkerRadius));
  }, [robotMarkerRadius]);

  useEffect(() => {
    localStorage.setItem(MAP_SHOW_PATHS_KEY, mapShowPaths ? '1' : '0');
  }, [mapShowPaths]);

  useEffect(() => {
    localStorage.setItem(MAP_PATH_WIDTH_KEY, String(mapPathWidth));
  }, [mapPathWidth]);

  useEffect(() => {
    localStorage.setItem(MAP_SHOW_CURSOR_COORDS_KEY, mapShowCursorCoords ? '1' : '0');
  }, [mapShowCursorCoords]);

  useEffect(() => {
    localStorage.setItem(
      MAP_SHOW_SELECTED_ROBOT_ONLY_KEY,
      mapShowSelectedRobotOnly ? '1' : '0',
    );
  }, [mapShowSelectedRobotOnly]);

  useEffect(() => {
    localStorage.setItem(
      MAP_SHOW_AIR_QUALITY_HOVER_KEY,
      mapShowAirQualityOnHover ? '1' : '0',
    );
  }, [mapShowAirQualityOnHover]);

  useEffect(() => {
    localStorage.setItem(MAP_SHOW_MAP_CONTROLS_KEY, mapShowMapControls ? '1' : '0');
  }, [mapShowMapControls]);

  const { data: positionsData, loading: positionsLoading, error: positionsError } = useQuery(
    GET_ROBOT_POSITIONS,
    {
      pollInterval: ROBOT_POSITIONS_POLL_MS,
      fetchPolicy: 'cache-and-network',
    }
  );
  const robotPositions = useMemo(
    () => positionsData?.robotPositions ?? [],
    [positionsData]
  );

  const { data: airQualitiesData } = useQuery(GET_AIR_QUALITIES, {
    pollInterval: ROBOT_POSITIONS_POLL_MS,
    fetchPolicy: 'cache-and-network',
    skip: !mapShowAirQualityOnHover,
  });
  const airQualities = useMemo(
    () => airQualitiesData?.airQualities ?? [],
    [airQualitiesData]
  );

  // Now this hook is inside the ApolloProvider context
  const [setRobotGoal] = useMutation(SET_ROBOT_GOAL);

  // State to manage position mode (goal, initial, or coordinated multi-robot plan)
  const [positionMode, setPositionMode] = useState('goal'); // 'goal' | 'initial' | 'multiPlan'
  const prevRobotCountRef = useRef(null);

  const [multiFleet, setMultiFleet] = useState({});
  const [stagedMultiGoals, setStagedMultiGoals] = useState({});
  const [multiPlanId, setMultiPlanId] = useState('gui_1');
  const nextMultiPlanSuffixRef = useRef(2);
  const [multiCoordinated, setMultiCoordinated] = useState(true);
  const [multiSubmitError, setMultiSubmitError] = useState('');

  const [setMultiRobotGoalPlan, { loading: multiSubmitting }] = useMutation(SET_MULTI_ROBOT_GOAL_PLAN);

  const [pathDisplayDismissed, setPathDisplayDismissed] = useState({});
  const [clearRobotPathMutation] = useMutation(CLEAR_ROBOT_PATH, {
    refetchQueries: [{ query: GET_ROBOT_PATHS }],
  });

  const dismissPathForRobot = useCallback(
    (robotId) => {
      const id = Number(robotId);
      clearRobotPathMutation({ variables: { robotId: id } }).catch((err) => {
        console.error('clearRobotPath:', err);
      });
      setPathDisplayDismissed((prev) => ({ ...prev, [id]: true }));
    },
    [clearRobotPathMutation]
  );

  const clearPathDismissalForRobot = useCallback((robotId) => {
    const id = Number(robotId);
    setPathDisplayDismissed((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const clearPathDismissalForRobots = useCallback((robotIds) => {
    setPathDisplayDismissed((prev) => {
      let next = prev;
      for (const rid of robotIds) {
        const id = Number(rid);
        if (!next[id]) continue;
        if (next === prev) next = { ...prev };
        delete next[id];
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (positionsError) return;
    const n = robotPositions.length;
    const prev = prevRobotCountRef.current;
    if (prev === 0 && n > 0) {
      setPositionMode('initial');
    }
    prevRobotCountRef.current = n;
  }, [robotPositions, positionsError]);

  const selectGoalMode = useCallback(() => {
    setPositionMode('goal');
    setMultiSubmitError('');
  }, []);

  const selectInitialMode = useCallback(() => {
    setPositionMode('initial');
    setMultiSubmitError('');
  }, []);

  const selectMultiPlanMode = useCallback(() => {
    setPositionMode('multiPlan');
    setMultiSubmitError('');
  }, []);

  useEffect(() => {
    const isTypingTarget = (el) =>
      el &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable);

    const onKeyDown = (e) => {
      if (isTypingTarget(e.target) || e.repeat) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }

      if (helpOpen) return;

      if (e.key === 'g' || e.key === 'G') {
        e.preventDefault();
        selectGoalMode();
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        selectInitialMode();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        selectMultiPlanMode();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [helpOpen, selectGoalMode, selectInitialMode, selectMultiPlanMode]);

  // Mutation for setting the robot's initial position
  const [setRobotInitialPosition] = useMutation(SET_ROBOT_INITIAL_POSITION);
  
  const handleSetRobotGoal = (robotId, x, y, thetaRad) => {
    devLog(
      `Setting goal for robot ${robotId} to position (${x}, ${y}, ${((thetaRad * 180) / Math.PI).toFixed(1)}°)`,
    );
    clearPathDismissalForRobot(robotId);

    const timestamp = new Date().getTime() / 1000; // Convert to seconds
    setRobotGoal({
      variables: {
        robotId: robotId,
        xGoal: x,
        yGoal: y,
        thetaGoal: thetaRad,
        timestamp: timestamp
      }
    })
      .then(() => {
        clearPathDismissalForRobot(robotId);
      })
      .catch((error) => {
        console.error('Error setting robot goal:', error);
      });
  };

  const handleStageMultiGoal = (robotId, mapX, mapY, thetaRad) => {
    setStagedMultiGoals((prev) => ({
      ...prev,
      [robotId]: { mapX, mapY, theta: thetaRad },
    }));
    setMultiSubmitError('');
  };

  const toggleMultiFleet = (robotId) => {
    setMultiFleet((prev) => ({
      ...prev,
      [robotId]: !prev[robotId],
    }));
    setMultiSubmitError('');
  };

  const clearStagedMultiGoals = () => {
    setStagedMultiGoals({});
    setMultiSubmitError('');
  };

  const handleSubmitMultiRobotPlan = () => {
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
  };

  const handleSetRobotInitialPosition = (robotId, x, y, thetaRad) => {
    devLog(
      `Setting initial position for robot ${robotId} to (${x}, ${y}, ${((thetaRad * 180) / Math.PI).toFixed(1)}°)`,
    );

    const timestamp = new Date().getTime() / 1000;
    setRobotInitialPosition({
      variables: {
        robotId: robotId,
        x: x,
        y: y,
        theta: thetaRad,
        timestamp: timestamp
      }
    }).catch(error => {
      console.error('Error setting robot initial position:', error);
    });
  };

  return (
    <div className="App">
      <header className="App-header">
        <div className="App-header__left-actions">
          <button
            type="button"
            className="App-header__toolbar-btn"
            onClick={() => setHelpOpen(true)}
          >
            Help
          </button>
          <button
            type="button"
            className="App-header__toolbar-btn"
            onClick={() => setMapSettingsOpen(true)}
          >
            Map Settings
          </button>
        </div>
        <h1 className="App-header__title">
          <a
            className="App-header__title-link"
            href="https://satomm1.github.io/mattbot/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Robot Controller
          </a>
        </h1>
        <div className="App-header__credit">
          <a
            className="App-header__credit-link"
            href="https://www.linkedin.com/in/matthew-sato-4ab47514b"
            target="_blank"
            rel="noopener noreferrer"
          >
            Matthew Sato
          </a>
          <br />
          <a
            className="App-header__credit-link"
            href="https://eil.stanford.edu/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Engineering Informatics Group
          </a>
          <br />
          Stanford University
        </div>
      </header>
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      {mapSettingsOpen && (
        <MapSettingsModal
          onClose={() => setMapSettingsOpen(false)}
          robotMarkerRadius={robotMarkerRadius}
          onRobotMarkerRadiusChange={setRobotMarkerRadius}
          showPaths={mapShowPaths}
          onShowPathsChange={setMapShowPaths}
          pathWidth={mapPathWidth}
          onPathWidthChange={setMapPathWidth}
          showCursorCoords={mapShowCursorCoords}
          onShowCursorCoordsChange={setMapShowCursorCoords}
          showSelectedRobotOnly={mapShowSelectedRobotOnly}
          onShowSelectedRobotOnlyChange={setMapShowSelectedRobotOnly}
          showAirQualityOnHover={mapShowAirQualityOnHover}
          onShowAirQualityOnHoverChange={setMapShowAirQualityOnHover}
          showMapControls={mapShowMapControls}
          onShowMapControlsChange={setMapShowMapControls}
        />
      )}
      <div className="control-container">
        <div className="sidebar" style={{ width: leftSidebarWidth }}>
          <div className="sidebar__main">
            <RobotSelector 
              selectedRobotId={selectedRobotId} 
              onSelectRobot={setSelectedRobotId}
              robotPositions={robotPositions}
              positionsLoading={positionsLoading}
              positionsError={positionsError}
              showAirQualityOnHover={mapShowAirQualityOnHover}
              airQualities={airQualities}
            />
          <div className="mode-toggle">
            <button 
              className={positionMode === 'goal' ? 'btn-goal-init-active btn-goal-narrow' : 'btn-goal-init-inactive btn-goal-narrow'}
              onClick={selectGoalMode}
            >
              Set Robot Goal
            </button>
            <button 
              className={positionMode === 'initial' ? 'btn-goal-init-active btn-goal-narrow' : 'btn-goal-init-inactive btn-goal-narrow'}
              onClick={selectInitialMode}
            >
              Set Initial Position
            </button>
            <button 
              className={positionMode === 'multiPlan' ? 'btn-goal-init-active btn-goal-narrow' : 'btn-goal-init-inactive btn-goal-narrow'}
              onClick={selectMultiPlanMode}
            >
              Multi-Robot Plan
            </button>
          </div>
            <RobotControls
              selectedRobotId={selectedRobotId}
              robotPositions={robotPositions}
              positionsLoading={positionsLoading}
              positionsError={positionsError}
              dismissPathForRobot={dismissPathForRobot}
              onCenterOnRobot={handleCenterOnRobot}
            />
          {positionMode === 'multiPlan' && (
            <MultiRobotGoalPlanner
              robotPositions={robotPositions}
              multiFleet={multiFleet}
              onToggleFleet={toggleMultiFleet}
              planId={multiPlanId}
              onPlanIdChange={setMultiPlanId}
              coordinated={multiCoordinated}
              onCoordinatedChange={setMultiCoordinated}
              stagedMultiGoals={stagedMultiGoals}
              onClearStaged={clearStagedMultiGoals}
              onSubmit={handleSubmitMultiRobotPlan}
              submitting={multiSubmitting}
              submitError={multiSubmitError}
            />
          )}
          </div>
          <div className="sidebar__left-footer">
            <ShutDownAllButton
              robotPositions={robotPositions}
              positionsLoading={positionsLoading}
              dismissPathForRobot={dismissPathForRobot}
            />
          </div>
        </div>
        <ColumnResizeHandle
          onMouseDown={beginLeftResize}
          label="Resize left panel"
        />
        <div className="map-container">
          <RobotMap
            ref={mapRef}
            selectedRobotId={selectedRobotId}
            robotMarkerRadius={robotMarkerRadius}
            showPaths={mapShowPaths}
            pathStrokeWidth={mapPathWidth}
            showCursorCoordinates={mapShowCursorCoords}
            showSelectedRobotOnly={mapShowSelectedRobotOnly}
            showAirQualityOnHover={mapShowAirQualityOnHover}
            showMapControls={mapShowMapControls}
            airQualities={airQualities}
            positionStaleSec={POSITION_STALE_SEC}
            robotPositions={robotPositions}
            positionsLoading={positionsLoading}
            positionsError={positionsError}
            onSetGoal={handleSetRobotGoal}
            onSetInitialPosition={handleSetRobotInitialPosition}
            positionMode={positionMode}
            multiPlanFleetIds={Object.keys(multiFleet)
              .map(Number)
              .filter((id) => multiFleet[id])}
            stagedMultiGoals={stagedMultiGoals}
            onStageMultiGoal={handleStageMultiGoal}
            pathDisplayDismissed={pathDisplayDismissed}
            dismissPathForRobot={dismissPathForRobot}
            clearPathDismissalForRobot={clearPathDismissalForRobot}
          />
        </div>
        {rightSidebarCollapsed ? (
          <button
            type="button"
            className="sidebar-right-expand"
            onClick={() => setRightSidebarCollapsedPersisted(false)}
            aria-label="Show right panel"
            aria-expanded={false}
            title="Show Robot Startup and Local Stack"
          >
            <span className="sidebar-right-expand__chevron" aria-hidden="true">
              ‹
            </span>
            <span className="sidebar-right-expand__label">Startup Panel</span>
          </button>
        ) : (
          <>
            <div className="sidebar-right-rail">
              <button
                type="button"
                className="sidebar-right-rail__collapse"
                onClick={() => setRightSidebarCollapsedPersisted(true)}
                aria-label="Hide right panel"
                title="Hide panel"
              >
                <span aria-hidden="true">›</span>
              </button>
              <ColumnResizeHandle
                onMouseDown={beginRightResize}
                label="Resize right panel"
              />
            </div>
            <aside
              className="sidebar-right"
              aria-label="Robot startup and local stack"
              style={{ width: rightSidebarWidth }}
            >
              <div className="sidebar-right__top">
                <RobotStartup />
              </div>
              <div className="sidebar-right__footer">
                <DdsLocalControl />
                <SystemHealthBar />
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}

export default App;