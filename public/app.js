const form = document.getElementById("processForm");
const statusEl = document.getElementById("status");
const submitButton = document.getElementById("submitButton");
const resultsSection = document.getElementById("results");
const companyButtons = document.getElementById("companyButtons");
const letterCompanyButtons = document.getElementById("letterCompanyButtons");
const letterTemplate = document.getElementById("letterTemplate");
const letterOutput = document.getElementById("letterOutput");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = isError ? "error" : "ok";
}

function renderCompanyButtons(items) {
  companyButtons.innerHTML = "";

  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "company-button";
    button.textContent = item.companyName;
    button.addEventListener("click", () => {
      window.location.href = item.downloadUrl;
    });
    companyButtons.appendChild(button);
  });
}

function getTrimmed(fieldName) {
  const el = form.querySelector(`[name="${fieldName}"]`);
  return el ? String(el.value || "").trim() : "";
}

function formatCoopDate(raw) {
  if (!raw) return "";
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function buildLetterPreview(template, companyName) {
  let t = template;
  t = t.replace(/\[name\]/gi, getTrimmed("userName"));
  t = t.replace(/\[id\]/gi, getTrimmed("userId"));
  t = t.replace(/\[major\]/gi, getTrimmed("major"));
  t = t.replace(/\[university\]/gi, getTrimmed("university"));
  t = t.replace(/\[weeks\]/gi, getTrimmed("weeks"));
  t = t.replace(/\[date\]/gi, formatCoopDate(getTrimmed("coopDate")));
  t = t.replace(/\[company\]/gi, companyName);
  if (/\[[^\]]+\]/.test(t)) {
    t = t.replace(/\[[^\]]+\]/, companyName);
  }
  return t;
}

function renderLetterPreviewButtons(items) {
  letterCompanyButtons.innerHTML = "";

  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "company-button letter-preview-button";
    button.textContent = item.companyName;
    button.addEventListener("click", () => {
      letterOutput.value = buildLetterPreview(letterTemplate.value, item.companyName);
      setStatus(`Letter preview updated for “${item.companyName}”.`);
    });
    letterCompanyButtons.appendChild(button);
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Processing files. Please wait...");
  submitButton.disabled = true;
  resultsSection.classList.add("hidden");
  companyButtons.innerHTML = "";
  letterCompanyButtons.innerHTML = "";
  letterOutput.value = "";

  try {
    const formData = new FormData(form);
    const response = await fetch("/api/process", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to process files.");
    }

    renderCompanyButtons(data.companies);
    renderLetterPreviewButtons(data.companies);
    resultsSection.classList.remove("hidden");
    setStatus(`Done. ${data.total} company PDFs are ready.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});
