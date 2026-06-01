#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Operator env (AGENT_ID, INFLUXDB_TOKEN, …) — repo-local only (see dds_env.sh.example).
DDS_ENV_FILE="${SCRIPT_DIR}/dds_env.sh"
if [[ ! -f "${DDS_ENV_FILE}" ]]; then
  echo "Error: missing ${DDS_ENV_FILE} (copy from dds_env.sh.example)." >&2
  exit 1
fi
set -a
# shellcheck source=/dev/null
source "${DDS_ENV_FILE}"
set +a

# In the compose container, send output to PID 1 so `docker logs dds` / Docker Desktop show it.
if [[ -f /.dockerenv ]] && [[ -w /proc/1/fd/1 ]]; then
  DDS_LOG=/proc/1/fd/1
else
  DDS_LOG=/dev/fd/1
fi

dds_log() {
  # shellcheck disable=SC2129
  echo "$@" >>"${DDS_LOG}"
}

export PYTHONUNBUFFERED=1

if ! python3 -c "import cyclonedds" 2>/dev/null; then
  CONDA_BASE="$(conda info --base 2>/dev/null)" || true
  if [[ -z "${CONDA_BASE}" || ! -f "${CONDA_BASE}/etc/profile.d/conda.sh" ]]; then
    echo "Error: cyclonedds not available and conda not found on PATH." >&2
    exit 1
  fi
  # shellcheck source=/dev/null
  source "${CONDA_BASE}/etc/profile.d/conda.sh"
  conda activate dds
  if ! python3 -c "import cyclonedds" 2>/dev/null; then
    echo "Error: conda env 'dds' is missing cyclonedds." >&2
    exit 1
  fi
fi

cleanup() {
  local pids
  pids="$(jobs -p)"
  if [[ -n "${pids}" ]]; then
    # shellcheck disable=SC2086
    kill ${pids} 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  dds_log "DDS scripts stopped."
}
trap cleanup SIGTERM SIGINT

dds_log "Starting DDS scripts (AGENT_ID=${AGENT_ID:-unset})…"

python3 entry_exit.py >>"${DDS_LOG}" 2>&1 &
python3 heartbeat_publisher.py >>"${DDS_LOG}" 2>&1 &
python3 goal_publisher.py >>"${DDS_LOG}" 2>&1 &
python3 location_subscriber.py >>"${DDS_LOG}" 2>&1 &
python3 data_subscriber.py >>"${DDS_LOG}" 2>&1 &
python3 image_subscriber.py >>"${DDS_LOG}" 2>&1 &

dds_log "DDS scripts running (PIDs: $(jobs -p | tr '\n' ' '))."
wait
