/**
 * Stable bridge to the vendored, exactly pinned Privacy SDK build.
 *
 * Keeping this relative makes packed and Git-installed starter artifacts
 * independent of StarkWare's access-controlled package registry.
 */
export * from "../vendor/privacy-sdk/dist/index.js";
