#!/bin/bash

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

