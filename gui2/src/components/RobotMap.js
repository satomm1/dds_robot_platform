// src/components/RobotMap.js
import React, { useRef, useEffect, useState } from 'react';
import { Stage, Layer, Rect, Circle, Line } from 'react-konva';
import { useQuery } from '@apollo/client';
import { GET_OCCUPANCY_GRID } from '../queries';

const RobotMap = ({ robots, selectedRobotId, onSetGoal }) => {
  const [mapSize, setMapSize] = useState({ width: 600, height: 400 });
  const [goalMarker, setGoalMarker] = useState(null);
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  
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

  const { loading, error, data } = useQuery(GET_OCCUPANCY_GRID);

  if (loading) return <p>Loading map...</p>;
  if (error) return <p>Error loading map: {error.message}</p>;

  const createGrid = () => {
    const grid = [];
    const { width, height, resolution, occupancy } = data.map;

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

        grid.push(
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
    return grid;
  };

  const handleMapClick = (e) => {
    if (!stageRef.current) return;
    
    const stage = stageRef.current;
    const pointerPosition = stage.getPointerPosition();
    
    if (pointerPosition) {
      // Get current scale and position of the stage
      const transform = stage.getAbsoluteTransform().copy().invert();
      // Convert screen coordinates to world coordinates
      const worldPos = transform.point(pointerPosition);
      
      setGoalMarker({
        x: worldPos.x,
        y: worldPos.y
      });
      
      // Send goal to backend using world coordinates
      onSetGoal(selectedRobotId, worldPos.x, worldPos.y);
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
        <Layer>
          {/* Occupancy Grid */}
          {createGrid()}
          
          {/* Robot Markers */}
          {robots.map(robot => (
            <Circle
              key={robot.id}
              x={robot.x}
              y={robot.y}
              radius={12}
              fill={robot.id === selectedRobotId ? '#ff4444' : '#4444ff'}
              stroke="#000"
              strokeWidth={2}
            />
          ))}
          
          {/* Goal marker */}
          {goalMarker && selectedRobotId && (
            <>
              <Circle
                x={goalMarker.x}
                y={goalMarker.y}
                radius={8}
                fill="green"
                opacity={0.6}
              />
              <Line
                points={[
                  robots.find(r => r.id === selectedRobotId)?.x || 0,
                  robots.find(r => r.id === selectedRobotId)?.y || 0,
                  goalMarker.x,
                  goalMarker.y
                ]}
                stroke="green"
                strokeWidth={2}
                dash={[5, 5]}
              />
            </>
          )}
        </Layer>
      </Stage>
      
      {/* Controls for zoom */}
      <div style={{ position: 'absolute', bottom: '20px', right: '20px', background: 'white', padding: '5px', borderRadius: '5px', boxShadow: '0 0 5px rgba(0,0,0,0.3)' }}>
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
  );
};

export default RobotMap;