# Hindsight Explorer

Private, read-only browser explorer for the self-hosted Hindsight API.

- Public URL: <https://hindsight.crankingoutcode.com>
- Auth: public-edge Traefik forward-auth via Authentik on homeboy
- Runtime: backend-only Coolify app on the homelab Docker runtime
- Internal dataplane: `http://hindsight-memory:8888`
- Image: `ghcr.io/bjn/hindsight-control-plane:latest`
- Coolify app UUID: `e14gngz0zq8a3lqa9wm7ev0r`

## What it exposes

The browser can only call the local explorer proxy, not Hindsight directly. The proxy allowlist exposes:

- bank list
- bank stats
- bank tags
- recent memories
- recent documents
- recent operations
- recall/search

It deliberately does **not** expose raw Hindsight retain/write/delete/reprocess endpoints.

## Local development

```bash
export HINDSIGHT_API_URL=http://hindsight-memory:8888
npm test
npm run check
npm start
```

Open <http://127.0.0.1:9999>.

## Deployment

Pushing to `main` builds and pushes the image to GHCR, then triggers the existing Coolify app deployment. The app joins the external `coolify` network and the Hermes WebUI app network (`qqm82xixjk7y8k4qg57tbtb3`), where the Hindsight API is already attached with alias `hindsight-memory`. Docker-provider exposure is disabled with `traefik.enable=false`; public access is handled by explicit homeboy edge and homelab backend Traefik dynamic-file routes.
