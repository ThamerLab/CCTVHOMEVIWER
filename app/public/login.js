const form = document.querySelector("#login-form");
const errorElement = document.querySelector("#form-error");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorElement.textContent = "";
  const button = form.querySelector("button");
  button.disabled = true;

  try {
    const data = new FormData(form);
    const response = await fetch("/api/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: data.get("username"),
        password: data.get("password"),
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "تعذر تسجيل الدخول");
    location.assign("/");
  } catch (error) {
    errorElement.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
