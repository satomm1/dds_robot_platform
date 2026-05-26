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

CONDA_BASE="$(conda info --base 2>/dev/null)" || true
if [[ -z "${CONDA_BASE}" || ! -f "${CONDA_BASE}/etc/profile.d/conda.sh" ]]; then
  echo "Error: conda not found on PATH or install is incomplete." >&2
  exit 1
fi
# shellcheck source=/dev/null
source "${CONDA_BASE}/etc/profile.d/conda.sh"
conda activate dds

python3 entry_exit.py &
python3 heartbeat_publisher.py &
python3 goal_publisher.py &
python3 location_subscriber.py &
python3 data_subscriber.py &
python3 image_subscriber.py &
wait

