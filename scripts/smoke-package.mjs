import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryProject = mkdtempSync(join(tmpdir(), "shadow-package-smoke-"));
const environment = { ...process.env, LANG: "C", LC_ALL: "C" };
delete environment.NODE_AUTH_TOKEN;
delete environment.NPM_TOKEN;
delete environment.GITHUB_TOKEN;
delete environment.GH_TOKEN;

try {
  execFileSync("pnpm", ["pack", "--pack-destination", temporaryProject], {
    cwd: repository,
    env: environment,
    stdio: "pipe",
  });
  const archives = readdirSync(temporaryProject).filter((name) => name.endsWith(".tgz"));
  if (archives.length !== 1 || !archives[0]) {
    throw new Error(`Expected one package archive, found ${archives.length}`);
  }
  const archive = join(temporaryProject, archives[0]);
  const contents = execFileSync("tar", ["-tzf", archive], {
    encoding: "utf8",
    env: environment,
  })
    .trim()
    .split("\n");
  for (const required of [
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/vendor/privacy-sdk/dist/index.js",
    "package/compatibility.json",
  ]) {
    if (!contents.includes(required)) throw new Error(`Packed artifact is missing ${required}`);
  }
  const forbidden = contents.find((name) =>
    /^package\/(?:\.env(?:\.|$)|public\/|scripts\/|src\/|tests\/)/.test(name),
  );
  if (forbidden) throw new Error(`Packed artifact unexpectedly contains ${forbidden}`);

  writeFileSync(
    join(temporaryProject, "package.json"),
    JSON.stringify({ name: "shadow-package-consumer", private: true, type: "module" }),
  );
  execFileSync("pnpm", ["add", "--offline", "--ignore-scripts", archive], {
    cwd: temporaryProject,
    env: environment,
    stdio: "pipe",
  });
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        'const api = await import("strk20-shadow-account-starter");',
        "for (const name of [",
        '  "createShadowAccount",',
        '  "loadRuntimeConfig",',
        '  "PaymasterSubmissionUnknownError",',
        '  "toPublicInvocationError",',
        "]) {",
        '  if (typeof api[name] !== "function") throw new Error(`Missing ${name}`);',
        "}",
      ].join("\n"),
    ],
    { cwd: temporaryProject, env: environment, stdio: "pipe" },
  );

  writeFileSync(
    join(temporaryProject, "consumer.ts"),
    [
      'import { createShadowAccount, toPublicInvocationError, type PublicInvocationErrorCode } from "strk20-shadow-account-starter";',
      'const code: PublicInvocationErrorCode = "INVOCATION_FAILED";',
      "void createShadowAccount;",
      "void toPublicInvocationError;",
      "void code;",
    ].join("\n"),
  );
  execFileSync(
    join(repository, "node_modules", ".bin", "tsc"),
    [
      "--noEmit",
      "--skipLibCheck",
      "--target",
      "ES2023",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      join(temporaryProject, "consumer.ts"),
    ],
    { cwd: temporaryProject, env: environment, stdio: "pipe" },
  );

  console.log("Packed artifact installs offline and exposes its runtime and type entrypoints.");
} finally {
  rmSync(temporaryProject, { recursive: true, force: true });
}
