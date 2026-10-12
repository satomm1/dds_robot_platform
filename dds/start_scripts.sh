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

# When started from the GUI, output is appended to dds_scripts.log in this directory.
# In a terminal, output goes to stdout.
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
# Lets cleanup() dump the Python stacks of a script that will not exit (SIGABRT -> traceback in the log).
export PYTHONFAULTHANDLER=1
ulimit -c 0  # no core files from that SIGABRT

SHUTDOWN_TIMEOUT_S=5

activate_dds_python() {
  if python3 -c "import cyclonedds" 2>/dev/null; then
    return 0
  fi

  local conda_base=""
  if conda_base="$(conda info --base 2>/dev/null)" && [[ -n "${conda_base}" ]]; then
    :
  elif [[ -n "${CONDA_BASE:-}" ]]; then
    conda_base="${CONDA_BASE}"
  else
    local candidate
    for candidate in \
      "${HOME}/miniconda3" \
      "${HOME}/anaconda3" \
      "${HOME}/mambaforge" \
      "${HOME}/miniforge3"; do
      if [[ -f "${candidate}/etc/profile.d/conda.sh" ]]; then
        conda_base="${candidate}"
        break
      fi
    done
  fi

  if [[ -z "${conda_base}" || ! -f "${conda_base}/etc/profile.d/conda.sh" ]]; then
    echo "Error: cyclonedds not available and conda not found on PATH." >&2
    echo "Install miniconda in WSL or set CONDA_BASE in dds_env.sh." >&2
    exit 1
  fi

  # shellcheck source=/dev/null
  source "${conda_base}/etc/profile.d/conda.sh"
  conda activate "${DDS_CONDA_ENV:-dds}"
  if ! python3 -c "import cyclonedds" 2>/dev/null; then
    echo "Error: conda env '${DDS_CONDA_ENV:-dds}' is missing cyclonedds." >&2
    exit 1
  fi
}

activate_dds_python

running_pids() {
  local pid
  for pid in "$@"; do
    kill -0 "${pid}" 2>/dev/null && echo "${pid}"
  done
}

cleanup() {
  trap '' SIGTERM SIGINT  # a second Ctrl+C must not re-enter cleanup; stragglers are killed below
  local pids stuck pid deadline
  pids="$(jobs -p)"
  if [[ -n "${pids}" ]]; then
    # shellcheck disable=SC2086
    kill ${pids} 2>/dev/null || true

    deadline=$((SECONDS + SHUTDOWN_TIMEOUT_S))
    while (( SECONDS < deadline )) && [[ -n "$(running_pids ${pids})" ]]; do
      sleep 0.2
    done

    # shellcheck disable=SC2086
    stuck="$(running_pids ${pids})"
    if [[ -n "${stuck}" ]]; then
      for pid in ${stuck}; do
        dds_log "Still running ${SHUTDOWN_TIMEOUT_S}s after SIGTERM: PID ${pid} ($(ps -o args= -p "${pid}")); dumping stacks and killing."
      done
      # shellcheck disable=SC2086
      kill -ABRT ${stuck} 2>/dev/null || true
      sleep 1
      # shellcheck disable=SC2086
      kill -KILL $(running_pids ${stuck}) 2>/dev/null || true
    fi
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
python3 observation_ledger.py >>"${DDS_LOG}" 2>&1 &
python3 image_subscriber.py >>"${DDS_LOG}" 2>&1 &

dds_log "DDS scripts running (PIDs: $(jobs -p | tr '\n' ' '))."
wait
