import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import console from "node:console";
import { parseAllDocuments } from "yaml";

const template = (...settings) => {
  const result = spawnSync(
    "helm",
    [
      "template",
      "diagrams",
      "deploy/self-host/helm",
      "--set",
      "ingress.enabled=true",
      "--set",
      "ingress.tls.enabled=true",
      ...settings.flatMap((setting) => ["--set-string", setting]),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout.replaceAll("\r\n", "\n");
};
const resources = (output) => Object.fromEntries(parseAllDocuments(output).map((doc) => [doc.toJS().kind, doc.toJS()]));

// Frozen pre-S5 rendering: the default static deployment remains byte-for-byte identical.
const original = template();
assert.equal(
  createHash("sha256").update(original).digest("hex"),
  "68a958f978d0a9e0b5be94ef107bf3f39cc4d1d7113b18a537e8f30b13be1c6c",
);
assert.equal(template("mode=static"), original);
const staticDeployment = resources(template("replicas=4", "image.tag=custom")).Deployment;
assert.equal(staticDeployment.spec.replicas, 4);
assert.equal(staticDeployment.spec.template.spec.containers[0].image, "live-diagrams:custom");

for (const base of ["/", "/tools/diagrams/"]) {
  const { Deployment: deployment, Ingress: ingress } = resources(
    template(
      "mode=server",
      "replicas=4",
      `build.basePath=${base}`,
      "server.image.repository=registry.example.com/relay",
      "server.image.tag=release",
      "server.env.LD_ORIGIN=https://diagrams.example.com",
      "server.env.LD_TRUST_PROXY=1",
      "server.env.LD_TRUST_PROXY_HOPS=2",
      "server.env.LD_ROOM_CAP=12",
      "server.env.LD_SOCKETS_PER_IP=16",
      "server.env.LD_METRICS=1",
    ),
  );
  assert.equal(deployment.spec.replicas, 1);
  assert.deepEqual(deployment.spec.strategy, { type: "Recreate" });
  const metadata = JSON.parse(deployment.spec.template.metadata.annotations["livediagrams.dev/build"]);
  assert.equal(metadata.switches.VITE_COLLAB, "server");
  assert.equal(metadata.switches.VITE_COLLAB_SERVER, "");
  assert.equal(metadata.switches.VITE_COLLAB_TURN_CREDENTIAL, undefined);
  const pod = deployment.spec.template.spec;
  assert.equal(pod.securityContext.runAsUser, 65532);
  const container = pod.containers[0];
  assert.equal(container.image, "registry.example.com/relay:release");
  assert.deepEqual(container.securityContext, {
    allowPrivilegeEscalation: false,
    readOnlyRootFilesystem: true,
    capabilities: { drop: ["ALL"] },
  });
  const env = Object.fromEntries(container.env.map(({ name, value }) => [name, value]));
  assert.deepEqual(env, {
    LD_BASE: base,
    LD_HOST: "0.0.0.0",
    LD_PORT: "8080",
    LD_STATIC_DIR: "/app/site",
    LD_ORIGIN: "https://diagrams.example.com",
    LD_TRUST_PROXY: "1",
    LD_TRUST_PROXY_HOPS: "2",
    LD_ROOM_CAP: "12",
    LD_SOCKETS_PER_IP: "16",
    LD_METRICS: "1",
  });
  assert.deepEqual(container.readinessProbe.httpGet, { path: "/readyz", port: "http" });
  assert.deepEqual(container.livenessProbe.httpGet, { path: "/healthz", port: "http" });
  assert.equal(pod.volumes, undefined);
  assert.equal(container.volumeMounts, undefined);
  for (const direction of ["read", "send"])
    assert.equal(ingress.metadata.annotations[`nginx.ingress.kubernetes.io/proxy-${direction}-timeout`], "3600");
  assert.equal(ingress.spec.rules[0].http.paths[0].path, base);
  assert.equal(ingress.spec.tls[0].secretName, "live-diagrams-tls");
}
console.log("PASS Helm static byte parity and server image, singleton, Recreate, env, probes, hardening and ingress");
