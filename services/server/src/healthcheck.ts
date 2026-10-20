/** Distroless has no shell or HTTP utility. Probe the listener without loading static files. */
export async function healthcheck(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
      signal: AbortSignal.timeout(2_000),
      redirect: "error",
    });
    await response.arrayBuffer();
    return response.status === 200;
  } catch {
    return false;
  }
}
