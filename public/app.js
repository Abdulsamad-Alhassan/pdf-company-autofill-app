const form = document.getElementById("processForm");
const statusEl = document.getElementById("status");
const submitButton = document.getElementById("submitButton");
const resultsSection = document.getElementById("results");
const companyButtons = document.getElementById("companyButtons");

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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Processing files. Please wait...");
  submitButton.disabled = true;
  resultsSection.classList.add("hidden");
  companyButtons.innerHTML = "";

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
    resultsSection.classList.remove("hidden");
    setStatus(`Done. ${data.total} company PDFs are ready.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});
