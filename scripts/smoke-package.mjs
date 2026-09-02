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
delete environment.NPM_CONFIG_USERCONFIG;
delete environment.npm_config_userconfig;
environment.NPM_CONFIG_REGISTRY = "https://registry.npmjs.org/";

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
  execFileSync("pnpm", ["add", "--ignore-scripts", archive], {
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
        '  "PaymasterSubmissionUnknownError",',
        '  "StarkscanProofProvider",',
        '  "toPublicInvocationError",',
        "]) {",
        '  if (typeof api[name] !== "function") throw new Error(`Missing ${name}`);',
        "}",
        'if (api.parseUnits("5", api.STRK_DECIMALS) !== 5_000_000_000_000_000_000n) {',
        '  throw new Error("Packed bigint amount helpers are invalid");',
        "}",
        "const shadow = api.createShadowAccount({",
        "  credentials: {",
        '    accountAddress: "0x1", accountPrivateKey: "0x2", viewingKey: 3n,',
        '    starkscanApiKey: "prover-test", avnuPaymasterApiKey: "paymaster-test",',
        "  },",
        '  appName: "smoke", nonce: 0n,',
        "});",
        'if (typeof shadow.shield !== "function") throw new Error("Missing shield method");',
      ].join("\n"),
    ],
    { cwd: temporaryProject, env: environment, stdio: "pipe" },
  );

  writeFileSync(
    join(temporaryProject, "consumer.ts"),
    [
      'import { createShadowAccount, parseUnits, STRK_DECIMALS, toPublicInvocationError, type PublicInvocationErrorCode, type ShieldResult } from "strk20-shadow-account-starter";',
      'const code: PublicInvocationErrorCode = "INVOCATION_FAILED";',
      "const shadow = createShadowAccount();",
      'const shielding: Promise<ShieldResult> = shadow.shield(parseUnits("5", STRK_DECIMALS));',
      "const invocation = shadow.invoke({",
      '  calls: [{ contractAddress: "0x1", entrypoint: "join", calldata: ["0x1"] }],',
      "  fundingAmount: 0n,",
      "  verifyEffect: async ({ provider, shadowAddress }) => {",
      "    await provider.getClassHashAt(shadowAddress);",
      "  },",
      "});",
      "void shielding;",
      "void invocation;",
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

  console.log(
    "Packed artifact installs without private-registry credentials and exposes its runtime and type entrypoints.",
  );
} finally {
  rmSync(temporaryProject, { recursive: true, force: true });
}
