import React, { useRef, useEffect, useState } from 'react';
import { Stage, Layer, Rect, Circle, Line, Text, Label, Tag } from 'react-konva';
import { Image as KonvaImage } from 'react-konva'; // Add this line
import { useQuery, useMutation } from '@apollo/client';
import { GET_OCCUPANCY_GRID, GET_ROBOT_GOALS, GET_ROBOT_PATHS, GET_OBJECT_POSITIONS } from '../queries';
import { CLEAR_ALL_OBJECTS } from '../mutations';
import { getRobotColor } from '../utils';
import MapControlsPanel from './MapControlsPanel';

const devLog = (...args) => {
  if (process.env.NODE_ENV === 'development') console.log(...args);
};
const devWarn = (...args) => {
  if (process.env.NODE_ENV === 'development') console.warn(...args);
};

const RobotMap = ({
  selectedRobotId,
  robotPositions = [],
  positionsLoading,
  positionsError,
  onSetGoal,
  onSetInitialPosition,
  positionMode,
  multiPlanFleetIds = [],
  stagedMultiGoals = {},
  onStageMultiGoal = () => {},
  pathDisplayDismissed = {},
  dismissPathForRobot = () => {},
  clearPathDismissalForRobot = () => {},
}) => {
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  // Replace single goalMarker with a map of robot IDs to goal markers
  const [goalMarkers, setGoalMarkers] = useState({});
  const [robots, setRobots] = useState([]);
  const [robotPaths, setRobotPaths] = useState({});
  const [detectedObjects, setDetectedObjects] = useState([]);
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const robotsLayerRef = useRef(null);
  const goalLayerRef = useRef(null);
  const pathLayerRef = useRef(null);
  const objectsLayerRef = useRef(null);
  const [occGridWidth, setOccGridWidth] = useState(0);
  const [occGridHeight, setOccGridHeight] = useState(0);
  const [occGridResolution, setOccGridResolution] = useState(1);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0, worldX: 0, worldY: 0 });
  const tooltipLayerRef = useRef(null);
  const [confirmationMessage, setConfirmationMessage] = useState('');
  const [invalidGoalMessages, setInvalidGoalMessages] = useState({});

  const [mapImage, setMapImage] = useState(null);
  const prevRobotCountRef = useRef(null);
  const prevGoalSignaturesRef = useRef({});
  const proximityDismissLatchRef = useRef(new Set());
  const prevPathDismissedRef = useRef({});

  // Polling interval (in milliseconds)
  const POLL_INTERVAL = 1000; // Fetch every 1 seconds
  
  const gridCellSize = 5;

  const defaultPollOptions = {
    pollInterval: POLL_INTERVAL,
    fetchPolicy: 'network-only',
    notifyOnNetworkStatusChange: true,
  };

  // Zoom scale limits
  const minScale = 0.1;
  const maxScale = 3;
  const [scale, setScale] = useState(minScale); // Start at minimum zoom level

  // Query for occupancy grid (server returns width/height 0 when no map is loaded yet)
  const { loading: mapLoading, error: mapError, data: mapData, refetch: refetchMap } = useQuery(
    GET_OCCUPANCY_GRID,
    { fetchPolicy: 'cache-and-network', notifyOnNetworkStatusChange: true }
  );

  const hasMap = mapData?.map?.width > 0 && mapData?.map?.height > 0;

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

  // Calculate distance between two points
  const calculateDistance = (x1, y1, x2, y2) => {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  };

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
  
  useEffect(() => {
    if (robotPositions && robotPositions.length >= 0) {
      devLog('Robot positions from parent:', robotPositions);
      setRobots(robotPositions);
    }
  }, [robotPositions]);

  const hidePathThresholdPx = 30;

  useEffect(() => {
    if (!hasMap || occGridWidth <= 0) return;
    robots.forEach((robot) => {
      const goal = goalMarkers[robot.id];
      if (!goal) return;
      if (pathDisplayDismissed[robot.id]) return;
      const robotX = (occGridWidth - robot.x / occGridResolution) * gridCellSize;
      const robotY = (robot.y * gridCellSize) / occGridResolution;
      const distance = calculateDistance(robotX, robotY, goal.x, goal.y);
      if (distance < hidePathThresholdPx) {
        if (!proximityDismissLatchRef.current.has(robot.id)) {
          proximityDismissLatchRef.current.add(robot.id);
          dismissPathForRobot(robot.id);
        }
      }
    });
  }, [
    robots,
    goalMarkers,
    hasMap,
    occGridWidth,
    occGridResolution,
    pathDisplayDismissed,
    dismissPathForRobot,
  ]);

  // Query for robot goals with explicit polling
  useQuery(GET_ROBOT_GOALS, {
    ...defaultPollOptions,
    onCompleted: (data) => {
      devLog('Fetched robot goals:', data);
      if (data && data.robotGoals) {
        // Update goal markers based on server data
        const newGoalMarkers = {};
        const newInvalidGoalMessages = {};

        data.robotGoals.forEach(goal => {
          const sig = `${goal.x_goal},${goal.y_goal},${goal.goal_timestamp}`;
          const prevSig = prevGoalSignaturesRef.current[goal.id];
          if (prevSig !== undefined && prevSig !== sig) {
            clearPathDismissalForRobot(goal.id);
            proximityDismissLatchRef.current.delete(goal.id);
          }
          prevGoalSignaturesRef.current[goal.id] = sig;

          if (!goal.goal_valid) {
            newGoalMarkers[goal.id] = {
              x: (occGridWidth - goal.x_goal/occGridResolution) * gridCellSize, // Convert grid coordinates to pixels
              y: goal.y_goal * gridCellSize / occGridResolution, // Convert grid coordinates to pixels
              color: 'red'
            };

            // Check if goal_timestamp is recent (less than 10 seconds ago)
            const goalTime = new Date(goal.goal_timestamp).getTime();
            const currentTime = Date.now()/1000;
            const timeDiffInSeconds = (currentTime - goalTime) ;
            
            if (timeDiffInSeconds < 5) {
              devWarn(`Invalid goal for robot ${goal.id} at (${goal.x_goal}, ${goal.y_goal}) - too old`);
              newInvalidGoalMessages[goal.id] = {
                timestamp: goalTime
              };
            }
          } else {
            newGoalMarkers[goal.id] = {
              x: (occGridWidth - goal.x_goal/occGridResolution) * gridCellSize, // Convert grid coordinates to pixels
              y: goal.y_goal * gridCellSize / occGridResolution, // Convert grid coordinates to pixels
              color: getRobotColor(goal.id)
            };
          }
        });
        setGoalMarkers(newGoalMarkers);
        setInvalidGoalMessages(newInvalidGoalMessages);
      }
    }
  });
  
  // Query for robot paths with explicit polling
  useQuery(GET_ROBOT_PATHS, {
    ...defaultPollOptions,
    onCompleted: (data) => {
      devLog('Fetched robot paths:', data);
      if (data && data.robotPaths) {
        // Process the path data
        // Group path points by robot ID
        const pathsByRobot = {};
        
        data.robotPaths.forEach(point => {
          if (!pathsByRobot[point.id]) {
            pathsByRobot[point.id] = [];
          }
          
          // Apply the same coordinate transformation as we do for robots
          point.x.forEach((xValue, index) => {
            const yValue = point.y[index];
            const transformedX = (occGridWidth - xValue / occGridResolution) * gridCellSize;
            const transformedY = yValue * gridCellSize / occGridResolution;

            // Add the transformed coordinates to the robot's path
            pathsByRobot[point.id].push(transformedX, transformedY);
          });
          
        });
        
        // Create the final path objects with color
        const newPaths = {};
        Object.entries(pathsByRobot).forEach(([robotId, points]) => {
          newPaths[robotId] = {
            points: points,
            color: getRobotColor(robotId)
          };
        });
        
        setRobotPaths(newPaths);
      }
    },
    onError: (error) => {
      console.error('Error fetching robot paths:', error);
    }
  });

  useQuery(GET_OBJECT_POSITIONS, {
    ...defaultPollOptions,
    onCompleted: (data) => {
      devLog('Fetched object positions:', data);
      if (data && data.objectPositions) {
        setDetectedObjects(data.objectPositions);
      }
    },
    onError: (error) => {
      console.error('Error fetching object positions:', error);
    }
  });

  // Add the mutation
  const [clearAllObjects] = useMutation(CLEAR_ALL_OBJECTS, {
    refetchQueries: [{ query: GET_OBJECT_POSITIONS }],
    onCompleted: () => {
      devLog('All objects cleared successfully');
      // Optionally clear the local state immediately for faster UI response
      setDetectedObjects([]);
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

    // Create an offscreen canvas
    const canvas = document.createElement('canvas');
    canvas.width = width * gridCellSize;
    canvas.height = height * gridCellSize;
    const ctx = canvas.getContext('2d');
    
    // Fill with background color first (optional)
    ctx.fillStyle = '#E4F8FF'; // Default background color
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw the grid on the canvas
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const index = y * width + x;
        const value = occupancy[index];
        
        // Only draw occupied or unknown cells (optional optimization)
        if (value === 0) continue; // Skip empty cells
        
        let color;
        if (value === 100) {
          color = '#000000';
        } else if (value !== 0) {
          color = '#A8A8A8';
        }
        
        const xPos = (width - x - 1) * gridCellSize; // Invert x for correct orientation
        const yPos = y * gridCellSize;

        ctx.fillStyle = color;
        ctx.fillRect(xPos, yPos, gridCellSize, gridCellSize);
      }
    }
    
    // Add grid lines if needed (optional)
    if (gridCellSize > 2) { // Only draw grid lines if cells are big enough
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 0.5;

      for (let x = 0; x <= width; x++) {
        ctx.beginPath();
        ctx.moveTo(x * gridCellSize, 0);
        ctx.lineTo(x * gridCellSize, height * gridCellSize);
        ctx.stroke();
      }

      for (let y = 0; y <= height; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * gridCellSize);
        ctx.lineTo(width * gridCellSize, y * gridCellSize);
        ctx.stroke();
      }
    }
    
    // Convert canvas to image
    const img = new Image();
    img.onload = () => {
      setMapImage(img);
      devLog('Map image created successfully');
    };
    img.src = canvas.toDataURL();
    
  }, [mapData, gridCellSize]);

  // Update robots layer when robot positions change
  useEffect(() => {
    if (robotsLayerRef.current && robots.length > 0) {
      devLog('Redrawing robots layer with', robots.length, 'robots');
      robotsLayerRef.current.batchDraw();
    }

    // If we have goal markers, redraw the goal layer too
    // since it depends on robot positions for the dotted lines
    if (goalLayerRef.current && Object.keys(goalMarkers).length > 0) {
      devLog('Redrawing goal layer due to robot position update');
      goalLayerRef.current.batchDraw();
    }
  }, [robots, goalMarkers]);

  // Update path layer when robot paths change
  useEffect(() => {
    if (pathLayerRef.current && Object.keys(robotPaths).length > 0) {
      devLog('Redrawing path layer with', Object.keys(robotPaths).length, 'paths');
      pathLayerRef.current.batchDraw();
    }
  }, [robotPaths]);

  const handleMapClick = (e) => {
    if (!stageRef.current || !selectedRobotId) return;
    
    const stage = stageRef.current;
    const pointerPosition = stage.getPointerPosition();
    
    if (pointerPosition) {
      // Get current scale and position of the stage
      const transform = stage.getAbsoluteTransform().copy().invert();
      // Convert screen coordinates to world coordinates
      const worldPos = transform.point(pointerPosition);

      // Calculate map coordinates
      const mapX = (occGridWidth - worldPos.x/gridCellSize)*occGridResolution;
      const mapY = worldPos.y*occGridResolution/gridCellSize;

      if (positionMode === 'multiPlan') {
        if (!multiPlanFleetIds.includes(selectedRobotId)) {
          return;
        }
        devLog(`Staging multi goal for robot ${selectedRobotId} at`, mapX, mapY);
        onStageMultiGoal(selectedRobotId, mapX, mapY);
        if (goalLayerRef.current) {
          goalLayerRef.current.batchDraw();
        }
        return;
      }
      
      if (positionMode === 'goal') {
        devLog(`Setting new goal marker for robot ${selectedRobotId} at`, worldPos.x, worldPos.y);
        
        // Update goalMarkers
        setGoalMarkers(prevMarkers => ({
          ...prevMarkers,
          [selectedRobotId]: {
            x: worldPos.x,
            y: worldPos.y,
            color: getRobotColor(selectedRobotId)
          }
        }));
        
        // Send goal to backend
        onSetGoal(selectedRobotId, mapX, mapY);
      } else {
        devLog(`Setting initial position for robot ${selectedRobotId} at`, worldPos.x, worldPos.y);
        
        // Send initial position to backend without setting a marker
        onSetInitialPosition(selectedRobotId, mapX, mapY);

        // Show confirmation message
        setConfirmationMessage(`Initial position set for Robot ${selectedRobotId}`);

        // Clear message after 1.5 seconds
        setTimeout(() => {
          setConfirmationMessage('');
        }, 1500);
      }

      // Only redraw the goal layer
      if (goalLayerRef.current) {
        goalLayerRef.current.batchDraw();
      }
    }
  };

  const handleMouseMove = (e) => {
    if (!stageRef.current) return;
    
    const stage = stageRef.current;
    const pointerPosition = stage.getPointerPosition();
    
    if (pointerPosition) {
      // Get current transform to convert screen to world coordinates
      const transform = stage.getAbsoluteTransform().copy().invert();
      // Convert screen coordinates to world coordinates
      const worldPos = transform.point(pointerPosition);
      
      // Calculate the actual map coordinates using the same formula you use when setting goals
      const mapX = (occGridWidth - worldPos.x/gridCellSize)*occGridResolution;
      const mapY = worldPos.y*occGridResolution/gridCellSize;
      
      setMousePosition({
        x: pointerPosition.x,
        y: pointerPosition.y,
        worldX: mapX,
        worldY: mapY
      });
      
      // Update the tooltip layer
      if (tooltipLayerRef.current) {
        tooltipLayerRef.current.batchDraw();
      }
    }
  };

  // Helper function to get appearance of objects based on type
  const getObjectAppearance = (type) => {
    switch(type) {
      case 'person':
        return { color: 'yellow', radius: 12 };
      case 'cone':
        return { color: 'orange', radius: 10 };
      default:
        // Generate a random color for unknown object types
        // Generate a consistent hue based on the object name
        const stringToHash = (str) => {
          let hash = 0;
          for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
          }
          return hash;
        };
        const hue = Math.abs(stringToHash(type)) % 360; // Consistent hue based on type name
        return { color: `hsl(${hue}, 70%, 50%)`, radius: 10 };
    }
  };
  
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
    
    // Apply new position and scale
    setScale(newScale); // Update the scale state
    stage.scale({ x: newScale, y: newScale });
    stage.position(newPos);
    stage.batchDraw();
  };
  
  const handleDragStart = () => {
    // Optional: Add any behavior you want when dragging starts
  };
  
  const handleDragEnd = () => {
    // Optional: Add any behavior you want when dragging ends
  };

  // Clear goal for the selected robot
  const clearGoal = () => {
    if (!selectedRobotId) return;
    
    setGoalMarkers(prevMarkers => {
      const newMarkers = { ...prevMarkers };
      delete newMarkers[selectedRobotId];
      return newMarkers;
    });
    
    if (goalLayerRef.current) {
      goalLayerRef.current.batchDraw();
    }
  };

  // Clear all goals
  const clearAllGoals = () => {
    setGoalMarkers({});
    if (goalLayerRef.current) {
      goalLayerRef.current.batchDraw();
    }
  };

  // Handler for clearing all objects
  const handleClearAllObjects = () => {
    clearAllObjects();
  };

  // Toggle path visibility
  const [showPaths, setShowPaths] = useState(true);
  const [mapControlsDragging, setMapControlsDragging] = useState(false);

  const togglePaths = () => {
    setShowPaths(!showPaths);
  };

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

  if (positionsLoading && !robots.length && !mapData) {
    return <div>Loading robot positions...</div>;
  }
  if (positionsError) {
    return <div>Error loading robot positions: {positionsError.message}</div>;
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

  return (
    <div
      ref={containerRef}
      className={mapControlsDragging ? 'robot-map-host robot-map-host--panel-drag' : 'robot-map-host'}
    >
      {mapSize.width > 0 && mapSize.height > 0 && (
      <Stage 
        ref={stageRef}
        width={mapSize.width} 
        height={mapSize.height}
        onClick={handleMapClick}
        onWheel={handleWheel}
        onMouseMove={handleMouseMove}
        draggable={true}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        scaleX={scale}
        scaleY={scale}
      >
        {/* Separate layer for the grid - doesn't need to update frequently */}
        <Layer>
          {mapImage ? (
            <KonvaImage 
              image={mapImage} 
              x={0} 
              y={0} 
              width={occGridWidth * gridCellSize}
              height={occGridHeight * gridCellSize}
            />
          ) : (
            <Rect 
              width={occGridWidth * gridCellSize}
              height={occGridHeight * gridCellSize}
              fill="#E4F8FF" 
            />
          )}
        </Layer>
        
        {/* Layer for robot paths - updates when paths change */}
        <Layer ref={pathLayerRef} visible={showPaths}>
          {Object.entries(robotPaths).map(([robotId, path]) => {
            const rid = Number(robotId);
            if (pathDisplayDismissed[rid]) {
              return null;
            }
            // Check if this robot has a goal
            const goal = goalMarkers[robotId];
            const robot = robots.find(r => r.id === Number(robotId));
            
            // If robot is close to goal, don't show the path
            if (goal && robot) {
              const robotX = (occGridWidth - robot.x/occGridResolution)*gridCellSize;
              const robotY = (robot.y)*gridCellSize/occGridResolution;
              const distance = calculateDistance(robotX, robotY, goal.x, goal.y);
              
              // Define threshold distance for hiding path (adjust as needed)
              const hidePathThreshold = 30; // in pixels
              
              if (distance < hidePathThreshold) {
                return null;
              }
            }
            
            return (
              <Line
                key={`path-${robotId}`}
                points={path.points}
                stroke={path.color}
                strokeWidth={2}
                opacity={0.7}
              />
            );
          })}
        </Layer>
        
        {/* Separate layer for robots - updates with robot positions */}
        <Layer ref={robotsLayerRef}>
          {robots.map(robot => (
            <React.Fragment key={robot.id}>
              <Circle
                x={(occGridWidth*occGridResolution - robot.x)*gridCellSize/occGridResolution} // Invert x for correct orientation
                y={(robot.y)*gridCellSize/occGridResolution} // Keep y as is for correct orientation
                radius={12}
                fill={getRobotColor(robot.id)}
                stroke="#000"
                strokeWidth={robot.id === selectedRobotId ? 4 : 2}
              />
              {/* Arrow to indicate direction */}
              <Line
                points={[
                  (occGridWidth - robot.x/occGridResolution)*gridCellSize, // Start x
                  (robot.y)*gridCellSize/occGridResolution, // Start y
                  (occGridWidth - robot.x/occGridResolution)*gridCellSize - Math.cos(robot.theta)*15, // Arrow tip x
                  (robot.y)*gridCellSize/occGridResolution + Math.sin(robot.theta)*15 // Arrow tip y
                ]}
                stroke="#000"
                strokeWidth={2}
                pointerLength={5}
                pointerWidth={5}
                tension={0.5}
              />
              <Text
                x={(occGridWidth - robot.x/occGridResolution)* gridCellSize-3} // Adjust position to center the text
                y={(robot.y)*gridCellSize/occGridResolution-3} // Adjust position to center the text
                text={robot.id.toString()}
                fontSize={12}
                fill="#fff"
              />
            </React.Fragment>
          ))}
        </Layer>
        
        {/* Separate layer for the goal markers - only this layer is redrawn on clicks */}
        <Layer ref={goalLayerRef}>
          {Object.entries(goalMarkers).map(([robotId, marker]) => {
            const rid = Number(robotId);
            if (pathDisplayDismissed[rid]) {
              return null;
            }
            const robot = robots.find(r => r.id === rid);
            if (!robot) return null;

            return (
              <React.Fragment key={`goal-${robotId}`}>
                <Circle
                  x={marker.x}
                  y={marker.y}
                  radius={8}
                  fill={marker.color || "green"}
                  opacity={0.6}
                />
                <Line
                  points={[
                    (occGridWidth - robot.x/occGridResolution)*gridCellSize,
                    (robot.y)*gridCellSize/occGridResolution,
                    marker.x,
                    marker.y
                  ]}
                  stroke={marker.color || "green"}
                  strokeWidth={2}
                  dash={[5, 5]}
                />
              </React.Fragment>
            );
          })}
          {Object.entries(stagedMultiGoals).map(([robotIdStr, pos]) => {
            const robotId = Number(robotIdStr);
            if (!pos || typeof pos.mapX !== 'number') return null;
            const robot = robots.find((r) => r.id === robotId);
            const px = (occGridWidth - pos.mapX / occGridResolution) * gridCellSize;
            const py = (pos.mapY * gridCellSize) / occGridResolution;
            const color = getRobotColor(robotId);
            return (
              <React.Fragment key={`staged-multi-${robotIdStr}`}>
                <Circle
                  x={px}
                  y={py}
                  radius={10}
                  stroke={color}
                  strokeWidth={3}
                  fill="rgba(255,255,255,0.15)"
                  dash={[6, 4]}
                />
                {robot && (
                  <Line
                    points={[
                      (occGridWidth - robot.x / occGridResolution) * gridCellSize,
                      (robot.y * gridCellSize) / occGridResolution,
                      px,
                      py,
                    ]}
                    stroke={color}
                    strokeWidth={2}
                    dash={[4, 6]}
                    opacity={0.85}
                  />
                )}
              </React.Fragment>
            );
          })}
        </Layer>

        {/* Objects Layer */}
        <Layer ref={objectsLayerRef}>
          {detectedObjects.map((object) => {
            // Transform coordinates similar to how you handle robot positions
            const transformedX = (occGridWidth - object.x/occGridResolution) * gridCellSize;
            const transformedY = object.y * gridCellSize / occGridResolution;
            const { color, radius } = getObjectAppearance(object.type);
            
            return (
              <React.Fragment key={`object-${object.id}`}>
                <Circle
                  x={transformedX}
                  y={transformedY}
                  radius={radius}
                  fill={color}
                  opacity={0.75}
                  stroke="black"
                  strokeWidth={1}
                />
                <Label
                  x={transformedX + radius + 2}
                  y={transformedY - 10}
                >
                  <Tag
                    fill="rgba(255, 255, 255, 0.8)"
                    cornerRadius={3}
                    padding={3}
                  />
                  <Text
                    text={`${object.type}`}
                    fontSize={12}
                    fill="black"
                    padding={2}
                  />
                </Label>
              </React.Fragment>
            );
          })}
        </Layer>
      </Stage>
      )}

      {/* Tooltip layer outside the main stage - not affected by transforms */}
      {mousePosition && (
        <div 
          style={{
            position: 'absolute',
            left: `${mousePosition.x + 20}px`,
            top: `${mousePosition.y + 20}px`,
            backgroundColor: 'rgba(0,0,0,0.6)',
            color: 'white',
            padding: '5px',
            borderRadius: '3px',
            fontSize: '12px',
            pointerEvents: 'none', // Make sure it doesn't interfere with clicks
            zIndex: 1000
          }}
        >
          ({mousePosition.worldX.toFixed(2)}, {mousePosition.worldY.toFixed(2)})
        </div>
      )}

      {/* Confirmation message */}
      {confirmationMessage && (
        <div 
          style={{
            position: 'absolute',
            left: `${mousePosition?.x || 0}px`,
            top: `${(mousePosition?.y || 0) - 30}px`,
            backgroundColor: '#2196F3', // Blue for initial position
            color: 'white',
            padding: '6px 12px',
            borderRadius: '4px',
            fontSize: '14px',
            fontWeight: 'bold',
            pointerEvents: 'none',
            zIndex: 1000,
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            animation: 'fadeIn 0.3s'
          }}
        >
          {confirmationMessage}
        </div>
      )}

      {/* Render tooltips for invalid goals */}
      {Object.entries(invalidGoalMessages).map(([robotId, info]) => (
        <div
          key={`tooltip-${robotId}`}
          style={{
            position: 'absolute',
            left: `${stageRef.current ? stageRef.current.container().offsetLeft + (mousePosition?.x * scale) : 0}px`,
            top: `${stageRef.current ? stageRef.current.container().offsetTop + (mousePosition?.y * scale) - 35 : 0}px`,
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
      ))}
      
      {/* Controls for zoom and goal management (drag handle → snap to corner) */}
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
          <button type="button" onClick={togglePaths}>
            {showPaths ? 'Hide Paths' : 'Show Paths'}
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
      
    </div>
  );
}
export default RobotMap;