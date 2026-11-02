import { act, fireEvent, render, screen } from '@testing-library/react';
import LocalStackLaunchCard from './LocalStackLaunchCard';
import { LocalStackProvider } from '../hooks/useLocalStack';
import {
  dockerComposeUp,
  fetchCaptureDockerComposeStatus,
  fetchDockerComposeStatus,
} from '../utils/dockerComposeApi';
import { fetchDdsLocalDefaults, validateDdsLocalSettings } from '../utils/ddsLocalApi';

jest.mock('../utils/dockerComposeApi', () => ({
  hasDockerBridge: () => true,
  fetchDockerComposeStatus: jest.fn(),
  fetchCaptureDockerComposeStatus: jest.fn(),
  dockerComposeUp: jest.fn(),
  dockerComposeDown: jest.fn(),
  captureDockerComposeUp: jest.fn(),
  captureDockerComposeDown: jest.fn(),
}));
jest.mock('../utils/ddsLocalApi', () => ({
  hasDdsBridge: () => true,
  fetchDdsLocalDefaults: jest.fn(),
  validateDdsLocalSettings: jest.fn(),
}));

const stopped = { running: false, configured: true };
const running = { running: true, configured: true };

async function renderCard(backendDown) {
  const utils = render(
    <LocalStackProvider>
      <LocalStackLaunchCard backendDown={backendDown} />
    </LocalStackProvider>,
  );
  // Let the startup path check and first status poll settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return utils;
}

// CRA's Jest config resets mocks before each test, so implementations are set here.
beforeEach(() => {
  localStorage.clear();
  fetchDdsLocalDefaults.mockResolvedValue({ platformDir: '/repo', wslDistro: '', platform: 'linux' });
  validateDdsLocalSettings.mockResolvedValue({ valid: true });
  fetchDockerComposeStatus.mockResolvedValue(stopped);
  fetchCaptureDockerComposeStatus.mockResolvedValue(stopped);
});

test('prominent Start appears when Docker is off and GraphQL is unreachable', async () => {
  await renderCard(true);
  expect(await screen.findByText('The local stack is not running')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start Local Stack' })).toBeEnabled();
});

test('hidden when GraphQL is reachable, even with local Docker off', async () => {
  await renderCard(false);
  expect(screen.queryByRole('region', { name: 'Start local stack' })).toBeNull();
});

test('Start runs compose up, then waits for GraphQL while Docker is running', async () => {
  let finishUp;
  dockerComposeUp.mockImplementation(() => new Promise((resolve) => { finishUp = resolve; }));
  const { rerender } = await renderCard(true);

  fireEvent.click(await screen.findByRole('button', { name: 'Start Local Stack' }));
  expect(dockerComposeUp).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Starting the local stack…')).toBeInTheDocument();

  fetchDockerComposeStatus.mockResolvedValue(running);
  await act(async () => {
    finishUp({ ok: true });
  });
  expect(await screen.findByText('Waiting for GraphQL…')).toBeInTheDocument();

  // GraphQL answers: the card goes away and the normal layout is back.
  rerender(
    <LocalStackProvider>
      <LocalStackLaunchCard backendDown={false} />
    </LocalStackProvider>,
  );
  expect(screen.queryByRole('region', { name: 'Start local stack' })).toBeNull();
});

test('"Continue without starting" dismisses the card', async () => {
  await renderCard(true);
  fireEvent.click(screen.getByRole('button', { name: 'Continue without starting' }));
  expect(screen.queryByRole('region', { name: 'Start local stack' })).toBeNull();
});
