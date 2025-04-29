import React, { useRef, useEffect, useState } from 'react';
import { Stage, Layer, Rect, Circle, Line, Text } from 'react-konva';
import { useQuery } from '@apollo/client';
import { GET_OCCUPANCY_GRID, GET_ROBOT_POSITIONS, GET_ROBOT_GOALS } from '../queries';

const RobotMap = ({ selectedRobotId, onSetGoal }) => {
  const [mapSize, setMapSize] = useState({ width: 1000, height: 550 });
  // Replace single goalMarker with a map of robot IDs to goal markers
  const [goalMarkers, setGoalMarkers] = useState({});
  const [robots, setRobots] = useState([]);
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const gridLayerRef = useRef(null);
  const robotsLayerRef = useRef(null);
  const goalLayerRef = useRef(null);
  
  // Polling interval (in milliseconds)
  const POLL_INTERVAL = 1000; // Fetch every 1 seconds
  
  // Grid properties
  const gridCellSize = 20;
  
  // Map dimensions - can be larger than visible area
  const mapWidth = 2000;
  const mapHeight = 1500;
  
  // Zoom scale limits
  const minScale = 0.5;
  const maxScale = 3;

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
            x: goal.x_goal * gridCellSize, // Convert grid coordinates to pixels
            y: goal.y_goal * gridCellSize,
            color: getRobotColor(goal.id)
          };
        });
        setGoalMarkers(newGoalMarkers);
      }
    }
  });
  
  // Create grid cells based on occupancy grid data - only render when map data changes
  const [gridCells, setGridCells] = useState([]);

  useEffect(() => {
    if (!mapData || !mapData.map) return;
    
    const newGrid = [];
    const { width, height, resolution, occupancy } = mapData.map;
    const cellSize = 5; // Size of each grid cell in pixels
  
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const index = y * width + x; // Calculate index in the occupancy array
        const value = occupancy[index];
        let color;
        if (value === 100) {
          color = 0x000000;
        } else if (value === 0) {
          color = 0xE4F8FF; 
        } else {
          color = 0xA8A8A8;
        }

        const xPos = (width - x - 1) * cellSize; // Invert x for correct orientation
        const yPos = y * cellSize; // Keep y as is for correct orientation

        newGrid.push(
          <Rect
            key={`${xPos}-${yPos}`}
            x={xPos}
            y={yPos}
            width={cellSize}
            height={cellSize}
            fill={`#${color.toString(16).padStart(6, '0')}`}
            stroke="#ddd"
            strokeWidth={1}
          />
        );
      }
    }
    setGridCells(newGrid);
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

  const handleMapClick = (e) => {
    if (!stageRef.current || !selectedRobotId) return;
    
    const stage = stageRef.current;
    const pointerPosition = stage.getPointerPosition();
    
    if (pointerPosition) {
      // Get current scale and position of the stage
      const transform = stage.getAbsoluteTransform().copy().invert();
      // Convert screen coordinates to world coordinates
      const worldPos = transform.point(pointerPosition);
      
      console.log(`Setting new goal marker for robot ${selectedRobotId} at`, worldPos.x, worldPos.y);
      
      // Update goalMarkers with a new entry for this robot
      setGoalMarkers(prevMarkers => ({
        ...prevMarkers,
        [selectedRobotId]: {
          x: worldPos.x,
          y: worldPos.y,
          color: getRobotColor(selectedRobotId) // Function to determine color based on robot ID
        }
      }));
      
      // Send goal to backend using world coordinates
      onSetGoal(selectedRobotId, worldPos.x/gridCellSize , worldPos.y/gridCellSize);
      
      // Only redraw the goal layer
      if (goalLayerRef.current) {
        goalLayerRef.current.batchDraw();
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

  // Display loading or error states
  if (mapLoading && !mapData) return <div>Loading map...</div>;
  if (mapError) return <div>Error loading map: {mapError.message}</div>;
  if (robotsLoading && !robots.length && !mapData) return <div>Loading robot positions...</div>;
  if (robotsError) return <div>Error loading robot positions: {robotsError.message}</div>;

  return (
    <div 
      ref={containerRef} 
      style={{ width: '100%', height: '500px', border: '1px solid #ccc', overflow: 'hidden' }}
    >
      <Stage 
        ref={stageRef}
        width={mapSize.width} 
        height={mapSize.height}
        onClick={handleMapClick}
        onWheel={handleWheel}
        draggable={true}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Separate layer for the grid - doesn't need to update frequently */}
        <Layer ref={gridLayerRef}>
          {gridCells}
        </Layer>
        
        {/* Separate layer for robots - updates with robot positions */}
        <Layer ref={robotsLayerRef}>
          {robots.map(robot => (
            <React.Fragment key={robot.id}>
              <Circle
                x={robot.x * gridCellSize}
                y={robot.y * gridCellSize}
                radius={12}
                fill={robot.id === selectedRobotId ? '#ff4444' : '#4444ff'}
                stroke="#000"
                strokeWidth={2}
              />
              {/* Arrow to indicate direction */}
              <Line
                points={[
                  robot.x * gridCellSize, // Start x
                  robot.y * gridCellSize, // Start y
                  (robot.x + Math.cos(robot.theta))* gridCellSize, // Arrow tip x
                  (robot.y + Math.sin(robot.theta))* gridCellSize  // Arrow tip y
                ]}
                stroke="#000"
                strokeWidth={2}
                pointerLength={5}
                pointerWidth={5}
                tension={0.5}
              />
              <Text
                x={robot.x * gridCellSize-3} // Adjust position to center the text
                y={robot.y * gridCellSize-3} // Adjust position to center the text
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
                    robot.x * gridCellSize,
                    robot.y * gridCellSize,
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
      </Stage>
      
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