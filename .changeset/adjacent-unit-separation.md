"@scorched-3d/core": patch
"@scorched-3d/web": patch
---

Adjacent units no longer deadlock inside each other's spacing stop: movers now shove apart with lateral separation steering (radial push plus a sidestep so head-on crossings pass instead of backing up into each other), ordered hulls keep a minimum drive fraction through crowds so orders stay alive to arrival, and group move orders snap formation slots onto walkable ground with a separation guarantee. Explosion scorch stays purely visual — it never alters heights or walkability.
