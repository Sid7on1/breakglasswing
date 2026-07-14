export async function runSchedule(graph, { limit, run }) {
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError('limit must be a positive integer');

  // BUG: this launches everything immediately, ignores dependencies, and returns completion order.
  const output = [];
  await Promise.all(graph.map(async node => {
    output.push(await run(node));
  }));
  return output;
}
