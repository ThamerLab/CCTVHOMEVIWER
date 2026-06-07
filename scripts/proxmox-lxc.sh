#!/usr/bin/env bash
set -Eeuo pipefail

APP="CCTV Home Viewer"
REPO="ThamerLab/CCTVHOMEVIWER"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/main"

if [[ $EUID -ne 0 ]] || ! command -v pveversion >/dev/null 2>&1; then
  echo "[ERROR] Run this script as root from the Proxmox VE host shell."
  exit 1
fi

trap 'echo "[ERROR] Installation failed on line $LINENO."' ERR

for command_name in pvesh pct pveam pvesm curl openssl base64; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "[ERROR] Required command is missing: $command_name"
    exit 1
  }
done

green="\033[1;32m"
yellow="\033[1;33m"
red="\033[1;31m"
clear="\033[0m"

msg() { echo -e "${green}[INFO]${clear} $*"; }
warn() { echo -e "${yellow}[WARN]${clear} $*"; }
die() { echo -e "${red}[ERROR]${clear} $*" >&2; exit 1; }

next_id() {
  pvesh get /cluster/nextid 2>/dev/null
}

first_storage_with_content() {
  local content="$1"
  pvesm status -content "$content" 2>/dev/null | awk 'NR>1 && $3=="active" {print $1; exit}'
}

random_secret() {
  openssl rand -base64 48 | tr -d '\n'
}

CTID="${CTID:-$(next_id)}"
HOSTNAME="${HOSTNAME:-cctv-home-viewer}"
CORES="${CORES:-2}"
RAM="${RAM:-1024}"
SWAP="${SWAP:-512}"
DISK="${DISK:-8}"
BRIDGE="${BRIDGE:-vmbr0}"
IP_CONFIG="${IP_CONFIG:-dhcp}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-$(first_storage_with_content vztmpl)}"
ROOTFS_STORAGE="${ROOTFS_STORAGE:-$(first_storage_with_content rootdir)}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
DATA_ENCRYPTION_KEY="${DATA_ENCRYPTION_KEY:-}"

[[ "$CTID" =~ ^[0-9]+$ ]] || die "CTID must be numeric."
[[ "$CORES" =~ ^[1-9][0-9]*$ ]] || die "CORES must be a positive number."
[[ "$RAM" =~ ^[0-9]+$ ]] || die "RAM must be numeric."
[[ "$SWAP" =~ ^[0-9]+$ ]] || die "SWAP must be numeric."
[[ "$DISK" =~ ^[0-9]+$ ]] || die "DISK must be numeric."
[[ "$HOSTNAME" =~ ^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$ ]] || die "HOSTNAME is invalid."
[[ "$ADMIN_USERNAME" =~ ^[A-Za-z0-9_.-]{1,64}$ ]] || die "ADMIN_USERNAME contains unsupported characters."
[[ -n "$TEMPLATE_STORAGE" ]] || die "No storage with vztmpl content was found."
[[ -n "$ROOTFS_STORAGE" ]] || die "No storage with rootdir content was found."
if pct status "$CTID" >/dev/null 2>&1; then
  die "Container ID $CTID already exists."
fi

if [[ -z "$ADMIN_PASSWORD" ]]; then
  read -rsp "Admin password (minimum 14 characters): " ADMIN_PASSWORD
  echo
fi
[[ ${#ADMIN_PASSWORD} -ge 14 ]] || die "Admin password must be at least 14 characters."
[[ "$ADMIN_PASSWORD" != *$'\n'* && "$ADMIN_PASSWORD" != *$'\r'* ]] || die "Admin password cannot contain line breaks."

if [[ -z "$DATA_ENCRYPTION_KEY" ]]; then
  DATA_ENCRYPTION_KEY="$(random_secret)"
fi
[[ ${#DATA_ENCRYPTION_KEY} -ge 32 ]] || die "DATA_ENCRYPTION_KEY must be at least 32 characters."
[[ "$DATA_ENCRYPTION_KEY" != *$'\n'* && "$DATA_ENCRYPTION_KEY" != *$'\r'* ]] || die "DATA_ENCRYPTION_KEY cannot contain line breaks."

echo
echo "Container ID : $CTID"
echo "Hostname     : $HOSTNAME"
echo "Resources    : ${CORES} vCPU, ${RAM}MB RAM, ${DISK}GB disk"
echo "Network      : ${BRIDGE}, ${IP_CONFIG}"
echo "Storage      : template=${TEMPLATE_STORAGE}, rootfs=${ROOTFS_STORAGE}"
echo
read -rp "Create the LXC with these settings? [Y/n]: " confirm
if [[ "${confirm:-Y}" =~ ^[Nn]$ ]]; then
  exit 0
fi

msg "Locating the latest Debian 13 LXC template"
pveam update >/dev/null
template_name="$(pveam available -section system | awk '/debian-13-standard/ {print $2}' | sort -V | tail -n1)"
[[ -n "$template_name" ]] || die "Debian 13 template was not found."
template_path="${TEMPLATE_STORAGE}:vztmpl/${template_name}"
if ! pveam list "$TEMPLATE_STORAGE" | awk '{print $1}' | grep -Fxq "$template_path"; then
  msg "Downloading $template_name"
  pveam download "$TEMPLATE_STORAGE" "$template_name"
fi

msg "Creating unprivileged LXC $CTID"
pct create "$CTID" "$template_path" \
  --hostname "$HOSTNAME" \
  --unprivileged 1 \
  --cores "$CORES" \
  --memory "$RAM" \
  --swap "$SWAP" \
  --rootfs "${ROOTFS_STORAGE}:${DISK}" \
  --net0 "name=eth0,bridge=${BRIDGE},ip=${IP_CONFIG},type=veth" \
  --onboot 1 \
  --start 1 \
  --ostype debian \
  --tags "cctv;webrtc;security"

cleanup() {
  rm -f "$host_env" "$host_installer"
}
host_env="$(mktemp)"
host_installer="$(mktemp)"
trap cleanup EXIT
chmod 600 "$host_env"
admin_password_b64="$(printf '%s' "$ADMIN_PASSWORD" | base64 -w 0)"
encryption_key_b64="$(printf '%s' "$DATA_ENCRYPTION_KEY" | base64 -w 0)"
cat >"$host_env" <<EOF
ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD_B64=${admin_password_b64}
DATA_ENCRYPTION_KEY_B64=${encryption_key_b64}
EOF

msg "Waiting for container networking"
for _ in {1..60}; do
  if pct exec "$CTID" -- bash -c "getent hosts github.com >/dev/null 2>&1"; then
    break
  fi
  sleep 2
done
pct exec "$CTID" -- bash -c "getent hosts github.com >/dev/null" || die "Container has no working network or DNS."

msg "Installing $APP inside the container"
curl -fsSL "${RAW_BASE}/scripts/lxc-install.sh" -o "$host_installer"
pct push "$CTID" "$host_installer" /root/cctv-lxc-install.sh --perms 0700
pct push "$CTID" "$host_env" /root/.cctv-install.env --perms 0600
pct exec "$CTID" -- bash /root/cctv-lxc-install.sh

ip_address="$(pct exec "$CTID" -- hostname -I | awk '{print $1}')"
echo
echo -e "${green}${APP} installation completed.${clear}"
echo "URL: http://${ip_address}/"
echo "Username: ${ADMIN_USERNAME}"
echo
echo "Update command inside LXC:"
echo "  cctv-home-viewer-update"
echo
warn "For access outside your trusted LAN, use HTTPS or a VPN and enable secure cookies."
