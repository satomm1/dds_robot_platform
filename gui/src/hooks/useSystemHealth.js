import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@apollo/client';
import { GET_ROBOT_POSITIONS, GET_SUBSCRIBED_AGENTS } from '../queries';
import { getGraphqlBaseUrl } from '../utils/graphqlBaseUrl';

export const HEALTH_STATE = {
  CHECKING: 'checking',
  OK: 'ok',
  WARN: 'warn',
  ERROR: 'error',
};

const HEALTH_POLL_MS = 8000;
const HEALTH_FETCH_TIMEOUT_MS = 5000;

async function fetchHealthEndpoint(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${getGraphqlBaseUrl()}${path}`, {
      method: 'GET',
      signal: controller.signal,
    });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

function formatAgeMs(ms) {
  if (ms < 2000) return 'just now';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  return `${min}m ago`;
}

export function useSystemHealth() {
  const [graphqlHealth, setGraphqlHealth] = useState({
    state: HEALTH_STATE.CHECKING,
    label: 'GraphQL',
    detail: 'Checking…',
  });

  const {
    data: positionsData,
    error: positionsError,
    loading: positionsLoading,
    dataUpdatedAt: positionsUpdatedAt,
  } = useQuery(GET_ROBOT_POSITIONS, {
    pollInterval: HEALTH_POLL_MS,
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
  });

  const {
    data: agentsData,
    error: agentsError,
    loading: agentsLoading,
    dataUpdatedAt: agentsUpdatedAt,
  } = useQuery(GET_SUBSCRIBED_AGENTS, {
    pollInterval: HEALTH_POLL_MS,
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
  });

  const pollRestHealth = useCallback(async () => {
    const [live, ready] = await Promise.all([
      fetchHealthEndpoint('/health'),
      fetchHealthEndpoint('/ready'),
    ]);

    if (!live.ok) {
      setGraphqlHealth({
        state: HEALTH_STATE.ERROR,
        label: 'GraphQL',
        detail: 'API unreachable (is the backend running on port 8000?)',
      });
      return;
    }

    if (!ready.ok) {
      setGraphqlHealth({
        state: HEALTH_STATE.WARN,
        label: 'GraphQL',
        detail: 'API up; database not ready (Ignite)',
      });
      return;
    }

    setGraphqlHealth({
      state: HEALTH_STATE.OK,
      label: 'GraphQL',
      detail: 'API and database ready',
    });
  }, []);

  useEffect(() => {
    pollRestHealth();
    const interval = setInterval(pollRestHealth, HEALTH_POLL_MS);
    return () => clearInterval(interval);
  }, [pollRestHealth]);

  const ddsHealth = useMemo(() => {
    if (agentsLoading && !agentsData && positionsLoading && !positionsData) {
      return {
        state: HEALTH_STATE.CHECKING,
        label: 'DDS',
        detail: 'Checking…',
      };
    }
    if (agentsError && positionsError) {
      return {
        state: HEALTH_STATE.ERROR,
        label: 'DDS',
        detail: 'Cannot query agent data',
      };
    }

    const robotCount = positionsData?.robotPositions?.length ?? 0;

    if (robotCount === 0) {
      return {
        state: HEALTH_STATE.WARN,
        label: 'DDS',
        detail: 'No robots online yet',
      };
    }

    const updatedAt = Math.max(positionsUpdatedAt || 0, agentsUpdatedAt || 0);
    const age = updatedAt ? formatAgeMs(Date.now() - updatedAt) : '';
    const robotLabel =
      robotCount === 1 ? '1 robot active' : `${robotCount} robots active`;
    return {
      state: HEALTH_STATE.OK,
      label: 'DDS',
      detail: `${robotLabel}${age ? ` · updated ${age}` : ''}`,
    };
  }, [
    agentsData,
    agentsError,
    agentsLoading,
    agentsUpdatedAt,
    positionsData,
    positionsError,
    positionsLoading,
    positionsUpdatedAt,
  ]);

  const items = useMemo(() => {
    let graphql = graphqlHealth;
    if (positionsError && graphql.state === HEALTH_STATE.OK) {
      graphql = {
        ...graphql,
        state: HEALTH_STATE.WARN,
        detail: 'Health OK but GraphQL queries failing',
      };
    }
    return [graphql, ddsHealth];
  }, [graphqlHealth, ddsHealth, positionsError]);

  return { items };
}
