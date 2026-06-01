#!/bin/bash
# PID 1 for the compose `dds` service. Keeps the container alive and owns stdout/stderr
# so Docker Desktop / `docker logs dds` show script output (via /proc/1/fd/1 from start_scripts.sh).

set -euo pipefail
cd /dds

echo "DDS container ready (image: ${MATT_PYTHON_IMAGE:-matt_python})."
echo "  Start scripts: docker exec -d dds ./start_scripts.sh   (or GUI Local Stack → DDS → Start)"
echo "  Stop scripts:  docker exec dds ./stop_scripts.sh"
echo "  View logs:     docker logs -f dds"
echo "  Scripts idle until started."

exec tail -f /dev/null
