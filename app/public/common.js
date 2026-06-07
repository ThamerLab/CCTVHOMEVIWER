let sessionData;

async function getSession() {
  if (sessionData) return sessionData;
  const response = await fetch("/api/session", { credentials: "same-origin" });
  if (response.status === 401) {
    location.assign("/login");
    throw new Error("Unauthorized");
  }
  sessionData = await response.json();
  return sessionData;
}

async function apiRequest(url, options = {}) {
  const session = await getSession();
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set("Content-Type", "application/json");
  if (options.method && options.method !== "GET") headers.set("X-CSRF-Token", session.csrfToken);
  const response = await fetch(url, { ...options, headers, credentials: "same-origin" });
  if (response.status === 401) {
    location.assign("/login");
    throw new Error("Unauthorized");
  }
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(payload?.error || "تعذر تنفيذ الطلب");
  return payload;
}

document.querySelectorAll(".logout-button").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      await apiRequest("/api/logout", { method: "POST" });
    } finally {
      location.assign("/login");
    }
  });
});
