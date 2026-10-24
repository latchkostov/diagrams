/** `n` Deployments, each with its Service in one of 20 namespaces, each calling the next one by its host. */
export const kubernetesChain = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `---
apiVersion: apps/v1
kind: Deployment
metadata: { name: svc-${i}, namespace: ns-${i % 20} }
spec:
  template:
    metadata: { labels: { app: svc-${i} } }
    spec: { containers: [{ name: a, image: example/a, env: [{ name: NEXT_URL, value: "http://svc-${(i + 1) % n}.ns-${(i + 1) % 20}" }] }] }
---
apiVersion: v1
kind: Service
metadata: { name: svc-${i}, namespace: ns-${i % 20} }
spec: { selector: { app: svc-${i} } }
`,
  ).join("");
