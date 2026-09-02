import { createReadStream } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { toPublicInvocationError } from "../src/lib/api-error";
import { loadPublicConfig, loadShadowConfig } from "../src/lib/config";
import { invokeShadowTransfer } from "../src/lib/invoke-shadow";
import { hasWorkbenchRequestGuard, isAllowedWorkbenchHost } from "./workbench-security";
import { parseWorkbenchRecipeOptions } from "./recipe-options";

const publicDir = resolve(import.meta.dirname, "../public");
const port = Number(process.env.PORT || "3000");
const recipe = parseWorkbenchRecipeOptions(process.argv.slice(2));
let active = false;

const assets = new Map<string, readonly [string, string]>([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
] as const);

const server = createServer(async (request, response) => {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  response.setHeader("cache-control", "no-store");
  try {
    if (!isAllowedWorkbenchHost(request.headers.host, port)) {
      return json(response, 403, { error: "Invalid workbench host." });
    }

    if (request.method === "GET" && request.url === "/api/config") {
      const config = loadPublicConfig(recipe);
      return json(response, 200, {
        appName: config.appName,
        nonce: config.nonce.toString(),
        anonymizer: config.anonymizerAddress,
        configured: [
          "ACCOUNT_ADDRESS",
          "ACCOUNT_PRIVATE_KEY",
          "STARKSCAN_API_KEY",
          "AVNU_PAYMASTER_API_KEY",
        ].every((name) => Boolean(process.env[name]?.trim())) && Boolean(recipe.recipientAddress),
      });
    }

    if (request.method === "POST" && request.url === "/api/invoke") {
      if (!hasWorkbenchRequestGuard(request.headers["x-shadow-workbench"])) {
        return json(response, 403, { ok: false, error: "Missing workbench request guard." });
      }
      if (active) return json(response, 409, { ok: false, error: "An invocation is already running." });
      active = true;
      try {
        if (!recipe.recipientAddress) {
          throw new Error("Restart with --recipient 0x... to configure the transfer recipe");
        }
        const result = await invokeShadowTransfer(loadShadowConfig({
          ...recipe,
          recipientAddress: recipe.recipientAddress,
        }));
        return json(response, 200, { ok: true, result });
      } catch (error) {
        const publicError = toPublicInvocationError(error);
        console.error(`Shadow invocation failed (${publicError.code})`);
        return json(response, 500, { ok: false, error: publicError });
      } finally {
        active = false;
      }
    }

    if (request.method === "GET" && request.url && assets.has(request.url)) {
      const [file, contentType] = assets.get(request.url)!;
      response.writeHead(200, { "content-type": contentType });
      createReadStream(resolve(publicDir, file)).pipe(response);
      return;
    }

    json(response, 404, { error: "Not found" });
  } catch (error) {
    console.error(`Workbench request failed (${error instanceof Error ? error.name : "unknown"})`);
    json(response, 500, { error: "Workbench request failed. Check the trusted server." });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`\nShadow workbench: http://127.0.0.1:${port}`);
  console.log("Keys remain in this local Node process; they are never sent to the page.\n");
});

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
