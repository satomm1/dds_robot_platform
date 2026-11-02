import { act, fireEvent, render } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing';
import RobotStartup from './RobotStartup';
import { fetchRobotLauncherStatus } from '../utils/robotLauncherApi';
import { fetchRobotHostStatus } from '../utils/robotHostApi';

jest.mock('../utils/robotLauncherApi', () => ({
  ...jest.requireActual('../utils/robotLauncherApi'),
  fetchRobotLauncherStatus: jest.fn(),
}));
jest.mock('../utils/robotHostApi', () => ({
  ...jest.requireActual('../utils/robotHostApi'),
  fetchRobotHostStatus: jest.fn(),
}));

const polledHosts = (mockFn) => mockFn.mock.calls.map(([host]) => host);

function renderStartup() {
  const utils = render(
    <MockedProvider mocks={[]}>
      <RobotStartup />
    </MockedProvider>,
  );
  return { ...utils, ipInput: utils.container.querySelector('#robot-startup-host') };
}

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  fetchRobotLauncherStatus.mockReset();
  fetchRobotHostStatus.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

test('typing an IP polls only the finished address, not each partial one', async () => {
  fetchRobotLauncherStatus.mockResolvedValue({ ok: false, status: 0, body: '' });
  fetchRobotHostStatus.mockResolvedValue({ ok: false, status: 0, body: '' });
  const { ipInput } = renderStartup();

  for (const partial of ['1', '19', '192.', '192.168.1', '192.168.1.10']) {
    fireEvent.change(ipInput, { target: { value: partial } });
    act(() => {
      jest.advanceTimersByTime(100); // faster than the 400 ms debounce
    });
  }
  expect(fetchRobotLauncherStatus).not.toHaveBeenCalled();

  await act(async () => {
    jest.advanceTimersByTime(400);
    await Promise.resolve(); // let the mocked responses update state inside act
  });
  expect(polledHosts(fetchRobotLauncherStatus)).toEqual(['192.168.1.10']);
  expect(polledHosts(fetchRobotHostStatus)).toEqual(['192.168.1.10']);
});

test('an unanswered poll is not stacked by the next interval tick', () => {
  // Offline robot: requests never resolve within the 3 s poll interval.
  fetchRobotLauncherStatus.mockImplementation(() => new Promise(() => {}));
  fetchRobotHostStatus.mockImplementation(() => new Promise(() => {}));
  const { ipInput } = renderStartup();

  fireEvent.change(ipInput, { target: { value: '10.0.0.5' } });
  act(() => {
    jest.advanceTimersByTime(400 + 3000 * 3); // debounce, then three poll ticks
  });

  expect(fetchRobotLauncherStatus).toHaveBeenCalledTimes(1);
  expect(fetchRobotHostStatus).toHaveBeenCalledTimes(1);
});
