import React from 'react';
import { useSystemHealth } from '../hooks/useSystemHealth';

function HealthPill({ state, label, detail, detailOnHover = false }) {
  return (
    <span
      className={`system-health-bar__pill system-health-bar__pill--${state}${
        detailOnHover ? ' system-health-bar__pill--detail-hover' : ''
      }`}
      tabIndex={detailOnHover ? 0 : undefined}
      aria-label={detailOnHover ? `${label}: ${detail}` : undefined}
      title={detailOnHover ? undefined : detail}
    >
      <span className="system-health-bar__dot" aria-hidden="true" />
      <span className="system-health-bar__label">{label}</span>
      <span className="system-health-bar__detail">{detail}</span>
    </span>
  );
}

const SystemHealthBar = () => {
  const { items } = useSystemHealth();

  return (
    <div className="system-health-bar" role="status" aria-label="System connection health">
      {items.map((item) => (
        <HealthPill
          key={item.label}
          state={item.state}
          label={item.label}
          detail={item.detail}
          detailOnHover={item.label === 'GraphQL'}
        />
      ))}
    </div>
  );
};

export default SystemHealthBar;
