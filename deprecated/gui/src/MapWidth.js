// src/components/MapWidth.js
import React from 'react';
import { useQuery } from '@apollo/client';
import { GET_MAP_WIDTH } from './queries';

const MapWidth = () => {
  const { loading, error, data } = useQuery(GET_MAP_WIDTH);

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error: {error.message}</p>;

  return (
    <div>
      <h1>Map Width</h1>
      <p>{data.map.width}</p>
      <p>{data.map.height}</p>
    </div>
  );
};

export default MapWidth;
