import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getDefaultRobotColor } from '../utils';
import {
  loadRobotColorOverrides,
  saveRobotColorOverrides,
} from '../utils/robotColorStorage';

const RobotColorContext = createContext(null);

export function RobotColorProvider({ children }) {
  const [overrides, setOverrides] = useState(() => loadRobotColorOverrides());

  useEffect(() => {
    saveRobotColorOverrides(overrides);
  }, [overrides]);

  const getRobotColor = useCallback(
    (robotId) => {
      const key = String(robotId);
      return overrides[key] || getDefaultRobotColor(robotId);
    },
    [overrides],
  );

  const setRobotColor = useCallback((robotId, color) => {
    const normalized = typeof color === 'string' ? color.toLowerCase() : '';
    if (!/^#[0-9a-f]{6}$/.test(normalized)) return;
    setOverrides((prev) => ({ ...prev, [String(robotId)]: normalized }));
  }, []);

  const value = useMemo(
    () => ({ getRobotColor, setRobotColor }),
    [getRobotColor, setRobotColor],
  );

  return (
    <RobotColorContext.Provider value={value}>{children}</RobotColorContext.Provider>
  );
}

export function useRobotColors() {
  const ctx = useContext(RobotColorContext);
  if (!ctx) {
    throw new Error('useRobotColors must be used within RobotColorProvider');
  }
  return ctx;
}
