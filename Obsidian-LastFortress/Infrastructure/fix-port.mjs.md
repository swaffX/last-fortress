---
id: file:scripts/fix-port.mjs
type: file
tags: ["entry-point", "troubleshooting", "infrastructure", "script", "devops"]
complexity: moderate
---

# fix-port.mjs

Troubleshooting utility that identifies processes holding port 80, removes orphaned Docker containers and competing web servers (nginx, apache2), restarts the Docker Compose stack, and verifies HTTP availability.

**Path:** `scripts/fix-port.mjs`

