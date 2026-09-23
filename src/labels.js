// Which human label counts for each item.
//
// When the conditions a label was given under change — a clearer prompt, a labeling
// view that now shows which action is primary — the item is labeled again under a
// round tag: `case::question@r4`. The newest round supersedes every earlier label for
// the same `case::question`, so old answers given under the flawed conditions never
// mix with the new ones.

/** Split `case::question@r4` into its base id and round number (untagged = round 0). */
export function parseItemId(id) {
  const at = id.lastIndexOf('@r');
  if (at === -1) return { base: id, round: 0 };
  const round = Number(id.slice(at + 2));
  return Number.isInteger(round) ? { base: id.slice(0, at), round } : { base: id, round: 0 };
}

/** Keep only the latest-round label per base item. Input: [{ id, ...label }]. */
export function latestPerItem(labels) {
  const best = new Map();
  for (const label of labels) {
    const { base, round } = parseItemId(label.id);
    const current = best.get(base);
    if (!current || round > current.round) best.set(base, { round, label });
  }
  return [...best.values()].map((v) => v.label);
}
