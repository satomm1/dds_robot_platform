import React, { useEffect } from 'react';

/** Non-interactive inline replica of a UI control for help text. */
const HelpChip = ({ className = '', children }) => (
  <span className={`help-modal__chip ${className}`.trim()} aria-hidden="true">
    {children}
  </span>
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

        <section className="help-modal__section" aria-labelledby="help-local-dds-heading">
          <h3 id="help-local-dds-heading" className="help-modal__section-title">
            Local Stack (this computer)
          </h3>
          <p className="help-modal__body">
            The <strong>Local Stack</strong> panel at the <strong>bottom of the right sidebar</strong>{' '}
            (with GraphQL / DDS status pills) controls Docker and DDS on your operator PC. Hide the
            whole right column with the <strong>›</strong> button just left of the resize grip; use the narrow{' '}
            <strong>Startup Panel</strong> tab on the map edge to show it again (width and hidden state are
            remembered).{' '}
            <strong>Docker</strong> runs <code>docker compose up -d</code> /{' '}
            <code>docker compose down</code> in the repo root (where <code>compose.yaml</code>{' '}
            lives). <strong>DDS</strong> runs <code>start_scripts.sh</code> /{' '}
            <code>stop_scripts.sh</code> under <code>dds/</code>. Configure{' '}
            <code>dds/dds_env.sh</code> (from <code>dds_env.sh.example</code>) for{' '}
            <code>AGENT_ID</code>, <code>INFLUXDB_TOKEN</code>, and compose variables. Set the{' '}
            <code>dds_robot_platform</code> repo path in settings (▾); the app uses{' '}
            <code>./dds</code> for DDS and checks{' '}
            <code>compose.yaml</code>, and <code>dds_env.sh</code> on startup. Use{' '}
            <strong>Check</strong> after changing the path. On Windows, both run in WSL; conda env{' '}
            <strong>dds</strong> is required for DDS. Use the Electron app or <code>npm start</code>.
          </p>
        </section>

        <section className="help-modal__section" aria-labelledby="help-start-stop-heading">
          <h3 id="help-start-stop-heading" className="help-modal__section-title">
            Starting and stopping the robot
          </h3>
          <p className="help-modal__body">
            In the <strong>Robot Startup</strong> panel at the <strong>top of the right sidebar</strong>, enter a{' '}
            <HelpChip className="robot-startup__label">Label</HelpChip> and{' '}
            <HelpChip className="robot-startup__label">Robot IP</HelpChip>, or choose a
            previously saved robot from the{' '}
            <HelpChip className="robot-startup__picker-trigger">
              <span className="robot-startup__picker-label">Lab robot (192.168.1.10)</span>
              <span className="robot-startup__picker-caret">▾</span>
            </HelpChip>{' '}
            menu, then under <strong>Planner Settings (beta)</strong> optionally check{' '}
            <strong>social</strong> (regular A* when off; social planner when on) and/or{' '}
            <strong>multi</strong> (multi-robot planning at launch), and click{' '}
            <HelpChip className="robot-startup__btn robot-startup__btn--start robot-startup__btn--start-ready">
              Start
            </HelpChip>
            . When the robot is reachable, <strong>Start</strong> appears green.{' '}
            <HelpChip className="robot-startup__btn robot-startup__btn--poweroff">Power Off</HelpChip>{' '}
            (with confirmation) uses the startup IP to halt that PC. At the bottom of the{' '}
            <strong>left sidebar</strong>,{' '}
            <HelpChip className="control-button shutdown">Shut Down All</HelpChip> sends a software
            shut down to every online robot. For one robot over DDS, select it on the left and use{' '}
            <HelpChip className="control-button shutdown">Shut Down</HelpChip> in the robot details
            panel.
          </p>
        </section>

        <section className="help-modal__section" aria-labelledby="help-map-heading">
          <h3 id="help-map-heading" className="help-modal__section-title">
            Navigating the map
          </h3>
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
              <strong>Show selected robot only</strong>, <strong>Show paths</strong>,{' '}
              <strong>Path width</strong>, and <strong>Show cursor coordinates</strong>.
            </li>
          </ul>
        </section>

        <section className="help-modal__section" aria-labelledby="help-operate-heading">
          <h3 id="help-operate-heading" className="help-modal__section-title">
            Operating the robot
          </h3>
          <p className="help-modal__body">
            Select a robot on the left by clicking its name in the{' '}
            <strong>Select Robot</strong> list, for example{' '}
            <HelpChip className="help-modal__robot-item help-modal__robot-item--selected">
              Robot 1
              <span
                className="status-indicator help-modal__robot-dot"
                style={{ backgroundColor: '#2196F3' }}
              />
            </HelpChip>
            . To set the robot&apos;s initial pose, click{' '}
            <HelpChip className="btn-goal-init-active btn-goal-narrow">
              Set Initial Position
            </HelpChip>
            , then on the map <strong>click and drag</strong> from the pose location: drag to set
            heading, then release. A short click without dragging does nothing. To send a navigation
            goal, click{' '}
            <HelpChip className="btn-goal-init-active btn-goal-narrow">Set Robot Goal</HelpChip>
            , then use the same click-drag gesture on the map. To stop robot motion, click{' '}
            <HelpChip className="control-button stop">Stop</HelpChip> in the left sidebar robot
            details panel.
          </p>
        </section>

        <section className="help-modal__section" aria-labelledby="help-multi-plan-heading">
          <h3 id="help-multi-plan-heading" className="help-modal__section-title">
            Setting a multi-robot plan
          </h3>
          <p className="help-modal__body">
            Click{' '}
            <HelpChip className="btn-goal-init-active btn-goal-narrow">Multi-robot plan</HelpChip> in
            the left sidebar. In the planner panel below the robot position / stop / shut down
            section, check at least two robots
            under <strong>Fleet</strong>, for example{' '}
            <HelpChip className="help-modal__fleet-check">
              <span className="help-modal__checkbox" aria-hidden="true" />
              <span className="multi-robot-planner__dot" style={{ backgroundColor: '#2196F3' }} />
              Robot 1 (staged)
            </HelpChip>
            . For each fleet robot, select it in <strong>Select Robot</strong>, then click-drag on
            the map to stage its goal and heading (a short click without dragging does nothing).
            See <strong>Navigating the map</strong> for pan and zoom. Edit the{' '}
            <HelpChip className="multi-robot-planner__label">Plan ID</HelpChip>{' '}
            if needed, and use the{' '}
            <HelpChip className="help-modal__coordinated-check">
              <span className="help-modal__checkbox help-modal__checkbox--checked" aria-hidden="true" />
              Coordinated (multi-robot timing)
            </HelpChip>{' '}
            option when the robots should use the multi-agent path planner. Click{' '}
            <HelpChip className="help-modal__planner-btn">Clear staged goals</HelpChip> to reset
            staged map goals. When every fleet robot has a staged goal, click{' '}
            <HelpChip className="help-modal__planner-btn help-modal__planner-btn--primary">
              Send multi-robot plan
            </HelpChip>
            .
          </p>
        </section>
      </div>
    </div>
  );
};

export default HelpModal;
