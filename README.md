# CCTV Home Viewer

لوحة خفيفة لعرض ثلاث كاميرات IP جنبًا إلى جنب بملء الشاشة باستخدام Docker وgo2rtc وWebRTC.

## التشغيل

1. ثبّت Docker وDocker Compose على جهاز الاستضافة.
2. انسخ ملف الإعداد:

```powershell
Copy-Item .env.example .env
```

3. عدّل روابط `CAMERA_1_URL` و`CAMERA_2_URL` و`CAMERA_3_URL` داخل `.env`.
4. شغّل المشروع:

```powershell
docker compose up -d
```

5. افتح الصفحة:

```text
http://IP-OF-DOCKER-SERVER:8080
```

## ملاحظات

- يفضّل ضبط بث الكاميرات على H.264 لأفضل توافق مع المتصفحات.
- افتح المنفذ `8555` بنوعيه TCP وUDP داخل الشبكة لاتصال WebRTC.
- لا ترفع ملف `.env` إلى GitHub لأنه يحتوي على بيانات دخول الكاميرات.
- لا تنشر الصفحة مباشرة على الإنترنت. استخدم VPN أو reverse proxy مع HTTPS وتسجيل دخول.

## المنافذ

| المنفذ | الاستخدام |
|---|---|
| `8080/tcp` | صفحة العرض |
| `8555/tcp` | وسائط WebRTC احتياطيًا |
| `8555/udp` | وسائط WebRTC بزمن تأخير منخفض |
