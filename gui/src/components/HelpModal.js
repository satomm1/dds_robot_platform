import React, { useEffect } from 'react';

/** Non-interactive inline replica of a UI control for help text. */
const HelpChip = ({ className = '', children }) => (
  <span className={`help-modal__chip ${className}`.trim()} aria-hidden="true">
    {children}
  </span>
);

const HelpSection = ({ title, defaultOpen = false, children }) => (
  <details className="help-modal__section" open={defaultOpen || undefined}>
    <summary className="help-modal__section-title">{title}</summary>
    <div className="help-modal__section-content">{children}</div>
  </details>
);

const HelpSubheading = ({ children }) => (
  <h3 className="help-modal__subheading">{children}</h3>
);

const KEYBOARD_SHORTCUTS = [
  { keys: 'G', action: 'Switch to Set Robot Goal mode' },
  { keys: 'I', action: 'Switch to Set Initial Position mode' },
  { keys: 'M', action: 'Switch to Multi-Robot Plan mode' },
  { keys: 'S', action: 'Stop the selected robot' },
  { keys: 'H', action: 'Open or close this Help dialog' },
  {
    keys: 'Esc',
    action:
      'Cancel an in-progress goal or initial-pose drag (before mouse release); close Help or Map Settings when open',
  },
  { keys: 'Space (hold)', action: 'Pan the map (with left-button drag)' },
  { keys: 'Shift (hold)', action: 'Pan the map (with left-button drag)' },
];

const HelpShortcutsTable = () => (
  <table className="help-modal__shortcut-table">
    <thead>
      <tr>
        <th scope="col">Key</th>
        <th scope="col">Action</th>
      </tr>
    </thead>
    <tbody>
      {KEYBOARD_SHORTCUTS.map(({ keys, action }) => (
        <tr key={keys}>
          <th scope="row">
            <kbd>{keys}</kbd>
          </th>
          <td>{action}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const HelpModal = ({ onClose }) => {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="help-overlay" onClick={onClose} role="presentation">
      <div
        className="help-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
      >
        <button
          type="button"
          className="help-modal__close"
          onClick={onClose}
          aria-label="Close help"
        >
          ×
        </button>
        <h2 id="help-modal-title" className="help-modal__title">
          Help
        </h2>

        <HelpSection title="Local Stack (this computer)">
          <p className="help-modal__body">
            The <strong>Local Stack</strong> panel at the <strong>bottom of the right sidebar</strong>{' '}
            controls Docker Compose on your operator PC.
          </p>
          <HelpSubheading>Panel visibility</HelpSubheading>
          <ul className="help-modal__list">
            <li>
              Hide the right column with the <strong>›</strong> button left of the resize grip.
            </li>
            <li>
              Reopen it with the narrow <strong>Startup Panel</strong> tab on the map edge. Panel
              width is remembered; the sidebar opens expanded on each load.
            </li>
          </ul>
          <HelpSubheading>Docker</HelpSubheading>
          <ul className="help-modal__list">
            <li>
              <strong>Start</strong> / <strong>Stop</strong> runs{' '}
              <code>docker compose up -d</code> / <code>docker compose down</code> in the repo root
              (where <code>compose.yaml</code> lives).
            </li>
          </ul>
          <HelpSubheading>DDS scripts</HelpSubheading>
          <ul className="help-modal__list">
            <li>
              Start and stop DDS Python scripts manually from the <code>dds</code> directory:{' '}
              <code>./start_scripts.sh</code> / <code>stop_scripts.sh</code> (WSL on Windows).
            </li>
            <li>
              Configure <code>dds/dds_env.sh</code> (from <code>dds_env.sh.example</code>) for{' '}
              <code>AGENT_ID</code>, <code>INFLUXDB_TOKEN</code>, and compose variables. Create the{' '}
              <code>dds</code> conda env from <code>environment.yml</code> if needed.
            </li>
          </ul>
          <HelpSubheading>Repo path</HelpSubheading>
          <ul className="help-modal__list">
            <li>
              Set the <code>dds_robot_platform</code> repo path in settings (▾). The app uses{' '}
              <code>./dds</code> for DDS.
            </li>
            <li>
              On startup, the app checks for <code>compose.yaml</code> and <code>dds_env.sh</code>.
              Click <strong>Check</strong> after changing the path.
            </li>
          </ul>
          <p className="help-modal__note">
            On Windows, Docker commands run in WSL. DDS Python scripts run on the WSL host
            separately from the GUI. Use the Electron app or <code>npm start</code> (not a static
            browser-only build).
          </p>
        </HelpSection>

        <HelpSection title="Keyboard shortcuts">
          <p className="help-modal__body help-modal__body--tight">
            Shortcuts are ignored while the cursor is in a text field, menu, or other input.{' '}
            <strong>G</strong>, <strong>I</strong>, and <strong>M</strong> do not apply while Help is
            open.
          </p>
          <HelpShortcutsTable />
        </HelpSection>

        <HelpSection title="Starting and stopping the robot">
          <p className="help-modal__body">
            Use the <strong>Robot Startup</strong> panel at the <strong>top of the right sidebar</strong>.
          </p>
          <HelpSubheading>Start a robot</HelpSubheading>
          <ol className="help-modal__steps">
            <li>
              Enter a <HelpChip className="robot-startup__label">Label</HelpChip> and{' '}
              <HelpChip className="robot-startup__label">Robot IP</HelpChip>, or pick a saved robot
              from the{' '}
              <HelpChip className="robot-startup__picker-trigger">
                <span className="robot-startup__picker-label">Lab robot (192.168.1.10)</span>
                <span className="robot-startup__picker-caret">▾</span>
              </HelpChip>{' '}
              menu.
            </li>
            <li>
              Under <strong>Planner Settings (beta)</strong>, optionally check{' '}
              <strong>social</strong> (social planner when on; regular A* when off) and/or{' '}
              <strong>multi</strong> (multi-robot planning at launch).
            </li>
            <li>
              When the host is on but Docker is not running, the main button is{' '}
              <HelpChip className="robot-startup__btn robot-startup__btn--start robot-startup__btn--start-ready">
                Docker Start
              </HelpChip>
              . After the container is up, it becomes{' '}
              <HelpChip className="robot-startup__btn robot-startup__btn--start robot-startup__btn--start-ready">
                Start ROS
              </HelpChip>{' '}
              (green when ROS can be launched).
            </li>
          </ol>
          <HelpSubheading>More actions</HelpSubheading>
          <p className="help-modal__body help-modal__body--tight">
            Open <strong>More</strong> in the Robot Startup panel:
          </p>
          <ul className="help-modal__list">
            <li>
              <strong>Docker Stop</strong> — stops the ROS Docker container (shown in More when the
              container is running).
            </li>
            <li>
              <strong>Power Off</strong> — stops all running Docker containers on the robot, then
              shuts down the Jetson host (confirmation required). Uses the host service on port{' '}
              <code>8081</code>, not <code>startup_script.py</code>.
            </li>
            <li>
              <strong>Software Update</strong> — runs <code>git pull</code> and{' '}
              <code>catkin_make</code> on repos and workspace configured in that robot&apos;s{' '}
              <code>startup_script.py</code> (requires the Docker container and launcher on port{' '}
              <code>8080</code>).
            </li>
          </ul>
          <HelpSubheading>Shut down</HelpSubheading>
          <ul className="help-modal__list">
            <li>
              <HelpChip className="control-button shutdown">Shut Down All</HelpChip> (bottom of the{' '}
              <strong>left sidebar</strong>) — software shut down for every online robot.
            </li>
            <li>
              Select one robot on the left, then{' '}
              <HelpChip className="control-button shutdown">Shut Down</HelpChip> in its details panel
              (DDS).
            </li>
          </ul>
        </HelpSection>

        <HelpSection title="Navigating the map">
          <p className="help-modal__body">
            The center panel shows the occupancy grid, robot positions, goals, and paths. Use the
            draggable map controls overlay (grab its handle to move it) for goal and object actions.
            Open <strong>Map Settings</strong> for robot size, path visibility and width, and cursor
            coordinates.
          </p>
          <ul className="help-modal__list">
            <li>
              <strong>Pan:</strong> Hold <strong>Space</strong> or <strong>Shift</strong> and drag with
              the left mouse button, or <strong>middle-mouse drag</strong>. In goal, initial-pose, or
              multi-robot planning modes, a plain left-click drag places a pose instead of panning.
            </li>
            <li>
              <strong>Zoom:</strong> Scroll the mouse wheel over the map, or use the{' '}
              <strong>+</strong> and <strong>−</strong> buttons on the map controls panel.
            </li>
            <li>
              <strong>Map Settings</strong> (header, next to <strong>Help</strong>): robot marker size,{' '}
              <strong>Show selected robot only</strong>, <strong>Show air quality</strong>,{' '}
              <strong>Show paths</strong>,{' '}
              <strong>Path width</strong>, and <strong>Show cursor coordinates</strong>.
            </li>
          </ul>
        </HelpSection>

        <HelpSection title="Operating the robot">
          <p className="help-modal__body">
            Select a robot in the <strong>Select Robot</strong> list on the left, for example{' '}
            <HelpChip className="help-modal__robot-item help-modal__robot-item--selected">
              Robot 1
              <span
                className="status-indicator help-modal__robot-dot"
                style={{ backgroundColor: '#2196F3' }}
              />
            </HelpChip>
            .
          </p>
          <HelpSubheading>Set initial position</HelpSubheading>
          <ol className="help-modal__steps">
            <li>
              Click{' '}
              <HelpChip className="btn-goal-init-active btn-goal-narrow">
                Set Initial Position
              </HelpChip>
              .
            </li>
            <li>
              On the map, <strong>click and drag</strong> from the pose location to set heading, then
              release.
            </li>
          </ol>
          <HelpSubheading>Set navigation goal</HelpSubheading>
          <ol className="help-modal__steps">
            <li>
              Click{' '}
              <HelpChip className="btn-goal-init-active btn-goal-narrow">Set Robot Goal</HelpChip>.
            </li>
            <li>Use the same click-drag gesture on the map.</li>
          </ol>
          <HelpSubheading>Stop motion</HelpSubheading>
          <ul className="help-modal__list">
            <li>
              Click <HelpChip className="control-button stop">Stop</HelpChip> in the robot details
              panel, or use the shortcuts in <strong>Keyboard shortcuts</strong>.
            </li>
          </ul>
          <p className="help-modal__note">
            <strong>Esc</strong> cancels an in-progress pose drag before mouse release. A short click
            without dragging does nothing.
          </p>
        </HelpSection>

        <HelpSection title="Setting a multi-robot plan">
          <p className="help-modal__body">
            Click{' '}
            <HelpChip className="btn-goal-init-active btn-goal-narrow">Multi-Robot Plan</HelpChip> in
            the left sidebar. Fleet checkboxes appear in the robot list; plan controls stay pinned
            above <strong>Stop All</strong> / <strong>Shut Down All</strong>.
          </p>
          <HelpSubheading>Choose fleet</HelpSubheading>
          <ul className="help-modal__list">
            <li>
              In <strong>Fleet &amp; Select Robot</strong>, check at least two robots, for example{' '}
              <HelpChip className="help-modal__fleet-check">
                <span className="help-modal__checkbox" aria-hidden="true" />
                Robot 1 ✓
              </HelpChip>
              . A checkmark shows when that robot&apos;s goal is staged on the map.
            </li>
          </ul>
          <HelpSubheading>Stage each goal</HelpSubheading>
          <ol className="help-modal__steps">
            <li>Click a fleet robot in the list (checking a box also selects it).</li>
            <li>Click-drag on the map to stage its goal and heading.</li>
            <li>Repeat for every robot in the fleet.</li>
          </ol>
          <HelpSubheading>Plan options</HelpSubheading>
          <ul className="help-modal__list">
            <li>
              Edit <HelpChip className="multi-robot-planner__label">Plan ID</HelpChip> if needed.
            </li>
            <li>
              Enable{' '}
              <HelpChip className="help-modal__coordinated-check">
                <span
                  className="help-modal__checkbox help-modal__checkbox--checked"
                  aria-hidden="true"
                />
                Coordinated (multi-robot timing)
              </HelpChip>{' '}
              when robots should use the multi-agent path planner.
            </li>
            <li>
              <HelpChip className="help-modal__planner-btn">Clear staged goals</HelpChip> resets all
              staged map goals.
            </li>
          </ul>
          <HelpSubheading>Submit</HelpSubheading>
          <p className="help-modal__body">
            When every fleet robot has a staged goal, click{' '}
            <HelpChip className="help-modal__planner-btn help-modal__planner-btn--primary">
              Send multi-robot plan
            </HelpChip>
            .
          </p>
          <p className="help-modal__note">
            <strong>Esc</strong> cancels mid-drag; a short click without dragging does nothing. See{' '}
            <strong>Navigating the map</strong> for pan and zoom.
          </p>
        </HelpSection>
      </div>
    </div>
  );
};

export default HelpModal;
