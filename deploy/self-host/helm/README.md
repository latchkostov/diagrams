# Helm

Build a matching image first. Edit a copy of `values.yaml`, then:

```sh
helm lint deploy/self-host/helm
helm template diagrams deploy/self-host/helm -f my-values.yaml
pnpm self-host:image my-values.yaml
# Make the resulting image available to your cluster before installing:
helm upgrade --install diagrams deploy/self-host/helm -f my-values.yaml
```

Set image repository/tag, replicas, resources and ingress host/class/TLS/annotations. `build` records image
build settings as a pod annotation: it does not rebuild the image or inject runtime switches. Use Docker
`--build-arg` for the corresponding switches, brand, locales, path and framing origins. `build.basePath` also
sets the ingress path; keep it identical to image `BASE_PATH`. No controller, certificate issuer or SSO is
installed by the chart. See [the guide](../../../docs/SELF-HOSTING.md#kubernetes-and-helm).
