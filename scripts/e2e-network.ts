/** Only Vite's own same-origin development handshake is infrastructure traffic. */
export function isViteHmrHandshake(socket: string, base: string, payload: string, target: string): boolean {
  if (target !== "dev") return false;
  const url = new URL(socket),
    app = new URL(base);
  if (url.host !== app.host || url.pathname !== "/" || !url.searchParams.has("token")) return false;
  if (url.protocol !== (app.protocol === "https:" ? "wss:" : "ws:")) return false;
  try {
    return (JSON.parse(payload) as { type?: string }).type === "connected";
  } catch {
    return false;
  }
}
