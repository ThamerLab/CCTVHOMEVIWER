#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="https://github.com/ThamerLab/CCTVHOMEVIWER.git"
APP_DIR="/opt/cctv-home-viewer"
DATA_DIR="/var/lib/cctv-home-viewer"
GO2RTC_CONFIG_DIR="/var/lib/go2rtc-cctv"
GO2RTC_CONFIG_FILE="${GO2RTC_CONFIG_DIR}/go2rtc.yaml"
ENV_FILE="/etc/cctv-home-viewer.env"
BOOTSTRAP_ENV="/root/.cctv-install.env"
GO2RTC_VERSION="1.9.14"

trap 'echo "[ERROR] LXC installation failed on line $LINENO."' ERR

[[ $EUID -eq 0 ]] || { echo "Run as root."; exit 1; }
[[ -f "$BOOTSTRAP_ENV" ]] || { echo "Bootstrap environment file is missing."; exit 1; }

set -a
# shellcheck disable=SC1090
source "$BOOTSTRAP_ENV"
set +a
rm -f "$BOOTSTRAP_ENV"

ADMIN_PASSWORD="$(printf '%s' "$ADMIN_PASSWORD_B64" | base64 -d)"
DATA_ENCRYPTION_KEY="$(printf '%s' "$DATA_ENCRYPTION_KEY_B64" | base64 -d)"
unset ADMIN_PASSWORD_B64 DATA_ENCRYPTION_KEY_B64

[[ "${ADMIN_USERNAME:-}" =~ ^[A-Za-z0-9_.-]{1,64}$ ]] || { echo "ADMIN_USERNAME is invalid."; exit 1; }
[[ ${#ADMIN_PASSWORD} -ge 14 ]] || { echo "ADMIN_PASSWORD is too short."; exit 1; }
[[ ${#DATA_ENCRYPTION_KEY} -ge 32 ]] || { echo "DATA_ENCRYPTION_KEY is too short."; exit 1; }
[[ "$ADMIN_PASSWORD" != *$'\n'* && "$ADMIN_PASSWORD" != *$'\r'* ]] || { echo "ADMIN_PASSWORD cannot contain line breaks."; exit 1; }
[[ "$DATA_ENCRYPTION_KEY" != *$'\n'* && "$DATA_ENCRYPTION_KEY" != *$'\r'* ]] || { echo "DATA_ENCRYPTION_KEY cannot contain line breaks."; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get full-upgrade -y
apt-get install -y --no-install-recommends ca-certificates curl git nginx ffmpeg openssl xz-utils

curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y --no-install-recommends nodejs

if ! id cctv >/dev/null 2>&1; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin cctv
fi
if ! id go2rtc >/dev/null 2>&1; then
  useradd --system --home /var/lib/go2rtc --shell /usr/sbin/nologin go2rtc
fi

rm -rf "$APP_DIR"
git clone --depth 1 "$REPO_URL" "$APP_DIR"
install -d -o cctv -g cctv -m 700 "$DATA_DIR"
install -d -o cctv -g go2rtc -m 2750 "$GO2RTC_CONFIG_DIR"
rm -rf "$APP_DIR/app/data"
ln -s "$DATA_DIR" "$APP_DIR/app/data"
chown -R root:root "$APP_DIR"
cd "$APP_DIR/app"
npm ci --omit=dev
cd "$APP_DIR"

arch="$(dpkg --print-architecture)"
case "$arch" in
  amd64)
    go2rtc_arch="amd64"
    go2rtc_sha256="32d616af226bd731678ffde328b94cfb94e30339bfefc469cfb76323144615a6"
    ;;
  arm64)
    go2rtc_arch="arm64"
    go2rtc_sha256="359fabade8a7a51e81a55fe6df6b0ef81764a5e1d63179577534eaaa71904b50"
    ;;
  armhf)
    go2rtc_arch="arm"
    go2rtc_sha256="4d7e1639af5a2722a28c7a09dcd95472c8f74cca56d4d1fb91f32bdd15174c"
    ;;
  *) echo "Unsupported architecture: $arch"; exit 1 ;;
esac
curl -fsSL "https://github.com/AlexxIT/go2rtc/releases/download/v${GO2RTC_VERSION}/go2rtc_linux_${go2rtc_arch}" -o /usr/local/bin/go2rtc
echo "${go2rtc_sha256}  /usr/local/bin/go2rtc" | sha256sum -c -
chmod 0755 /usr/local/bin/go2rtc
install -o cctv -g go2rtc -m 0640 "$APP_DIR/go2rtc.yaml" "$GO2RTC_CONFIG_FILE"

install -o root -g cctv -m 0640 /dev/null "$ENV_FILE"
systemd_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}
cat >"$ENV_FILE" <<EOF
ADMIN_USERNAME=$(systemd_quote "$ADMIN_USERNAME")
ADMIN_PASSWORD=$(systemd_quote "$ADMIN_PASSWORD")
DATA_ENCRYPTION_KEY=$(systemd_quote "$DATA_ENCRYPTION_KEY")
SECURE_COOKIES=false
SESSION_IDLE_MINUTES=30
SESSION_ABSOLUTE_HOURS=12
GO2RTC_URL=http://127.0.0.1:1984
GO2RTC_CONFIG_PATH=${GO2RTC_CONFIG_FILE}
ALLOW_PUBLIC_CAMERA_HOSTS=false
EOF

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

cat >/etc/nginx/sites-available/cctv-home-viewer <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ~ ^/go2rtc/(stream\.html|video-stream\.js|video-rtc\.js|api/ws)$ {
        auth_request /_auth;
        rewrite ^/go2rtc/(.*)$ /$1 break;
        proxy_pass http://127.0.0.1:1984;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 1d;
        proxy_send_timeout 1d;
        proxy_buffering off;
        add_header X-Content-Type-Options nosniff always;
        add_header Referrer-Policy no-referrer always;
        add_header X-Frame-Options SAMEORIGIN always;
    }

    location /go2rtc/ {
        return 404;
    }

    location = /_auth {
        internal;
        proxy_pass http://127.0.0.1:3000/api/auth/check;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header Cookie $http_cookie;
        proxy_set_header X-Original-URI $request_uri;
    }

    client_max_body_size 32k;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
}
EOF
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/cctv-home-viewer /etc/nginx/sites-enabled/cctv-home-viewer

cat >/usr/local/bin/cctv-home-viewer-update <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
cd /opt/cctv-home-viewer
git fetch --depth 1 origin main
git reset --hard origin/main
cd app
npm ci --omit=dev
cd ..
rm -rf app/data
ln -s /var/lib/cctv-home-viewer app/data
install -d -o cctv -g go2rtc -m 2750 /var/lib/go2rtc-cctv
install -o cctv -g go2rtc -m 0640 go2rtc.yaml /var/lib/go2rtc-cctv/go2rtc.yaml
systemctl restart go2rtc cctv-home-viewer nginx
systemctl enable --now go2rtc-config.path
systemctl --no-pager --full status cctv-home-viewer go2rtc nginx go2rtc-config.path
EOF
chmod 0755 /usr/local/bin/cctv-home-viewer-update

nginx -t
systemctl daemon-reload
systemctl enable go2rtc cctv-home-viewer nginx go2rtc-config.path
systemctl restart go2rtc cctv-home-viewer nginx go2rtc-config.path
sleep 2
curl -fsS http://127.0.0.1:3000/health >/dev/null
curl -fsS http://127.0.0.1/ | grep -Fq "CCTV HOME VIEWER"

# ADMIN_PASSWORD is only required to initialize auth.json.
sed -i '/^ADMIN_PASSWORD=/d' "$ENV_FILE"
rm -f /root/cctv-lxc-install.sh
apt-get autoremove -y
apt-get clean
rm -rf /var/lib/apt/lists/*

cat >/etc/motd <<'EOF'
CCTV Home Viewer

Web UI: http://<container-ip>/
Update: cctv-home-viewer-update
Logs:
  journalctl -u cctv-home-viewer -f
  journalctl -u go2rtc -f
EOF
