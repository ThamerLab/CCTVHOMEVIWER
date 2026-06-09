# التثبيت على Proxmox LXC

يوفر المشروع مثبتًا بأسلوب Proxmox Community Scripts. شغّله من Shell الخاص بعقدة Proxmox VE كمستخدم `root`:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/ThamerLab/CCTVHOMEVIWER/main/scripts/proxmox-lxc.sh)"
```

للمراجعة قبل التنفيذ:

```bash
curl -fsSL https://raw.githubusercontent.com/ThamerLab/CCTVHOMEVIWER/main/scripts/proxmox-lxc.sh -o /root/cctv-lxc.sh
less /root/cctv-lxc.sh
bash /root/cctv-lxc.sh
```

ينشئ المثبت حاوية Debian 13 غير مميزة `unprivileged`، ثم يثبت Node.js وNginx وFFmpeg وgo2rtc وخدمات systemd مباشرة بدون Docker.

## الإعدادات الافتراضية

| الإعداد | القيمة |
|---|---|
| CPU | نواتان |
| RAM | 1024 MB |
| Swap | 512 MB |
| القرص | 8 GB |
| الشبكة | DHCP على `vmbr0` |
| التشغيل مع Proxmox | مفعّل |

يمكن تخصيصها بمتغيرات البيئة:

```bash
CTID=220 CORES=4 RAM=2048 DISK=16 BRIDGE=vmbr0 \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/ThamerLab/CCTVHOMEVIWER/main/scripts/proxmox-lxc.sh)"
```

لإعداد IP ثابت استخدم صيغة Proxmox:

```bash
IP_CONFIG="192.168.1.50/24,gw=192.168.1.1" \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/ThamerLab/CCTVHOMEVIWER/main/scripts/proxmox-lxc.sh)"
```

المتغيرات المدعومة: `CTID` و`HOSTNAME` و`CORES` و`RAM` و`SWAP` و`DISK` و`BRIDGE` و`IP_CONFIG` و`TEMPLATE_STORAGE` و`ROOTFS_STORAGE` و`ADMIN_USERNAME` و`ADMIN_PASSWORD`.

يفضل عدم تمرير كلمة المرور في سطر الأوامر حتى لا تظهر في سجل Shell. سيطلبها المثبت بشكل مخفي، ويولّد مفتاح تشفير البيانات تلقائيًا.

## الشبكة

افتح من شبكتك المحلية:

```text
http://IP-OF-LXC/
```

يحتاج WebRTC وصول العملاء إلى عنوان الحاوية على:

- `80/tcp` للواجهة.
- `8555/tcp` و`8555/udp` لوسائط WebRTC.

إذا كان Proxmox Firewall مفعّلًا، اسمح بهذه المنافذ من الشبكات الموثوقة فقط. لا تنشرها مباشرة على الإنترنت؛ استخدم VPN وHTTPS.

## الصيانة

داخل الحاوية:

```bash
cctv-home-viewer-update
journalctl -u cctv-home-viewer -f
journalctl -u go2rtc -f
systemctl status cctv-home-viewer go2rtc nginx
```

إذا ظهرت صفحة `Welcome to nginx` بعد التثبيت، أعد تحميل إعداد الموقع:

```bash
systemctl restart nginx
```

بيانات الكاميرات والحساب محفوظة في:

```text
/var/lib/cctv-home-viewer
```

ومفتاح التشفير محفوظ بصلاحيات مقيدة في:

```text
/etc/cctv-home-viewer.env
```

احتفظ بنسخة احتياطية من الاثنين، أو استخدم نسخ Proxmox الاحتياطية للحاوية كاملة.
