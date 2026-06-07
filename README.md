# CCTV Home Viewer

لوحة خاصة لعرض وإدارة كاميرات المنزل عبر WebRTC. تدعم إضافة أي عدد من الكاميرات، تعديل أسمائها وروابطها، حذفها، وتكبير كل بث.

نتائج اختبار الاختراق والإصلاحات موثقة في [PENTEST.md](PENTEST.md).

## الحماية

- تسجيل دخول إلزامي للمشاهدة والإدارة ومسارات WebRTC.
- جلسة عشوائية مخزنة على الخادم داخل Cookie من نوع `HttpOnly` و`SameSite=Strict`.
- حماية CSRF وتحقق من مصدر طلبات التعديل.
- تجزئة كلمة المرور باستخدام Scrypt.
- تشفير روابط الكاميرات على القرص باستخدام AES-256-GCM.
- منع إظهار رابط RTSP المحفوظ مرة أخرى في المتصفح.
- قفل تدريجي بعد محاولات الدخول الفاشلة.
- انتهاء الجلسة بالخمول ومدة قصوى مطلقة.
- قيود CSP ورؤوس حماية للمتصفح.
- واجهة go2rtc غير منشورة مباشرة، ولا يتم منح التطبيق Docker Socket.
- منع روابط loopback وخدمات metadata والعناوين العامة افتراضيًا للحد من SSRF.

## التشغيل الأول

1. ثبّت Docker وDocker Compose.
2. أنشئ ملف البيئة:

```powershell
Copy-Item .env.example .env
```

3. افتح `.env` وغيّر القيم التالية إلى أسرار طويلة ومختلفة:

```text
ADMIN_USERNAME=admin
ADMIN_PASSWORD=كلمة-مرور-طويلة-وعشوائية
DATA_ENCRYPTION_KEY=مفتاح-آخر-عشوائي-بطول-32-حرفًا-على-الأقل
```

يمكن توليد أسرار عشوائية في PowerShell:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

4. شغّل:

```powershell
docker compose up -d --build
```

5. افتح:

```text
http://IP-OF-DOCKER-SERVER:8080
```

بعد تسجيل الدخول افتح **لوحة التحكم** وأضف روابط الكاميرات.

بعد نجاح التشغيل الأول وإنشاء الحساب، يمكنك حذف سطر `ADMIN_PASSWORD` من `.env`. كلمة المرور المجزأة تبقى في Docker volume، ولن يحتاج التطبيق إلى قيمة التهيئة مرة أخرى.

افتراضيًا تقبل لوحة التحكم كاميرات الشبكات الخاصة فقط، مثل `192.168.x.x` و`10.x.x.x` وعناوين Tailscale. إذا كنت تحتاج مصدر بث بعنوان إنترنت عام، اضبط `ALLOW_PUBLIC_CAMERA_HOSTS=true` بعد تقييم المخاطر.

## HTTPS

عند الوصول من خارج الجهاز أو عبر شبكة غير موثوقة، ضع التطبيق خلف reverse proxy يستخدم HTTPS ثم اضبط:

```text
SECURE_COOKIES=true
```

لا تنشر الصفحة أو المنفذ `8555` على الإنترنت مباشرة. استخدم VPN مثل WireGuard أو Tailscale. HTTPS مطلوب لحماية كلمة المرور والجلسة أثناء النقل.

## النسخ الاحتياطي

البيانات محفوظة في Docker volume باسم `app_data`. احتفظ بنسخة من:

- Docker volume.
- قيمة `DATA_ENCRYPTION_KEY`.

فقدان مفتاح التشفير يعني عدم القدرة على قراءة روابط الكاميرات المحفوظة.

## الأوامر

```powershell
docker compose ps
docker compose logs -f app
docker compose logs -f go2rtc
docker compose down
```

## المنافذ

| المنفذ | الاستخدام |
|---|---|
| `8080/tcp` | الموقع وصفحات الإدارة |
| `8555/tcp` | وسائط WebRTC |
| `8555/udp` | وسائط WebRTC منخفضة التأخير |
