import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import QRCode from "qrcode";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const port = 3000;
const publicDir = path.resolve("public");
const dataDir = path.resolve("data");
const authFile = path.join(dataDir, "auth.json");
const camerasFile = path.join(dataDir, "cameras.json");
const go2rtcBase = process.env.GO2RTC_URL || "http://go2rtc:1984";
const go2rtcConfigPath = process.env.GO2RTC_CONFIG_PATH || "";
const sessionCookie = "cctv_session";
const sessions = new Map();
const loginAttempts = new Map();
const idleMs = numberEnv("SESSION_IDLE_MINUTES", 30, 5, 240) * 60_000;
const absoluteMs = numberEnv("SESSION_ABSOLUTE_HOURS", 12, 1, 72) * 3_600_000;
const secureCookies = process.env.SECURE_COOKIES === "true";
const adminUsername = normalizeUsername(process.env.ADMIN_USERNAME || "admin");
const encryptionSecret = process.env.DATA_ENCRYPTION_KEY || "";
const encryptionKey = createHash("sha256").update(encryptionSecret).digest();
const allowPublicCameraHosts = process.env.ALLOW_PUBLIC_CAMERA_HOSTS === "true";
const allowedProtocols = new Set(["rtsp:", "rtsps:", "http:", "https:", "onvif:", "homekit:", "tapo:"]);

if (encryptionSecret.length < 32) {
  throw new Error("DATA_ENCRYPTION_KEY must be at least 32 characters");
}

await fs.mkdir(dataDir, { recursive: true });
await initializeAuth();
await initializeCameras();
await syncGo2rtcConfig();
void syncAllCameras();

const server = http.createServer(async (req, res) => {
  try {
    setSecurityHeaders(req, res);

    if (req.url === "/health" && req.method === "GET") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.url.startsWith("/api/")) {
      return await handleApi(req, res);
    }

    return await servePage(req, res);
  } catch (error) {
    console.error(error);
    return sendJson(res, error.status || 500, { error: error.status ? error.message : "حدث خطأ داخلي" });
  }
});

server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;
server.maxRequestsPerSocket = 1_000;

server.listen(port, "0.0.0.0", () => {
  console.log(`CCTV app listening on ${port}`);
});

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastSeen > idleMs || now - session.createdAt > absoluteMs) {
      sessions.delete(id);
    }
  }
  for (const [key, attempt] of loginAttempts) {
    if (now - attempt.lastAttempt > 30 * 60_000) loginAttempts.delete(key);
  }
}, 60_000).unref();

async function handleApi(req, res) {
  if (req.url === "/api/login" && req.method === "POST") return login(req, res);
  if (req.url === "/api/auth/check" && req.method === "GET") {
    return authorizeProxyRequest(req, res);
  }

  const session = getSession(req);
  if (!session) return sendJson(res, 401, { error: "يجب تسجيل الدخول" });

  if (req.url === "/api/session" && req.method === "GET") {
    return sendJson(res, 200, { username: session.username, csrfToken: session.csrfToken });
  }
  if (req.url === "/api/logout" && req.method === "POST") {
    verifyMutation(req, session);
    sessions.delete(session.id);
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }
  if (req.url === "/api/cameras" && req.method === "GET") {
    const cameras = await readCameras();
    return sendJson(res, 200, cameras.map(publicCamera));
  }
  if (req.url === "/api/homekit" && req.method === "GET") {
    return listHomeKitCameras(res);
  }
  if (req.url === "/api/cameras" && req.method === "POST") {
    verifyMutation(req, session);
    return createCamera(req, res);
  }
  if (req.url === "/api/password" && req.method === "PUT") {
    verifyMutation(req, session);
    return changePassword(req, res, session);
  }

  const apiPathname = new URL(req.url, "http://local").pathname;
  const homekitQrMatch = apiPathname.match(/^\/api\/homekit\/cameras\/([a-z0-9_-]+)\/qr\.svg$/);
  if (homekitQrMatch && req.method === "GET") {
    return homeKitQr(res, homekitQrMatch[1]);
  }

  const match = req.url.match(/^\/api\/cameras\/([a-z0-9_-]+)$/);
  if (match && req.method === "PUT") {
    verifyMutation(req, session);
    return updateCamera(req, res, match[1]);
  }
  if (match && req.method === "DELETE") {
    verifyMutation(req, session);
    return deleteCamera(res, match[1]);
  }

  return sendJson(res, 404, { error: "المسار غير موجود" });
}

async function login(req, res) {
  verifyOrigin(req);
  const ip = getClientIp(req);
  const attempt = loginAttempts.get(ip);
  const now = Date.now();
  if (attempt?.blockedUntil > now) {
    res.setHeader("Retry-After", Math.ceil((attempt.blockedUntil - now) / 1000));
    return sendJson(res, 429, { error: "محاولات كثيرة. حاول لاحقًا" });
  }

  const body = await readJson(req);
  const username = normalizeUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  const auth = JSON.parse(await fs.readFile(authFile, "utf8"));
  const validUser = safeEqual(username, auth.username);
  const validPassword = await verifyPassword(password, auth);

  if (!validUser || !validPassword) {
    recordFailedLogin(ip);
    await delay(350 + Math.floor(Math.random() * 250));
    return sendJson(res, 401, { error: "بيانات الدخول غير صحيحة" });
  }

  loginAttempts.delete(ip);
  const id = randomBytes(32).toString("base64url");
  const session = {
    id,
    username: auth.username,
    csrfToken: randomBytes(32).toString("base64url"),
    createdAt: now,
    lastSeen: now,
  };
  sessions.set(id, session);
  setSessionCookie(res, id);
  return sendJson(res, 200, { ok: true });
}

async function authorizeProxyRequest(req, res) {
  if (!getSession(req)) return res.writeHead(401).end();
  const originalUri = String(req.headers["x-original-uri"] || "");
  const target = new URL(originalUri, "http://internal");
  if (target.pathname === "/go2rtc/api/ws") {
    const source = target.searchParams.get("src") || "";
    if (!/^cam_[a-f0-9]{32}$/.test(source)) return res.writeHead(403).end();
    const cameras = await readCameras();
    if (!cameras.some((camera) => camera.id === source)) return res.writeHead(403).end();
  }
  return res.writeHead(204).end();
}

async function createCamera(req, res) {
  const body = await readJson(req);
  const name = validateName(body.name);
  const url = await validateStreamUrl(body.url);
  const camera = {
    id: `cam_${randomUUID().replaceAll("-", "")}`,
    name,
    source: encrypt(url),
    homekit: buildHomeKitSettings(body.homekitEnabled),
    createdAt: new Date().toISOString(),
  };
  await setGo2rtcStream(camera.id, url);
  const cameras = await readCameras();
  cameras.push(camera);
  await writeCameras(cameras);
  await syncGo2rtcConfig(cameras);
  return sendJson(res, 201, publicCamera(camera));
}

async function updateCamera(req, res, id) {
  const body = await readJson(req);
  const cameras = await readCameras();
  const camera = cameras.find((item) => item.id === id);
  if (!camera) return sendJson(res, 404, { error: "الكاميرا غير موجودة" });

  camera.name = validateName(body.name);
  camera.homekit = buildHomeKitSettings(body.homekitEnabled, camera.homekit);
  if (body.url) {
    const url = await validateStreamUrl(body.url);
    await setGo2rtcStream(camera.id, url);
    camera.source = encrypt(url);
  }
  camera.updatedAt = new Date().toISOString();
  await writeCameras(cameras);
  await syncGo2rtcConfig(cameras);
  return sendJson(res, 200, publicCamera(camera));
}

async function deleteCamera(res, id) {
  const cameras = await readCameras();
  const index = cameras.findIndex((item) => item.id === id);
  if (index === -1) return sendJson(res, 404, { error: "الكاميرا غير موجودة" });
  await deleteGo2rtcStream(id);
  cameras.splice(index, 1);
  await writeCameras(cameras);
  await syncGo2rtcConfig(cameras);
  return sendJson(res, 200, { ok: true });
}

async function changePassword(req, res, session) {
  const body = await readJson(req);
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (newPassword.length < 14 || newPassword.length > 128) {
    return sendJson(res, 400, { error: "كلمة المرور الجديدة يجب أن تكون بين 14 و128 حرفًا" });
  }
  const auth = JSON.parse(await fs.readFile(authFile, "utf8"));
  if (!(await verifyPassword(currentPassword, auth))) {
    return sendJson(res, 403, { error: "كلمة المرور الحالية غير صحيحة" });
  }
  const passwordData = await hashPassword(newPassword);
  await atomicWrite(authFile, JSON.stringify({ username: auth.username, ...passwordData }, null, 2));
  for (const [id] of sessions) if (id !== session.id) sessions.delete(id);
  return sendJson(res, 200, { ok: true });
}

async function listHomeKitCameras(res) {
  const cameras = await readCameras();
  const result = [];
  for (const camera of cameras) {
    const enabled = Boolean(camera.homekit?.enabled);
    const item = {
      id: camera.id,
      name: camera.name,
      enabled,
      pin: enabled ? formatHomeKitPin(camera.homekit.pin) : "",
      paired: false,
      qrAvailable: false,
      qrUrl: enabled ? `/api/homekit/cameras/${camera.id}/qr.svg` : "",
    };
    if (enabled) {
      try {
        const info = await getGo2rtcHomeKitInfo(camera.id);
        item.name = info.name || item.name;
        item.paired = Number(info.paired || 0) > 0;
        item.setupCode = info.setup_code || "";
        item.setupId = info.setup_id || "";
        item.setupUri = buildHomeKitSetupUri(info);
        item.qrAvailable = Boolean(item.setupUri);
      } catch (error) {
        item.error = error.message;
      }
    }
    result.push(item);
  }
  return sendJson(res, 200, result);
}

async function homeKitQr(res, id) {
  const cameras = await readCameras();
  const camera = cameras.find((item) => item.id === id);
  if (!camera || !camera.homekit?.enabled) return sendJson(res, 404, { error: "HomeKit غير مفعّل لهذه الكاميرا" });
  const info = await getGo2rtcHomeKitInfo(id);
  const setupUri = buildHomeKitSetupUri(info);
  if (!setupUri) return sendJson(res, 409, { error: "QR غير متاح بعد الاقتران أو قبل جاهزية go2rtc" });
  const svg = await QRCode.toString(setupUri, {
    errorCorrectionLevel: "quartile",
    margin: 1,
    type: "svg",
    width: 320,
  });
  return sendSvg(res, 200, svg);
}

async function servePage(req, res) {
  const pathname = new URL(req.url, "http://local").pathname;
  const session = getSession(req);
  if (pathname === "/login") {
    if (session) return redirect(res, "/");
    return serveFile(res, "login.html");
  }
  if (!session && (pathname === "/styles.css" || pathname === "/login.js")) {
    return serveFile(res, pathname.slice(1));
  }
  if (!session) return redirect(res, "/login");

  const routes = {
    "/": "viewer.html",
    "/admin": "admin.html",
    "/homekit": "homekit.html",
    "/styles.css": "styles.css",
    "/common.js": "common.js",
    "/viewer.js": "viewer.js",
    "/admin.js": "admin.js",
    "/homekit.js": "homekit.js",
    "/login.js": "login.js",
  };
  const file = routes[pathname];
  if (!file) return sendText(res, 404, "Not found");
  return serveFile(res, file);
}

async function serveFile(res, file) {
  const resolved = path.join(publicDir, file);
  const ext = path.extname(file);
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
  const content = await fs.readFile(resolved);
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": "no-store" });
  res.end(content);
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const id = cookies[sessionCookie];
  if (!id) return null;
  const session = sessions.get(id);
  if (!session) return null;
  const now = Date.now();
  if (now - session.lastSeen > idleMs || now - session.createdAt > absoluteMs) {
    sessions.delete(id);
    return null;
  }
  session.lastSeen = now;
  return session;
}

function verifyMutation(req, session) {
  verifyOrigin(req);
  const token = req.headers["x-csrf-token"];
  if (typeof token !== "string" || !safeEqual(token, session.csrfToken)) {
    throw httpError(403, "رمز الحماية غير صالح");
  }
}

function verifyOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  const proto = req.headers["x-forwarded-proto"] || "http";
  const expected = `${proto}://${req.headers.host}`;
  if (origin !== expected) throw httpError(403, "مصدر الطلب غير مسموح");
}

async function readJson(req) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.startsWith("application/json")) throw httpError(415, "نوع المحتوى غير مدعوم");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw httpError(413, "الطلب كبير جدًا");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "JSON غير صالح");
  }
}

async function initializeAuth() {
  try {
    await fs.access(authFile);
  } catch {
    const initialPassword = process.env.ADMIN_PASSWORD || "";
    if (initialPassword.length < 14) {
      throw new Error("ADMIN_PASSWORD must be at least 14 characters on first startup");
    }
    const passwordData = await hashPassword(initialPassword);
    await atomicWrite(authFile, JSON.stringify({ username: adminUsername, ...passwordData }, null, 2));
  }
}

async function initializeCameras() {
  try {
    await fs.access(camerasFile);
  } catch {
    await writeCameras([]);
  }
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return { salt: salt.toString("base64"), hash: hash.toString("base64") };
}

async function verifyPassword(password, auth) {
  const salt = Buffer.from(auth.salt, "base64");
  const expected = Buffer.from(auth.hash, "base64");
  const actual = await scrypt(password, salt, expected.length, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: ciphertext.toString("base64"),
  };
}

function decrypt(payload) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload.data, "base64")), decipher.final()]).toString("utf8");
}

async function readCameras() {
  return JSON.parse(await fs.readFile(camerasFile, "utf8"));
}

async function writeCameras(cameras) {
  await atomicWrite(camerasFile, JSON.stringify(cameras, null, 2));
}

async function atomicWrite(file, content, mode = 0o600) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, content, { mode });
  await fs.rename(temporary, file);
}

async function syncGo2rtcConfig(cameras = null) {
  if (!go2rtcConfigPath) return;
  const savedCameras = cameras || await readCameras();
  const lines = [
    "app:",
    "  modules: [api, ws, rtsp, webrtc, exec, ffmpeg, mjpeg, homekit]",
    "",
    "api:",
    "  listen: \":1984\"",
    "  allow_paths: [\"/\", \"/api/streams\", \"/api/ws\", \"/api/homekit\", \"/pair-setup\", \"/pair-verify\"]",
    "",
    "rtsp:",
    "  listen: \"\"",
    "",
    "exec:",
    "  allow_paths: [ffmpeg]",
    "",
    "webrtc:",
    "  listen: \":8555\"",
    "",
    "streams:",
  ];
  for (const camera of savedCameras) {
    lines.push(`  ${camera.id}: ${yamlString(decrypt(camera.source))}`);
  }
  const homekitCameras = savedCameras.filter((camera) => camera.homekit?.enabled);
  lines.push("", "homekit:");
  if (homekitCameras.length === 0) {
    lines.push("  # Enable HomeKit per camera from the admin page.");
  } else {
    for (const camera of homekitCameras) {
      lines.push(`  ${camera.id}:`);
      lines.push(`    pin: ${yamlString(camera.homekit.pin)}`);
      lines.push(`    name: ${yamlString(camera.name)}`);
      lines.push(`    device_id: ${yamlString(camera.homekit.deviceId)}`);
      lines.push(`    device_private: ${yamlString(camera.homekit.devicePrivate)}`);
    }
  }
  lines.push("", "log:", "  level: info", "");
  await fs.mkdir(path.dirname(go2rtcConfigPath), { recursive: true });
  await atomicWrite(go2rtcConfigPath, lines.join("\n"), 0o640);
}

async function syncAllCameras() {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      for (const camera of await readCameras()) {
        await setGo2rtcStream(camera.id, decrypt(camera.source));
      }
      return;
    } catch (error) {
      console.error(`go2rtc sync attempt ${attempt} failed:`, error.message);
      await delay(1500 * attempt);
    }
  }
}

async function setGo2rtcStream(name, source) {
  const query = new URLSearchParams({ name, src: source });
  // PATCH updates runtime only, so camera credentials never enter go2rtc.yaml.
  const response = await fetch(`${go2rtcBase}/api/streams?${query}`, { method: "PATCH", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw httpError(502, "تعذر تحديث خادم البث");
}

async function deleteGo2rtcStream(name) {
  const query = new URLSearchParams({ src: name });
  await fetch(`${go2rtcBase}/api/streams?${query}`, { method: "DELETE", signal: AbortSignal.timeout(8000) });
  const check = await fetch(`${go2rtcBase}/api/streams?${query}`, { signal: AbortSignal.timeout(8000) });
  if (check.status !== 404) throw httpError(502, "تعذر حذف البث");
}

function publicCamera(camera) {
  const homekit = camera.homekit?.enabled
    ? { enabled: true, pin: camera.homekit.pin }
    : { enabled: false };
  return { id: camera.id, name: camera.name, configured: true, homekit };
}

async function getGo2rtcHomeKitInfo(id) {
  const query = new URLSearchParams({ id });
  const response = await fetch(`${go2rtcBase}/api/homekit?${query}`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw httpError(502, "تعذر قراءة بيانات HomeKit من go2rtc");
  return response.json();
}

function buildHomeKitSetupUri(info) {
  const setupCode = String(info.setup_code || "").replace(/\D/g, "");
  const setupId = String(info.setup_id || "");
  const category = Number.parseInt(info.category_id || "17", 10);
  if (!/^\d{8}$/.test(setupCode) || !/^[A-Z0-9]{4}$/.test(setupId) || !Number.isFinite(category)) {
    return "";
  }
  const payload = (BigInt(category & 0xff) << 31n) | (2n << 27n) | BigInt(Number(setupCode) & 0x7ffffff);
  return `X-HM://${payload.toString(36).toUpperCase().padStart(9, "0")}${setupId}`;
}

function buildHomeKitSettings(enabled, previous = null) {
  if (!enabled) return { enabled: false };
  return {
    enabled: true,
    pin: previous?.pin || generateHomeKitPin(),
    deviceId: previous?.deviceId || randomBytes(6).toString("hex").match(/.{2}/g).join(":").toUpperCase(),
    devicePrivate: previous?.devicePrivate || randomBytes(32).toString("hex"),
  };
}

function formatHomeKitPin(pin) {
  const value = String(pin || "").replace(/\D/g, "");
  if (value.length !== 8) return String(pin || "");
  return `${value.slice(0, 3)}-${value.slice(3, 5)}-${value.slice(5)}`;
}

function generateHomeKitPin() {
  const pin = String(randomNumber(10_000_000, 99_999_999));
  return pin === "19550224" ? "19550225" : pin;
}

function randomNumber(min, max) {
  const range = max - min + 1;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  let value;
  do {
    value = randomBytes(4).readUInt32BE(0);
  } while (value >= limit);
  return min + (value % range);
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function validateName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 1 || name.length > 60) throw httpError(400, "اسم الكاميرا يجب أن يكون بين 1 و60 حرفًا");
  if (/[\u0000-\u001f\u007f]/u.test(name)) throw httpError(400, "اسم الكاميرا غير صالح");
  return name;
}

async function validateStreamUrl(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 2048) {
    throw httpError(400, "رابط البث غير صالح");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw httpError(400, "رابط البث غير صالح");
  }
  if (!allowedProtocols.has(parsed.protocol)) throw httpError(400, "بروتوكول البث غير مسموح");
  if (!parsed.hostname) throw httpError(400, "عنوان الكاميرا مفقود");
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const forbiddenHosts = new Set(["localhost", "0.0.0.0", "::1", "go2rtc", "app", "gateway", "169.254.169.254"]);
  if (forbiddenHosts.has(hostname) || hostname.startsWith("127.")) {
    throw httpError(400, "عنوان الكاميرا غير مسموح");
  }
  if (!allowPublicCameraHosts) {
    let addresses;
    try {
      addresses = isIP(hostname)
        ? [hostname]
        : (await lookup(hostname, { all: true })).map((entry) => entry.address);
    } catch {
      throw httpError(400, "تعذر التحقق من عنوان الكاميرا");
    }
    if (!addresses.length || addresses.some((address) => !isPrivateAddress(address))) {
      throw httpError(400, "يُسمح افتراضيًا بعناوين الشبكة الخاصة فقط");
    }
  }
  return value;
}

function isPrivateAddress(address) {
  const value = address.toLowerCase().split("%")[0];
  if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
  if (isIP(value) === 4) {
    const [a, b] = value.split(".").map(Number);
    return a === 10
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127);
  }
  if (isIP(value) === 6) {
    return value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value);
  }
  return false;
}

function setSessionCookie(res, id) {
  const secure = secureCookies ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${sessionCookie}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(absoluteMs / 1000)}${secure}`);
}

function clearSessionCookie(res) {
  const secure = secureCookies ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

function setSecurityHeaders(req, res) {
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cache-Control", "no-store");
  if (req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const previous = loginAttempts.get(ip) || { count: 0, lastAttempt: now, blockedUntil: 0 };
  previous.count += 1;
  previous.lastAttempt = now;
  if (previous.count >= 5) {
    const minutes = Math.min(30, 2 ** Math.min(previous.count - 5, 5));
    previous.blockedUntil = now + minutes * 60_000;
  }
  loginAttempts.set(ip, previous);
}

function parseCookies(header) {
  const result = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0) result[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return result;
}

function normalizeUsername(value) {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 64) : "";
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function getClientIp(req) {
  return String(req.headers["x-real-ip"] || req.socket.remoteAddress || "unknown").slice(0, 128);
}

function numberEnv(name, fallback, min, max) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function sendSvg(res, status, svg) {
  res.writeHead(status, { "Content-Type": "image/svg+xml; charset=utf-8" });
  res.end(svg);
}
