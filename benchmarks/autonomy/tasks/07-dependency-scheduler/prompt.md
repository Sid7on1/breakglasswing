Repair `runSchedule(graph, { limit, run })` in `src/scheduler.mjs` without changing its export or
adding dependencies.

Contract:

- `graph` is an array of unique `{ id, deps }` nodes. `deps` contains node IDs that must finish
  successfully before that node starts.
- Validate the entire graph before invoking `run`: duplicate IDs, a missing dependency, or a cycle
  must reject with a useful message containing respectively `Duplicate node`, `Missing dependency`,
  or `Dependency cycle detected`.
- `limit` must be a positive integer. No more than `limit` calls to `run(node)` may be active at once.
- Start every ready node as soon as capacity exists, but never before all its dependencies finish.
  Independent nodes should run concurrently.
- Resolve to an array of returned values in the original graph order, regardless of completion order.
- Reject on the first job failure and do not launch new work afterward.
- Do not mutate the graph, dependency arrays, or node objects.

Run `npm test` after the change.
