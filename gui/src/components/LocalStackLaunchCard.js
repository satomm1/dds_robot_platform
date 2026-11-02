import React from 'react';
import { useLocalStack } from '../hooks/useLocalStack';
import { DDS_STATUS } from '../utils/ddsLocalStatus';

/** Which step of getting the local stack up the card is showing. */
function launchPhase({ dockerStarting, startupChecked, dockerReach, pathValidated }) {
  if (dockerStarting) return 'starting';
  if (!startupChecked) return 'checking';
  if (dockerReach === DDS_STATUS.RUNNING) return 'waiting'; // Docker up, GraphQL not answering yet
  if (dockerReach === DDS_STATUS.STOPPED && pathValidated) return 'stopped';
  if (dockerReach === DDS_STATUS.UNCONFIGURED) return 'setup';
  return 'checking';
}

/**
 * Prominent Start shown over the map while the local Docker stack is off and GraphQL is unreachable.
 * Hidden once GraphQL responds (stack running here or elsewhere), when there is no Electron/dev bridge,
 * or after "Continue without starting".
 */
const LocalStackLaunchCard = ({ backendDown }) => {
  const {
    bridgeAvailable,
    platformDir,
    setPlatformDir,
    wslDistro,
    setWslDistro,
    showWslDistro,
    settings,
    pathValidated,
    dockerReach,
    busy,
    status,
    dockerStarting,
    launchDismissed,
    dismissLaunch,
    startupChecked,
    handleValidate,
    handleDockerStart,
  } = useLocalStack();

  if (!bridgeAvailable || !backendDown || launchDismissed) {
    return null;
  }

  const phase = launchPhase({ dockerStarting, startupChecked, dockerReach, pathValidated });

  const title = {
    starting: 'Starting the local stack…',
    waiting: 'Waiting for GraphQL…',
    stopped: 'The local stack is not running',
    setup: 'Set up the local stack',
    checking: 'Checking the local stack…',
  }[phase];

  const detail = {
    starting: 'Docker is starting Ignite, GraphQL and InfluxDB. This can take a minute.',
    waiting:
      'Docker is running. The map and robot controls appear as soon as GraphQL responds. ' +
      'If this takes more than a couple of minutes, check the graphql_endpoint_dds container logs.',
    stopped: 'Start Docker to bring up Ignite, GraphQL and InfluxDB. The map and robot controls need it.',
    setup: 'Enter the path to your dds_robot_platform folder, then check it.',
    checking: 'Looking for the Docker stack on this computer.',
  }[phase];

  const busyPhase = phase === 'starting' || phase === 'waiting' || phase === 'checking';

  return (
    <div className="local-stack-launch" role="region" aria-label="Start local stack">
      <div className="local-stack-launch__card">
        <h2 className="local-stack-launch__title">
          {busyPhase && <span className="local-stack-launch__spinner" aria-hidden="true" />}
          {title}
        </h2>
        <p className="local-stack-launch__detail">{detail}</p>

        {phase === 'setup' && (
          <div className="local-stack-launch__setup">
            <input
              type="text"
              className="local-stack-launch__input"
              placeholder="Path to dds_robot_platform"
              value={platformDir}
              onChange={(e) => setPlatformDir(e.target.value)}
              disabled={busy}
              autoComplete="off"
              aria-label="dds_robot_platform folder path"
            />
            {showWslDistro && (
              <input
                type="text"
                className="local-stack-launch__input local-stack-launch__input--wsl"
                placeholder="WSL distro"
                value={wslDistro}
                onChange={(e) => setWslDistro(e.target.value)}
                disabled={busy}
                autoComplete="off"
                aria-label="WSL distro"
              />
            )}
            <button
              type="button"
              className="local-stack-launch__btn local-stack-launch__btn--secondary"
              onClick={handleValidate}
              disabled={busy || !settings.platformDir}
            >
              {busy ? 'Checking…' : 'Check folder'}
            </button>
          </div>
        )}

        {phase === 'stopped' && (
          <button
            type="button"
            className="local-stack-launch__btn local-stack-launch__btn--start"
            onClick={handleDockerStart}
            disabled={busy}
          >
            Start Local Stack
          </button>
        )}

        {status.message && status.type === 'error' && (
          <p className="local-stack-launch__error" role="alert">
            {status.message}
          </p>
        )}

        <button type="button" className="local-stack-launch__dismiss" onClick={dismissLaunch}>
          Continue without starting
        </button>
      </div>
    </div>
  );
};

export default React.memo(LocalStackLaunchCard);
