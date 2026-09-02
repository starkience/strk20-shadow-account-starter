const api = await import("../dist/index.js");

for (const name of [
  "createShadowAccount",
  "loadRuntimeConfig",
  "PaymasterSubmissionUnknownError",
]) {
  if (typeof api[name] !== "function") {
    throw new Error(`Package export ${name} is missing`);
  }
}

console.log("Package entrypoint imports without registry credentials.");
