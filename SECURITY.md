# Security policy

CCTV Home Viewer handles **live household camera feeds**, camera credentials, and Apple HomeKit pairing material. It is intended for **trusted local networks**, not direct public exposure.

## Reporting vulnerabilities

Do **not** post camera URLs, passwords, tokens, home addresses, or HomeKit setup information in public issues. Use GitHub's private vulnerability reporting, if enabled, or contact the maintainer privately through a verified channel.

## Deployment checklist

- Never port-forward 80/8080 or 8555 from the public internet. Use a VPN or authenticated HTTPS reverse proxy and restrict WebRTC media connectivity to trusted networks.
- Set unique strong admin credentials and a separate random `DATA_ENCRYPTION_KEY`, and protect your `.env` / `/etc/cctv-home-viewer.env`.
- Set `SECURE_COOKIES=true` only when the site is accessed over HTTPS.
- Restrict ingress with a firewall; in Docker, optionally set `WEB_BIND_IP` and `MEDIA_BIND_IP` to the trusted host IP.
- Back up BOTH persistent camera database and encryption key; LXC HomeKit also stores sensitive pairing information under `/var/lib/go2rtc-cctv`.
- Treat the go2rtc configuration as sensitive: with HomeKit enabled it may contain camera source URLs **in cleartext**. It should only be readable by restricted local accounts.
- Review updates, images, Node.js packages, go2rtc binaries, and installer scripts before deploying to your home network.
- Revoke and replace camera passwords if configuration files have been disclosed.

## Verification status

The workflow checks JavaScript syntax, shell syntax, Compose configuration, and a few preservation invariants. These checks are **not a penetration test** and cannot validate actual camera streams, LAN firewall rules, HomeKit pairing or Proxmox startup. See [PENTEST.md](PENTEST.md) for the scope and limitations of the historical local assessment.
