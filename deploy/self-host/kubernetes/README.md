# Kubernetes

Build the root Dockerfile, tag/load the image into your cluster or private registry, and change the image in
`manifest.yaml`. Apply with `kubectl apply -f deploy/self-host/kubernetes/manifest.yaml`.
It provides a Deployment, Service, non-root/read-only pods, temporary volume, probes and resource limits.

`ingress.example.yaml` is optional: set your host, controller class, TLS secret and issuer before applying.
Install the ingress controller/cert-manager separately. A sub-path image needs the same ingress prefix without
rewriting it. Configure SSO at your ingress/proxy and keep secrets in your existing secret store.
See [the guide](../../../docs/SELF-HOSTING.md#kubernetes-and-helm).
