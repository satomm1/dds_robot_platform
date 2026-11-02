import { act, render, screen } from '@testing-library/react';
import App from './App';

test('app mounts with the backend unreachable', async () => {
  const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => Promise.reject(new Error('offline')));
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  render(<App />);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  expect(screen.getByText('Robot Controller')).toBeInTheDocument();
  expect(screen.getByText('Set Robot Goal')).toBeInTheDocument();
  expect(screen.getByText('Robot Startup')).toBeInTheDocument();
  // No React warnings (hook order, update loops, ...) while mounting.
  const reactWarnings = errorSpy.mock.calls.filter((call) =>
    /Warning|Maximum update|Rendered (more|fewer)/.test(String(call[0])),
  );
  expect(reactWarnings).toEqual([]);

  errorSpy.mockRestore();
  fetchSpy.mockRestore();
});
