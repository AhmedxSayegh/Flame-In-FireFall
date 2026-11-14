/**
 * Similarities and differences for a custom selection of experiments in the comparison table.
 * Used only when the selection is not exactly one investigation's top set; otherwise the
 * table shows the backend's own top_experiments_comparison text.
 */
export function compareRows(ids: string[], rows: { attribute: string; values: Record<string, string> }[]) {
  const similarities: string[] = [], differences: string[] = [];
  for (const r of rows) {
    if (['Test ID(s)', 'Relevance'].includes(r.attribute)) continue;
    const vals = ids.map((id) => r.values[id] ?? 'N/A');
    if (vals.every((v) => v === 'N/A')) continue;
    if (vals.every((v) => v === vals[0])) similarities.push(`${r.attribute}: ${vals[0]} for all.`);
    else differences.push(`${r.attribute}: ${vals.join(' vs ')}.`);
  }
  return { similarities, differences };
}
