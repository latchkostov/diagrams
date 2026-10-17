import { createServer, connect } from "node:net";
import { setTimeout } from "node:timers/promises";
import { lockPort, validatePorts } from "./logic.mjs";

const close = (server) =>
  new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
const listen = (server, port, host) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ port, host, exclusive: true, ipv6Only: host === "::1" }, () => {
      server.off("error", reject);
      resolve();
    });
  });

export async function probePorts(base) {
  validatePorts(base);
  const servers = [];
  try {
    for (let port = base; port < base + 5; port++)
      for (const host of ["127.0.0.1", "::1"]) {
        const server = createServer();
        try {
          await listen(server, port, host);
          servers.push(server);
        } catch (error) {
          if (host === "::1" && ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(error.code)) continue;
          throw new Error(
            `Port ${port} on ${host} is unavailable (${error.code}). Stop its server or use --ports <base>.`,
            { cause: error },
          );
        }
      }
  } finally {
    await Promise.all(servers.map(close));
  }
  return base;
}

export async function pickPorts(probe = probePorts) {
  for (let base = 6400; base <= 6995; base += 5) {
    try {
      return await probe(base);
    } catch {
      /* Try the next whole range. */
    }
  }
  throw new Error("No free five-port range in 6400–6999. Stop servers or use --ports <base>.");
}

/** The kernel owns this lock: process death releases it, on Windows, macOS and Linux. */
export async function acquireLock(common, platform, waiting = () => {}, port = lockPort(common, platform), signal) {
  let announced = false;
  for (;;) {
    signal?.throwIfAborted();
    const clients = new Set();
    const server = createServer((socket) => {
      clients.add(socket);
      socket.once("close", () => clients.delete(socket));
      socket.on("error", () => {});
    });
    try {
      await listen(server, port, "127.0.0.1");
      const address = server.address();
      return Object.assign(
        async () => {
          for (const client of clients) client.destroy();
          await close(server);
        },
        { port: address.port },
      );
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
      if (!announced) {
        waiting();
        announced = true;
      }
      await new Promise((resolve) => {
        const socket = connect({ port, host: "127.0.0.1" });
        const abort = () => socket.destroy();
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) socket.destroy();
        socket.on("error", () => {});
        socket.once("close", () => {
          signal?.removeEventListener("abort", abort);
          resolve();
        });
        socket.resume();
      });
      // Allow another waiter's bind to finish before retrying a connection refused in between.
      await setTimeout(25);
    }
  }
}
