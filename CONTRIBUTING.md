# Contributing

Contributions are welcome, especially reproducible fixes for go2rtc, WebRTC, HomeKit and Proxmox integration.

Run `npm ci` in `app/`, then `node --check app/server.js`; also run `bash -n scripts/*.sh` and `docker compose config` (with a local `.env`). GitHub Actions repeats these checks.

When updating LXC scripts, preserve `/var/lib/cctv-home-viewer`, `/var/lib/go2rtc-cctv` and `/etc/cctv-home-viewer.env`, and document backup/rollback behavior. Never include real RTSP URLs or pairing secrets in test fixtures or bug reports.

For security flaws, follow [SECURITY.md](SECURITY.md) instead of opening public exploit reports.
