const status = document.querySelector("#status");
const button = document.querySelector("#invoke");
const operation = document.querySelector("#operation");
const result = document.querySelector("#result");
const error = document.querySelector("#error");
const steps = [
  "Discovering mature private notes",
  "Deriving the app-scoped shadow address",
  "Generating the STARK proof",
  "Handing the proof to the private relayer",
  "Verifying the onchain result",
];
let timer;

fetch("/api/config")
  .then((response) => response.json())
  .then((config) => {
    document.querySelector("#app-name").textContent = config.appName;
    document.querySelector("#anonymizer").textContent = short(config.anonymizer);
    document.querySelector("#route-shadow").textContent = `shadow/${config.nonce}`;
    button.disabled = !config.configured;
    document.querySelector("#setup-note").classList.toggle("hidden", config.configured);
  })
  .catch(() => showError("Could not load local configuration."));

button.addEventListener("click", async () => {
  setState("running");
  let step = 0;
  document.querySelector("#operation-copy").textContent = steps[0];
  timer = setInterval(() => {
    step = Math.min(step + 1, steps.length - 1);
    document.querySelector("#operation-copy").textContent = steps[step];
  }, 6000);
  try {
    const response = await fetch("/api/invoke", {
      method: "POST",
      headers: { "x-shadow-workbench": "1" },
    });
    const body = await response.json();
    const message = typeof body.error === "string" ? body.error : body.error?.message;
    if (!response.ok || !body.ok) throw new Error(message || `Request failed (${response.status})`);
    clearInterval(timer);
    setState("success");
    document.querySelector("#result-address").textContent = short(body.result.shadowAddress);
    document.querySelector("#result-link").href = body.result.explorerUrl;
  } catch (caught) {
    clearInterval(timer);
    showError(caught instanceof Error ? caught.message : "The invocation failed.");
  }
});

function setState(next) {
  status.className = `status status-${next}`;
  status.textContent = next;
  operation.classList.toggle("hidden", next !== "running");
  result.classList.toggle("hidden", next !== "success");
  error.classList.add("hidden");
  button.disabled = next === "running";
  button.querySelector("span").textContent = next === "running" ? "Proving…" : next === "success" ? "Run it again" : "Run verified transfer";
}

function showError(message) {
  setState("error");
  error.classList.remove("hidden");
  document.querySelector("#error-copy").textContent = message;
}

function short(value) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}
