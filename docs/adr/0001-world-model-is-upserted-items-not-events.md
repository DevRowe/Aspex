# World-model is current-state Items, not an event stream

The plan's core contract is named `AttentionEvent`, but it conflates a persistent work item with a current state (a PR awaiting review) and a discrete event (a hook firing). We model the world-model as a set of persistent **Items** keyed by a stable source-derived id (e.g. `github:pr:owner/repo#42`). Each poll result or hook POST is a **Signal** that upserts the matching Item in place; the client ranks and renders Items by current state.

We chose this over event-sourcing (an append-only log folded into state) because it makes polling idempotent, gives each Item a natural place to carry per-item liveness decay, and yields a stable id for actions — all with far fewer moving parts for a less-capable implementer. The cost is no built-in audit/replay history; if we need it later we add a raw Signals log as a second concern (the rejected "hybrid"), without changing the Item model the UI depends on.
