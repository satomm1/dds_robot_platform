import React from 'react';
import './App.css';
import { ApolloProvider, useQuery } from '@apollo/client';
import client from './apolloClient';
// import PhaserGame from './PhaserGame';
import { GET_OCCUPANCY_GRID } from './queries';
import RobotGoalForm from './RobotGoalForm';
import RobotLocationUpdater from './RobotLocationUpdater';

function App() {
  return (
      <ApolloProvider client={client}>
          <div className="App">
              <header className="App-header">
                  <h1>Robot GUI</h1>
              </header>
              <RobotGoalForm/>
              <OccupancyGridLoader/>   
              {/* <ImageStream /> */}
          </div>
      </ApolloProvider>
  );
}

const OccupancyGridLoader = () => {
  const { loading, error, data } = useQuery(GET_OCCUPANCY_GRID);

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error: {error.message}</p>;

  // return <PhaserGame occupancyGrid={data.map.occupancy} height={data.map.height} width={data.map.width} resolution={data.map.resolution} />;
  return <RobotLocationUpdater occupancyGrid={data.map.occupancy} height={data.map.height} width={data.map.width} resolution={data.map.resolution} />;
};

export default App;
