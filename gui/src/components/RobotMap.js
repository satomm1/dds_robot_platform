import React, { useRef, useEffect, useState } from 'react';
import { Stage, Layer, Rect, Circle, Line, Text, Label, Tag } from 'react-konva';
import { Image as KonvaImage } from 'react-konva'; // Add this line
import { useQuery, useMutation } from '@apollo/client';
import { GET_OCCUPANCY_GRID, GET_ROBOT_POSITIONS, GET_ROBOT_GOALS, GET_ROBOT_PATHS, GET_OBJECT_POSITIONS } from '../queries';
import { CLEAR_ALL_OBJECTS } from '../mutations';

const RobotMap = ({ selectedRobotId, onSetGoal, onSetInitialPosition, positionMode }) => {
  const [mapSize, setMapSize] = useState({ width: 1100, height: 600 });
  // Replace single goalMarker with a map of robot IDs to goal markers
  const [goalMarkers, setGoalMarkers] = useState({});
  const [robots, setRobots] = useState([]);
  const [robotPaths, setRobotPaths] = useState({});
  const [detectedObjects, setDetectedObjects] = useState([]);
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const gridLayerRef = useRef(null);
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

  const [mapImage, setMapImage] = useState(null);
  
  // Polling interval (in milliseconds)
  const POLL_INTERVAL = 1000; // Fetch every 1 seconds
  
  // Grid properties
  const gridCellSize = 5;
  
  // Zoom scale limits
  const minScale = 0.1;
  const maxScale = 3;
  const [scale, setScale] = useState(minScale); // Start at minimum zoom level

  // Update container size based on parent element
  useEffect(() => {
    if (containerRef.current) {
      const { offsetWidth, offsetHeight } = containerRef.current;
      setMapSize({
        width: offsetWidth - 20, // Padding
        height: offsetHeight - 20, // Padding
      });
    }
  }, []);

  // Query for occupancy grid - only once
  const { loading: mapLoading, error: mapError, data: mapData } = useQuery(GET_OCCUPANCY_GRID, {
    fetchPolicy: 'cache-and-network'
  });

  // Calculate distance between two points
  const calculateDistance = (x1, y1, x2, y2) => {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  };
  
  // Query for robot positions with explicit polling
  const { loading: robotsLoading, error: robotsError, data: robotsData } = useQuery(GET_ROBOT_POSITIONS, {
    pollInterval: POLL_INTERVAL,
    fetchPolicy: 'network-only', // This forces it to always go to the network
    notifyOnNetworkStatusChange: true, // This will notify us of poll events
    onCompleted: (data) => {
      if (data && data.robotPositions) {
        console.log('Fetched robot positions:', data.robotPositions);
        setRobots(data.robotPositions);
      }
    },
    onError: (error) => {
      console.error('Error fetching robot positions:', error);
    }
  });

  // Query for robot goals with explicit polling
  const { data: goalsData } = useQuery(GET_ROBOT_GOALS, {
    pollInterval: POLL_INTERVAL,
    fetchPolicy: 'network-only',
    notifyOnNetworkStatusChange: true, // This will notify us of poll events
    onCompleted: (data) => {
      console.log('Fetched robot goals:', data);
      if (data && data.robotGoals) {
        // Update goal markers based on server data
        const newGoalMarkers = {};
        data.robotGoals.forEach(goal => {
          newGoalMarkers[goal.id] = {
            x: (occGridWidth - goal.x_goal/occGridResolution) * gridCellSize, // Convert grid coordinates to pixels
            y: goal.y_goal * gridCellSize / occGridResolution, // Convert grid coordinates to pixels
            color: getRobotColor(goal.id)
          };
        });
        setGoalMarkers(newGoalMarkers);
      }
    }
  });
  
  // Query for robot paths with explicit polling
  const { data: pathsData } = useQuery(GET_ROBOT_PATHS, {
    pollInterval: POLL_INTERVAL,
    fetchPolicy: 'network-only',
    notifyOnNetworkStatusChange: true,
    onCompleted: (data) => {
      console.log('Fetched robot paths:', data);
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

  const { data: objectsData } = useQuery(GET_OBJECT_POSITIONS, {
    pollInterval: POLL_INTERVAL,
    fetchPolicy: 'network-only',
    notifyOnNetworkStatusChange: true,
    onCompleted: (data) => {
      console.log('Fetched object positions:', data);
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
      console.log('All objects cleared successfully');
      // Optionally clear the local state immediately for faster UI response
      setDetectedObjects([]);
    },
    onError: (error) => {
      console.error('Error clearing objects:', error);
    }
  });
  
  // Create grid cells based on occupancy grid data - only render when map data changes
  const [gridCells, setGridCells] = useState([]);

  useEffect(() => {
    if (!mapData || !mapData.map) return;
    
    const { width, height, resolution, occupancy } = mapData.map;
    const cellSize = 5; // Size of each grid cell in pixels
  
    setOccGridWidth(width);
    setOccGridHeight(height);
    setOccGridResolution(resolution);
  
    console.log('Pre-rendering map image:', width, 'x', height);
    
    // Create an offscreen canvas
    const canvas = document.createElement('canvas');
    canvas.width = width * cellSize;
    canvas.height = height * cellSize;
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
        
        const xPos = (width - x - 1) * cellSize; // Invert x for correct orientation
        const yPos = y * cellSize;
        
        ctx.fillStyle = color;
        ctx.fillRect(xPos, yPos, cellSize, cellSize);
      }
    }
    
    // Add grid lines if needed (optional)
    if (cellSize > 2) { // Only draw grid lines if cells are big enough
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 0.5;
      
      for (let x = 0; x <= width; x++) {
        ctx.beginPath();
        ctx.moveTo(x * cellSize, 0);
        ctx.lineTo(x * cellSize, height * cellSize);
        ctx.stroke();
      }
      
      for (let y = 0; y <= height; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * cellSize);
        ctx.lineTo(width * cellSize, y * cellSize);
        ctx.stroke();
      }
    }
    
    // Convert canvas to image
    const img = new Image();
    img.onload = () => {
      setMapImage(img);
      console.log('Map image created successfully');
    };
    img.src = canvas.toDataURL();
    
  }, [mapData]);

  // Update robots layer when robot positions change
  useEffect(() => {
    if (robotsLayerRef.current && robots.length > 0) {
      console.log('Redrawing robots layer with', robots.length, 'robots');
      robotsLayerRef.current.batchDraw();
    }
    
    // If we have goal markers, redraw the goal layer too
    // since it depends on robot positions for the dotted lines
    if (goalLayerRef.current && Object.keys(goalMarkers).length > 0) {
      console.log('Redrawing goal layer due to robot position update');
      goalLayerRef.current.batchDraw();
    }
  }, [robots, goalMarkers]);

  // Update path layer when robot paths change
  useEffect(() => {
    if (pathLayerRef.current && Object.keys(robotPaths).length > 0) {
      console.log('Redrawing path layer with', Object.keys(robotPaths).length, 'paths');
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
      
      if (positionMode === 'goal') {
        console.log(`Setting new goal marker for robot ${selectedRobotId} at`, worldPos.x, worldPos.y);
        
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
        console.log(`Setting initial position for robot ${selectedRobotId} at`, worldPos.x, worldPos.y);
        
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

  // Helper function to get unique color for each robot
  const getRobotColor = (robotId) => {
    // Generate a color based on the robot ID
    // This is a simple hash function to generate a color
    const hash = Number(robotId) * 137 % 360;
    return `hsl(${hash}, 70%, 50%)`; // Use HSL for more distinct colors
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
  
  const togglePaths = () => {
    setShowPaths(!showPaths);
  };

  // Display loading or error states
  if (mapLoading && !mapData) return <div>Loading map...</div>;
  if (mapError) return <div>Error loading map: {mapError.message}</div>;
  if (robotsLoading && !robots.length && !mapData) return <div>Loading robot positions...</div>;
  if (robotsError) return <div>Error loading robot positions: {robotsError.message}</div>;

  return (
    <div 
      ref={containerRef} 
      style={{ width: '100%', height: '100%', border: '1px solid #ccc', overflow: 'hidden' }}
    >
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
        <Layer ref={gridLayerRef}>
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
                fill={robot.id === selectedRobotId ? '#ff4444' : '#4444ff'}
                stroke="#000"
                strokeWidth={2}
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
            const robot = robots.find(r => r.id === Number(robotId));
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
      
      {/* Controls for zoom and goal management */}
      <div style={{ position: 'absolute', bottom: '20px', right: '20px', background: 'white', padding: '5px', borderRadius: '5px', boxShadow: '0 0 5px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', marginBottom: '10px' }}>
          <button 
            onClick={clearGoal}
            disabled={!selectedRobotId}
            style={{ margin: '2px', padding: '5px 10px' }}
          >
            Clear Selected Goal
          </button>
          <button 
            onClick={clearAllGoals}
            style={{ margin: '2px', padding: '5px 10px' }}
          >
            Clear All Goals
          </button>
          <button 
            onClick={handleClearAllObjects}
            style={{ margin: '2px', padding: '5px 10px' }}
          >
            Clear All Objects
          </button>
          <button 
            onClick={togglePaths}
            style={{ margin: '2px', padding: '5px 10px' }}
          >
            {showPaths ? 'Hide Paths' : 'Show Paths'}
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button 
            onClick={() => {
              if (stageRef.current) {
                const stage = stageRef.current;
                const oldScale = stage.scaleX();
                const newScale = Math.min(maxScale, oldScale * 1.2);
                stage.scale({ x: newScale, y: newScale });
                stage.batchDraw();
              }
            }}
            style={{ margin: '2px', padding: '5px 10px' }}
          >
            +
          </button>
          <button 
            onClick={() => {
              if (stageRef.current) {
                const stage = stageRef.current;
                const oldScale = stage.scaleX();
                const newScale = Math.max(minScale, oldScale / 1.2);
                stage.scale({ x: newScale, y: newScale });
                stage.batchDraw();
              }
            }}
            style={{ margin: '2px', padding: '5px 10px' }}
          >
            -
          </button>
          <button 
            onClick={() => {
              if (stageRef.current) {
                const stage = stageRef.current;
                stage.scale({ x: 1, y: 1 });
                stage.position({ x: 0, y: 0 });
                stage.batchDraw();
              }
            }}
            style={{ margin: '2px', padding: '5px 10px' }}
          >
            Reset
          </button>
        </div>
      </div>
      
    </div>
  );
}
export default RobotMap;