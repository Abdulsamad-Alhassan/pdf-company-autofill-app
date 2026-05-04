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

/** For [ Month / Date ] style: e.g. May/4/2026 from the date picker */
function formatMonthSlashDate(raw) {
  if (!raw) return "";
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  const month = d.toLocaleString(undefined, { month: "long" });
  const day = d.getDate();
  const year = d.getFullYear();
  return `${month}/${day}/${year}`;
}

function normalizeBracketInner(inner) {
  return String(inner)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, "/");
}

/** Map user-facing labels to internal field keys */
function canonicalBracketKey(normalizedInner) {
  switch (normalizedInner) {
    case "number":
      return "weeks";
    case "company name":
    case "companyname":
      return "company";
    case "month/date":
      return "monthdate";
    default:
      return normalizedInner;
  }
}

const KNOWN_BRACKET_KEYS = new Set([
  "name",
  "id",
  "major",
  "university",
  "weeks",
  "date",
  "company",
  "monthdate",
]);

function valueForCanonicalKey(key, companyName) {
  switch (key) {
    case "name":
      return getTrimmed("userName");
    case "id":
      return getTrimmed("userId");
    case "major":
      return getTrimmed("major");
    case "university":
      return getTrimmed("university");
    case "weeks":
      return getTrimmed("weeks");
    case "date":
      return formatCoopDate(getTrimmed("coopDate"));
    case "monthdate":
      return formatMonthSlashDate(getTrimmed("coopDate"));
    case "company":
      return companyName;
    default:
      return null;
  }
}

function buildLetterPreview(template, companyName) {
  const bracketRe = /\[\s*([^\]]*?)\s*\]/g;

  let t = template.replace(bracketRe, (full, inner) => {
    const normalized = normalizeBracketInner(inner);
    const key = canonicalBracketKey(normalized);
    if (!KNOWN_BRACKET_KEYS.has(key)) {
      return full;
    }
    return valueForCanonicalKey(key, companyName);
  });

  if (/\[\s*[^\]]+\s*\]/.test(t)) {
    t = t.replace(/\[\s*[^\]]+\s*\]/, companyName);
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
