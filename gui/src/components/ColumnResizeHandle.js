import React, { useState } from 'react';

const ColumnResizeHandle = ({ onMouseDown, label }) => {
  const [dragging, setDragging] = useState(false);

  const handleMouseDown = (e) => {
    setDragging(true);
    const onUp = () => {
      setDragging(false);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mouseup', onUp);
    onMouseDown(e);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      className={`column-resize-handle${dragging ? ' column-resize-handle--active' : ''}`}
      onMouseDown={handleMouseDown}
    />
  );
};

export default ColumnResizeHandle;
