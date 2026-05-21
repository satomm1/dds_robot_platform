import React, { useEffect } from 'react';

/** Non-interactive inline replica of a UI control for help text. */
const HelpChip = ({ className = '', children }) => (
  <span className={`help-modal__chip ${className}`.trim()} aria-hidden="true">
    {children}
  </span>
);

const HelpOrientationWheel = () => (
  <span className="help-modal__chip help-modal__orientation-wheel" aria-hidden="true" />
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

        <section className="help-modal__section" aria-labelledby="help-start-stop-heading">
          <h3 id="help-start-stop-heading" className="help-modal__section-title">
            Starting and stopping the robot
          </h3>
          <p className="help-modal__body">
            In the <strong>Robot Startup</strong> panel, enter a{' '}
            <HelpChip className="robot-startup__label">Label</HelpChip> and{' '}
            <HelpChip className="robot-startup__label">Robot IP</HelpChip>, or choose a
            previously saved robot from the{' '}
            <HelpChip className="robot-startup__picker-trigger">
              <span className="robot-startup__picker-label">Lab robot (192.168.1.10)</span>
              <span className="robot-startup__picker-caret">▾</span>
            </HelpChip>{' '}
            menu, then click{' '}
            <HelpChip className="robot-startup__btn robot-startup__btn--start robot-startup__btn--start-ready">
              Start
            </HelpChip>
            . When the robot is reachable, <strong>Start</strong> appears green. To shut down
            the robot, select it in the <strong>Select Robot</strong> list, then click{' '}
            <HelpChip className="control-button shutdown">Shutdown</HelpChip> in the{' '}
            <strong>right sidebar</strong> (the panel that shows the selected robot&apos;s name,
            position, and heading).
          </p>
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
            , then click the desired location on the map. To send a navigation goal, click{' '}
            <HelpChip className="btn-goal-init-active btn-goal-narrow">Set Robot Goal</HelpChip>
            , then click the map. For initial-pose or goal heading, drag the{' '}
            <HelpOrientationWheel /> orientation wheel on the right and click{' '}
            <HelpChip className="btn-set-orientation">Set Orientation</HelpChip> before placing
            the point on the map. To stop robot motion, click{' '}
            <HelpChip className="control-button stop">Stop</HelpChip> in that same right-hand
            panel.
          </p>
        </section>

        <section className="help-modal__section" aria-labelledby="help-multi-plan-heading">
          <h3 id="help-multi-plan-heading" className="help-modal__section-title">
            Setting a multi-robot plan
          </h3>
          <p className="help-modal__body">
            Click{' '}
            <HelpChip className="btn-goal-init-active btn-goal-narrow">Multi-robot plan</HelpChip> in
            the left sidebar. In the planner panel that appears below, check at least two robots
            under <strong>Fleet</strong>, for example{' '}
            <HelpChip className="help-modal__fleet-check">
              <span className="help-modal__checkbox" aria-hidden="true" />
              <span className="multi-robot-planner__dot" style={{ backgroundColor: '#2196F3' }} />
              Robot 1 (staged)
            </HelpChip>
            . For each fleet robot, select it in <strong>Select Robot</strong>, then click the map to
            stage its goal. Optionally set heading with the <HelpOrientationWheel /> orientation
            wheel and <HelpChip className="btn-set-orientation">Set Orientation</HelpChip> before
            each map click. Edit the <HelpChip className="multi-robot-planner__label">Plan ID</HelpChip>{' '}
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
