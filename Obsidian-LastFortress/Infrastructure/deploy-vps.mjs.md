---
id: file:scripts/deploy-vps.mjs
type: file
tags: ["entry-point", "deployment", "infrastructure", "script", "devops"]
complexity: moderate
---

# deploy-vps.mjs

One-shot VPS deployer that establishes SSH connection with environment-provided credentials, installs Docker if needed, clones or updates the game repository, generates secure environment secrets, and brings up the full Docker Compose stack on remote server.

**Path:** `scripts/deploy-vps.mjs`

