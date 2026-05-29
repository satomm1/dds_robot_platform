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
}
trap cleanup SIGTERM SIGINT

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
}
trap cleanup SIGTERM SIGINT

python3 entry_exit.py &
python3 heartbeat_publisher.py &
python3 goal_publisher.py &
python3 location_subscriber.py &
python3 data_subscriber.py &
python3 image_subscriber.py &
wait

