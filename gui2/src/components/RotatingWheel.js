// src/components/RotatingWheel.js
import React, { useState, useRef } from 'react';
import { Stage, Layer, Circle, Line, Group, Text, Arc } from 'react-konva';

const RotatingWheel = ({ size = 200, value = 0, onChange }) => {
  const [isDragging, setIsDragging] = useState(false);
  const radius = size / 2;
  const groupRef = useRef(null);
  
  const handleMouseDown = () => {
    setIsDragging(true);
  };
  
  const handleMouseUp = () => {
    setIsDragging(false);
  };
  
  const handleMouseMove = (e) => {
    if (!isDragging || !groupRef.current) return;
    
    const stage = e.target.getStage();
    const pointerPosition = stage.getPointerPosition();
    
    // Calculate angle based on pointer position relative to wheel center
    const x = pointerPosition.x - radius;
    const y = pointerPosition.y - radius;
    
    // Calculate angle in degrees
    let newAngle = Math.atan2(y, x) * (180 / Math.PI);
    
    // Adjust to 0-360 range
    if (newAngle < 0) {
      newAngle += 360;
    }
    
    onChange(Math.round(newAngle));
  };

  return (
    <div className="rotating-wheel">
      <Stage 
        width={size} 
        height={size}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <Layer>
          {/* Background circle */}
          <Circle 
            x={radius} 
            y={radius} 
            radius={radius - 10} 
            stroke="black" 
            strokeWidth={1} 
            fill="#f0f0f0"
          />
          
          {/* Degree markings */}
          {Array.from({ length: 12 }).map((_, i) => {
            const markAngle = i * 30;
            const radian = (markAngle - 90) * (Math.PI / 180);
            const x1 = radius + (radius - 20) * Math.cos(radian);
            const y1 = radius + (radius - 20) * Math.sin(radian);
            const x2 = radius + (radius - 10) * Math.cos(radian);
            const y2 = radius + (radius - 10) * Math.sin(radian);
            
            return (
              <Group key={i}>
                <Line
                  points={[x1, y1, x2, y2]}
                  stroke="black"
                  strokeWidth={2}
                />

              </Group>
            );
          })}
          
          {/* Arc showing the current angle */}
          <Arc
            x={radius}
            y={radius}
            innerRadius={0}
            outerRadius={radius - 40}
            angle={value}
            fill="rgba(0, 100, 255, 0.2)"
            rotation={0}
          />
          
          {/* Rotating hand */}
          <Group
            x={radius}
            y={radius}
            rotation={value}
            ref={groupRef}
            onMouseDown={handleMouseDown}
          >
            <Line 
              points={[0, 0, radius - 15, 0]} 
              stroke="#0066CC" 
              strokeWidth={3} 
            />
            <Circle 
              radius={10} 
              fill="#0066CC" 
              x={radius - 15} 
            />
          </Group>
          
          {/* Center point */}
          <Circle 
            x={radius} 
            y={radius} 
            radius={7} 
            fill="black" 
          />
          
          {/* Display current angle */}
          <Text 
            x={radius}
            y={radius-25}
            text={`${value}°`}
            fontSize={20}
            fill="black"
            align="center"
            verticalAlign="middle"
          />
        </Layer>
      </Stage>
    </div>
  );
};

export default RotatingWheel;