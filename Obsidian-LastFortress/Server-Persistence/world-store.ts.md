---
id: file:packages/server/src/world-store.ts
type: file
tags: ["persistence", "world-state", "storage", "serialization"]
complexity: moderate
---

# world-store.ts

Abstraction layer for world state persistence supporting both PostgreSQL and in-memory storage. Serializes and deserializes game simulation state alongside player-device bindings for session resumption.

**Path:** `packages/server/src/world-store.ts`

## Related

- [[PgWorldStore]]
- [[MemoryWorldStore]]
- [[createWorldStore]]

