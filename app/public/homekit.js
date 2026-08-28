const homekitList = document.querySelector("#homekit-list");
const refreshButton = document.querySelector("#refresh-homekit");

refreshButton.addEventListener("click", loadHomeKit);
loadHomeKit();

async function loadHomeKit() {
  refreshButton.disabled = true;
  try {
    const cameras = await apiRequest("/api/homekit");
    homekitList.replaceChildren();
    if (!cameras.length) {
      homekitList.append(emptyCard("لا توجد كاميرات بعد.", "أضف الكاميرات من لوحة التحكم ثم فعّل HomeKit للكاميرا المطلوبة."));
      return;
    }
    const enabled = cameras.filter((camera) => camera.enabled);
    if (!enabled.length) {
      homekitList.append(emptyCard("HomeKit غير مفعّل.", "افتح لوحة التحكم وعدّل الكاميرا ثم فعّل خيار HomeKit."));
      return;
    }
    enabled.forEach((camera) => homekitList.append(createHomeKitCard(camera)));
  } catch (error) {
    homekitList.replaceChildren(emptyCard("تعذر تحميل بيانات HomeKit.", error.message));
  } finally {
    refreshButton.disabled = false;
  }
}

function createHomeKitCard(camera) {
  const card = document.createElement("article");
  card.className = "homekit-card";

  const title = document.createElement("h3");
  title.textContent = camera.name;

  const status = document.createElement("p");
  status.className = camera.paired ? "homekit-status paired" : "homekit-status";
  status.textContent = camera.paired ? "مقترنة حاليًا" : "جاهزة للربط";

  const qrWrap = document.createElement("div");
  qrWrap.className = "homekit-qr";
  if (camera.qrAvailable) {
    const img = document.createElement("img");
    img.src = `${camera.qrUrl}?v=${Date.now()}`;
    img.alt = `HomeKit QR ${camera.name}`;
    qrWrap.append(img);
  } else {
    const unavailable = document.createElement("p");
    unavailable.className = "muted";
    unavailable.textContent = camera.error || "الباركود غير متاح بعد. انتظر ثواني ثم اضغط تحديث.";
    qrWrap.append(unavailable);
  }

  const pin = document.createElement("p");
  pin.className = "homekit-pin";
  pin.textContent = camera.pin || camera.setupCode || "PIN غير متاح";

  const hint = document.createElement("p");
  hint.className = "muted";
  hint.textContent = camera.paired
    ? "إذا احتجت تربطها من جديد، احذفها من Apple Home ثم اضغط تحديث."
    : "Apple Home > Add Accessory > امسح الباركود أو أدخل الكود يدويًا.";

  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.append(copyButton("نسخ PIN", camera.pin || camera.setupCode || ""));
  if (camera.setupUri) actions.append(copyButton("نسخ QR URI", camera.setupUri));

  card.append(title, status, qrWrap, pin, hint, actions);
  return card;
}

function emptyCard(titleText, bodyText) {
  const card = document.createElement("article");
  card.className = "homekit-card empty-homekit-card";
  const title = document.createElement("h3");
  title.textContent = titleText;
  const body = document.createElement("p");
  body.className = "muted";
  body.textContent = bodyText;
  card.append(title, body);
  return card;
}

function copyButton(label, value) {
  const button = document.createElement("button");
  button.className = "toolbar-button";
  button.type = "button";
  button.textContent = label;
  button.disabled = !value;
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(value);
    button.textContent = "تم النسخ";
    setTimeout(() => {
      button.textContent = label;
    }, 1200);
  });
  return button;
}
