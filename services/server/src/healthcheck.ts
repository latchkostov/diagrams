/** Distroless has no shell or HTTP utility. Probe the listener without loading static files. */
export async function healthcheck(port: number, host = "0.0.0.0"): Promise<boolean> {
  const address = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  const authority = address.includes(":") ? `[${address}]` : address;
  try {
    const response = await fetch(`http://${authority}:${port}/healthz`, {
      signal: AbortSignal.timeout(2_000),
      redirect: "error",
    });
    await response.arrayBuffer();
    return response.status === 200;
  } catch {
    return false;
  }
}
