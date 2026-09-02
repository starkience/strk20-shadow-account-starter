export function isAllowedWorkbenchHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export function hasWorkbenchRequestGuard(value: string | string[] | undefined): boolean {
  return value === "1";
}
