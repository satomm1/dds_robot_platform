import { act, render, screen } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing';
import RobotMap from './RobotMap';
import RobotSelector from './RobotSelector';
import RobotControls from './RobotControls';
import { RobotColorProvider } from '../hooks/useRobotColors';
import { GET_OCCUPANCY_GRID } from '../queries';

// jsdom canvases have no 2D context; the map image itself is covered by occupancyImage.test.js.
jest.mock('./robotMap/occupancyImage', () => ({ createOccupancyCanvas: () => ({}) }));

const pollError = new Error('Failed to fetch');
const robots = [{ id: 1, x: 1, y: 2, theta: 0, position_timestamp: 1 }];
const mapMock = {
  request: { query: GET_OCCUPANCY_GRID },
  result: {
    data: {
      map: { __typename: 'Map', width: 2, height: 2, resolution: 0.05, occupancy: [0, 100, 0, -1] },
    },
  },
};

function renderWithProviders(ui) {
  return render(
    <MockedProvider mocks={[mapMock]}>
      <RobotColorProvider>{ui}</RobotColorProvider>
    </MockedProvider>,
  );
}

// The map's goal/path/object polls have no mocks here; Apollo warns about them on purpose.
let errorSpy;
let warnSpy;
beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

test('map stays mounted with a banner when a position poll fails', async () => {
  renderWithProviders(
    <RobotMap robotPositions={robots} positionsError={pollError} positionMode="goal" selectedRobotId={1} />,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(screen.queryByText(/Error loading robot positions/)).toBeNull();
  expect(screen.getByText(/Lost connection to robot positions: Failed to fetch/)).toBeInTheDocument();
});

test('robot list keeps last data with a note; full error only without data', () => {
  const { unmount } = renderWithProviders(
    <RobotSelector robotPositions={robots} positionsError={pollError} selectedRobotId={1} onSelectRobot={() => {}} />,
  );
  expect(screen.getByText('Robot 1')).toBeInTheDocument();
  expect(screen.getByText(/Connection lost/)).toBeInTheDocument();
  unmount();

  renderWithProviders(
    <RobotSelector robotPositions={[]} positionsError={pollError} selectedRobotId={null} onSelectRobot={() => {}} />,
  );
  expect(screen.getByText(/Error loading robots: Failed to fetch/)).toBeInTheDocument();
});

test('robot controls keep last data with a note; full error only without data', () => {
  const { unmount } = renderWithProviders(
    <RobotControls
      robotPositions={robots}
      positionsError={pollError}
      selectedRobotId={1}
      dismissPathForRobot={() => {}}
      onCenterOnRobot={() => {}}
    />,
  );
  expect(screen.getByText(/Position:/)).toBeInTheDocument();
  expect(screen.getByText(/position may be out of date/)).toBeInTheDocument();
  unmount();

  renderWithProviders(
    <RobotControls robotPositions={[]} positionsError={pollError} selectedRobotId={null} dismissPathForRobot={() => {}} />,
  );
  expect(screen.getByText(/Error: Failed to fetch/)).toBeInTheDocument();
});
