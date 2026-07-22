#!/bin/bash
# Prompt for central + robot IPs and rewrite cyclonedds.xml <Peers>.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CYCLONEDDS_XML="${SCRIPT_DIR}/cyclonedds.xml"
BACKUP_XML="${SCRIPT_DIR}/cyclonedds.xml.bak"

is_ipv4() {
  local ip="$1"
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  local IFS=.
  # shellcheck disable=SC2086
  set -- $ip
  for octet in "$@"; do
    ((octet >= 0 && octet <= 255)) || return 1
  done
  return 0
}

prompt_central_ip() {
  local ip
  while true; do
    read -r -p "Central machine IP address: " ip
    ip="${ip//[[:space:]]/}"
    if [[ -z "$ip" ]]; then
      echo "Error: central machine IP is required." >&2
      continue
    fi
    if ! is_ipv4 "$ip"; then
      echo "Error: '$ip' is not a valid IPv4 address." >&2
      continue
    fi
    CENTRAL_IP="$ip"
    return 0
  done
}

prompt_robot_ips() {
  ROBOT_IPS=()
  echo "Enter robot IP addresses (one per line). Press Enter on an empty line when done."
  while true; do
    read -r -p "Robot IP: " ip
    ip="${ip//[[:space:]]/}"
    if [[ -z "$ip" ]]; then
      break
    fi
    if ! is_ipv4 "$ip"; then
      echo "Error: '$ip' is not a valid IPv4 address. Try again." >&2
      continue
    fi
    if [[ "$ip" == "$CENTRAL_IP" ]]; then
      echo "Error: '$ip' is already the central machine IP. Try again." >&2
      continue
    fi
    local dup=0
    for existing in "${ROBOT_IPS[@]+"${ROBOT_IPS[@]}"}"; do
      if [[ "$existing" == "$ip" ]]; then
        echo "Error: '$ip' was already entered. Try again." >&2
        dup=1
        break
      fi
    done
    if ((dup)); then
      continue
    fi
    ROBOT_IPS+=("$ip")
  done

  if ((${#ROBOT_IPS[@]} == 0)); then
    echo "Error: at least one robot IP is required." >&2
    exit 1
  fi
}

rewrite_peers() {
  if [[ ! -f "$CYCLONEDDS_XML" ]]; then
    echo "Error: missing ${CYCLONEDDS_XML}" >&2
    exit 1
  fi

  local peers_csv="$CENTRAL_IP"
  local ip
  for ip in "${ROBOT_IPS[@]}"; do
    peers_csv+=",$ip"
  done

  cp "$CYCLONEDDS_XML" "$BACKUP_XML"

  PEERS_CSV="$peers_csv" CYCLONEDDS_XML="$CYCLONEDDS_XML" python3 - <<'PY'
import os
import re
import sys

path = os.environ["CYCLONEDDS_XML"]
peers = [p.strip() for p in os.environ["PEERS_CSV"].split(",") if p.strip()]

with open(path, "r", encoding="utf-8") as f:
    text = f.read()

if "<Peers>" not in text or "</Peers>" not in text:
    print("Error: no <Peers>...</Peers> section found in cyclonedds.xml", file=sys.stderr)
    sys.exit(1)

indent_match = re.search(r"^([ \t]*)<Peers>", text, re.MULTILINE)
peer_indent = (indent_match.group(1) if indent_match else "      ") + "  "
block_indent = indent_match.group(1) if indent_match else "      "

peer_lines = "\n".join(f'{peer_indent}<Peer Address="{ip}"/>' for ip in peers)
new_block = f"{block_indent}<Peers>\n{peer_lines}\n{block_indent}</Peers>"

updated, count = re.subn(
    r"[ \t]*<Peers>.*?</Peers>",
    new_block,
    text,
    count=1,
    flags=re.DOTALL,
)
if count != 1:
    print("Error: failed to replace <Peers> section", file=sys.stderr)
    sys.exit(1)

with open(path, "w", encoding="utf-8", newline="\n") as f:
    f.write(updated)
PY
}

print_summary() {
  echo
  echo "Updated ${CYCLONEDDS_XML}"
  echo "Backup saved to ${BACKUP_XML}"
  echo
  echo "New peer list:"
  echo "  - ${CENTRAL_IP}  (central machine)"
  local ip
  for ip in "${ROBOT_IPS[@]}"; do
    echo "  - ${ip}"
  done
}

print_checklist() {
  echo
  echo "Still do these manually:"
  echo "  1. If DDS scripts are running, restart them so discovery picks up the new peers:"
  echo "       cd ${SCRIPT_DIR} && ./stop_scripts.sh && ./start_scripts.sh"
  echo "  2. Update saved robot addresses in the Robot GUI"
  echo "  3. Update Windows Firewall ROS Rule remote IPs (inbound and outbound)"
  echo "  4. Run the robot-side Wi-Fi IP update script on each Jetson"
}

main() {
  echo "Central machine CycloneDDS Wi-Fi IP update"
  echo "Editing: ${CYCLONEDDS_XML}"
  echo
  prompt_central_ip
  prompt_robot_ips
  rewrite_peers
  print_summary
  print_checklist
}

main "$@"
