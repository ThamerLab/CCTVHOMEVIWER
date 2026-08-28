#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/cctv-home-viewer"
DATA_DIR="/var/lib/cctv-home-viewer"
GO2RTC_CONFIG_DIR="/var/lib/go2rtc-cctv"
GO2RTC_CONFIG_FILE="${GO2RTC_CONFIG_DIR}/go2rtc.yaml"
ENV_FILE="/etc/cctv-home-viewer.env"

trap 'echo "[ERROR] HomeKit enable failed on line $LINENO."' ERR

[[ $EUID -eq 0 ]] || { echo "Run as root inside the LXC."; exit 1; }
[[ -d "$APP_DIR/.git" ]] || { echo "Missing app checkout at $APP_DIR."; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE."; exit 1; }

cd "$APP_DIR"
git fetch --depth 1 origin main
git reset --hard origin/main
cd app
npm ci --omit=dev
cd ..
rm -rf app/data
ln -s "$DATA_DIR" app/data

if ! id cctv >/dev/null 2>&1; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin cctv
fi
if ! id go2rtc >/dev/null 2>&1; then
  useradd --system --home /var/lib/go2rtc --shell /usr/sbin/nologin go2rtc
fi

install -d -o cctv -g cctv -m 700 "$DATA_DIR"
install -d -o cctv -g go2rtc -m 2750 "$GO2RTC_CONFIG_DIR"
if [[ ! -f "$GO2RTC_CONFIG_FILE" ]]; then
  install -o cctv -g go2rtc -m 0640 go2rtc.yaml "$GO2RTC_CONFIG_FILE"
else
  chown cctv:go2rtc "$GO2RTC_CONFIG_FILE"
  chmod 0640 "$GO2RTC_CONFIG_FILE"
fi

if grep -q '^GO2RTC_CONFIG_PATH=' "$ENV_FILE"; then
  sed -i "s|^GO2RTC_CONFIG_PATH=.*|GO2RTC_CONFIG_PATH=${GO2RTC_CONFIG_FILE}|" "$ENV_FILE"
else
  printf '\nGO2RTC_CONFIG_PATH=%s\n' "$GO2RTC_CONFIG_FILE" >>"$ENV_FILE"
fi
if grep -q '^GO2RTC_URL=' "$ENV_FILE"; then
  sed -i 's|^GO2RTC_URL=.*|GO2RTC_URL=http://127.0.0.1:1984|' "$ENV_FILE"
else
  printf 'GO2RTC_URL=http://127.0.0.1:1984\n' >>"$ENV_FILE"
fi

cat >/etc/systemd/system/go2rtc.service <<EOF
[Unit]
Description=go2rtc WebRTC camera gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=go2rtc
Group=go2rtc
ExecStart=/usr/local/bin/go2rtc -config ${GO2RTC_CONFIG_FILE}
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictNamespaces=true
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/go2rtc-config.path <<EOF
[Unit]
Description=Watch CCTV HomeKit go2rtc configuration

[Path]
PathChanged=${GO2RTC_CONFIG_FILE}
Unit=go2rtc-config-reload.service

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/go2rtc-config-reload.service <<'EOF'
[Unit]
Description=Reload go2rtc after CCTV HomeKit configuration changes

[Service]
Type=oneshot
ExecStart=/bin/systemctl restart go2rtc.service
EOF

cat >/etc/systemd/system/cctv-home-viewer.service <<EOF
[Unit]
Description=CCTV Home Viewer
After=network-online.target go2rtc.service
Wants=network-online.target
Requires=go2rtc.service

[Service]
Type=simple
User=cctv
Group=cctv
WorkingDirectory=${APP_DIR}/app
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictNamespaces=true
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=
ReadWritePaths=${DATA_DIR} ${GO2RTC_CONFIG_DIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable go2rtc cctv-home-viewer nginx go2rtc-config.path
systemctl restart go2rtc cctv-home-viewer nginx go2rtc-config.path
sleep 2
curl -fsS http://127.0.0.1:3000/health >/dev/null
curl -fsS http://127.0.0.1/ | grep -Fq "CCTV HOME VIEWER"

cat <<EOF
HomeKit support is enabled.
Open http://$(hostname -I | awk '{print $1}')/admin and enable HomeKit per camera.
EOF
