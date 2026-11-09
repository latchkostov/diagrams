import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { fetchConfluenceViewer } from "../../tests/e2e/confluenceProxy";

it("limits the Confluence fixture proxy to its configured origin and never follows redirects", async () => {
  const requests: string[] = [];
  const listen = async (server: Server) => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  const close = (server: Server) =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  const outside = createServer((_req, res) => {
    requests.push("outside");
    res.end("outside");
  });
  const outsideURL = await listen(outside);
  const viewer = createServer((req, res) => {
    requests.push(req.url ?? "");
    if (req.url === "/redirect" || req.url === "/local-redirect") {
      res.writeHead(302, { Location: req.url === "/redirect" ? outsideURL : "/asset" });
      res.end();
    } else res.end("viewer asset");
  });
  try {
    const baseURL = await listen(viewer);
    expect(await (await fetchConfluenceViewer("/asset?version=1", baseURL)).text()).toBe("viewer asset");
    expect(await (await fetchConfluenceViewer(`${baseURL}/asset`, baseURL)).text()).toBe("viewer asset");
    for (const target of [outsideURL, outsideURL.replace("http:", ""), "https://example.invalid/asset"])
      await expect(fetchConfluenceViewer(target, baseURL)).rejects.toThrow("Viewer proxy origin mismatch");
    await expect(fetchConfluenceViewer("/redirect", baseURL)).rejects.toThrow();
    await expect(fetchConfluenceViewer("/local-redirect", baseURL)).rejects.toThrow();
    expect(requests).toEqual(["/asset?version=1", "/asset", "/redirect", "/local-redirect"]);
  } finally {
    await Promise.all([close(viewer), close(outside)]);
  }
});
