import React, { useEffect, useState } from 'react';
import { useQuery } from '@apollo/client';
import { GET_ROBOT_POSITIONS, GET_ROBOT_GOALS, GET_ROBOT_PATHS, GET_OBJECT_POSITIONS } from './queries'; // Import the query
import PhaserGame from './PhaserGame';

const RobotLocationUpdater = ({ occupancyGrid, width, height, resolution  }) => {
  const [robotPositions, setRobotPositions] = useState([]);
  const [robotGoals, setRobotGoals] = useState([]);
  const [robotPaths, setRobotPaths] = useState([]);
  const [objectPositions, setObjectPositions] = useState([]);

  const { loading: loadingPositions, error: errorPositions, data: dataPositions, refetch: refetchPositions } = useQuery(GET_ROBOT_POSITIONS);
  const { loading: loadingGoals, error: errorGoals, data: dataGoals, refetch: refetchGoals } = useQuery(GET_ROBOT_GOALS);
  const { loading: loadingPaths, error: errorPaths, data: dataPaths, refetch: refetchPaths} = useQuery(GET_ROBOT_PATHS);
  const { loading: loadingObjects, error: errorObjects, data: dataObjects, refetch: refetchObjects} = useQuery(GET_OBJECT_POSITIONS);

  useEffect(() => {
    const interval = setInterval(() => {
      // Fetch robot positions every 0.2 seconds
      refetchPositions();
      refetchGoals();
      refetchPaths();
      refetchObjects();
    }, 200);

    return () => {
      clearInterval(interval);
    };
  }, [refetchPositions, refetchGoals, refetchPaths, refetchObjects]);

  useEffect(() => {
    if (dataPositions && dataPositions.robotPositions) {
      setRobotPositions(dataPositions.robotPositions);
    }
  }, [dataPositions]);

  useEffect(() => {
    if (dataGoals && dataGoals.robotGoals) {
      setRobotGoals(dataGoals.robotGoals);
    }
  }, [dataGoals]);

  useEffect(() => {
    if (dataPaths && dataPaths.robotPaths) {
      setRobotPaths(dataPaths.robotPaths);
    }
  }, [dataPaths]);

  useEffect(() => {
    if (dataObjects && dataObjects.objectPositions) {
      setObjectPositions(dataObjects.objectPositions);
    }
  }, [dataObjects]);


  if (loadingPositions || loadingGoals || loadingPaths || loadingObjects) return <p>Loading...</p>;
  if (errorPositions) return <p>Error: {errorPositions.message}</p>;
  if (errorGoals) return <p>Error: {errorGoals.message}</p>;
  if (errorPaths) return <p>Error: {errorPaths.message}</p>;
  if (errorObjects) return <p>Error: {errorObjects.message}</p>;

  return (
    <PhaserGame 
      occupancyGrid={occupancyGrid} 
      width={width} 
      height={height} 
      resolution={resolution}
      robotPositions={robotPositions}
      robotGoals={robotGoals} 
      robotPaths={robotPaths}
      objectPositions={objectPositions}
    />
  );
};

export default RobotLocationUpdater;
