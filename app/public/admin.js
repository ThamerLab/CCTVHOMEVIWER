const cameraList = document.querySelector("#camera-list");
const dialog = document.querySelector("#camera-dialog");
const cameraForm = document.querySelector("#camera-form");
const cameraMessage = document.querySelector("#camera-form-message");
const passwordForm = document.querySelector("#password-form");
const passwordMessage = document.querySelector("#password-message");

document.querySelector("#add-camera-button").addEventListener("click", () => openCameraDialog());
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => dialog.close());
});

cameraForm.addEventListener("submit", saveCamera);
passwordForm.addEventListener("submit", changePassword);
loadCameras();

async function loadCameras() {
  try {
    const cameras = await apiRequest("/api/cameras");
    cameraList.replaceChildren();
    if (!cameras.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "لم تتم إضافة كاميرات بعد.";
      cameraList.append(empty);
      return;
    }
    cameras.forEach((camera) => cameraList.append(createRow(camera)));
  } catch (error) {
    cameraList.textContent = error.message;
  }
}

function createRow(camera) {
  const row = document.createElement("article");
  row.className = "camera-row";

  const info = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = camera.name;
  const status = document.createElement("p");
  status.className = "configured-label";
  status.textContent = "الرابط محفوظ ومشفّر";
  info.append(title, status);

  const actions = document.createElement("div");
  actions.className = "row-actions";
  const edit = document.createElement("button");
  edit.className = "toolbar-button";
  edit.type = "button";
  edit.textContent = "تعديل";
  edit.addEventListener("click", () => openCameraDialog(camera));

  const remove = document.createElement("button");
  remove.className = "danger-button";
  remove.type = "button";
  remove.textContent = "حذف";
  remove.addEventListener("click", async () => {
    if (!confirm(`حذف ${camera.name}؟`)) return;
    try {
      await apiRequest(`/api/cameras/${camera.id}`, { method: "DELETE" });
      await loadCameras();
    } catch (error) {
      alert(error.message);
    }
  });
  actions.append(edit, remove);
  row.append(info, actions);
  return row;
}

function openCameraDialog(camera = null) {
  cameraForm.reset();
  cameraMessage.textContent = "";
  cameraForm.elements.id.value = camera?.id || "";
  cameraForm.elements.name.value = camera?.name || "";
  cameraForm.elements.url.required = !camera;
  document.querySelector("#camera-dialog-title").textContent = camera ? "تعديل الكاميرا" : "إضافة كاميرا";
  dialog.showModal();
}

async function saveCamera(event) {
  event.preventDefault();
  cameraMessage.textContent = "";
  const data = new FormData(cameraForm);
  const id = data.get("id");
  const payload = { name: data.get("name"), url: data.get("url") };
  try {
    await apiRequest(id ? `/api/cameras/${id}` : "/api/cameras", {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    dialog.close();
    await loadCameras();
  } catch (error) {
    cameraMessage.textContent = error.message;
  }
}

async function changePassword(event) {
  event.preventDefault();
  passwordMessage.className = "form-message";
  passwordMessage.textContent = "";
  const data = new FormData(passwordForm);
  if (data.get("newPassword") !== data.get("confirmPassword")) {
    passwordMessage.classList.add("error");
    passwordMessage.textContent = "تأكيد كلمة المرور غير مطابق";
    return;
  }
  try {
    await apiRequest("/api/password", {
      method: "PUT",
      body: JSON.stringify({
        currentPassword: data.get("currentPassword"),
        newPassword: data.get("newPassword"),
      }),
    });
    passwordForm.reset();
    passwordMessage.classList.add("success");
    passwordMessage.textContent = "تم تغيير كلمة المرور وإغلاق الجلسات الأخرى";
  } catch (error) {
    passwordMessage.classList.add("error");
    passwordMessage.textContent = error.message;
  }
}
