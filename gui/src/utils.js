// Utility function to get the color of a robot based on its ID
  export const getRobotColor = (robotId) => {
    // Generate a color based on the robot ID
    // This is a simple hash function to generate a color
    // Special case for robot ID 1
    if (Number(robotId) === 1) {
      return '#00ec15';
    } else if (Number(robotId) === 2) {
      return '#e700cf'; // Red for robot ID 2
    } else {
      // For other robot IDs, generate a color based on the ID
      const hash = Number(robotId) * 137 % 360;
      return `hsl(${hash}, 70%, 50%)`; // Use HSL for more distinct colors
    }
  };