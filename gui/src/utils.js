// Utility function to get the color of a robot based on its ID
export const getRobotColor = (robotId) => {
  // Generate a color based on the robot ID
  // This is a simple hash function to generate a color
  // Special case for robot ID 1
  if (Number(robotId) === 1) {
    return '#00ec15'; // Green for robot ID 1
  } else if (Number(robotId) === 2) {
    return '#e700cf'; // Pink for robot ID 2
  } else if (Number(robotId) === 3) {
    return '#007bff'; // Blue for robot ID 3
  } else if (Number(robotId) === 4) {
    return '#FF7F50'; // Coral for robot ID 4
  } else if (Number(robotId) === 5) {
    return '#00ec15'; // Green for robot ID 5
  } else if (Number(robotId) === 6) {
    return '#FF13F0'; // Pink for robot ID 6
  } else {
    // For other robot IDs, generate a color based on the ID
    const hash = Number(robotId) * 137 % 360;
    return `hsl(${hash}, 70%, 50%)`; // Use HSL for more distinct colors
  }
};
