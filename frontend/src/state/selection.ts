import type { RankedInvestigation, TopExperiment } from '../types';

export interface WorkspaceSelection {
  investigationId: string | null;
  activeId: string | null;
  compareIds: string[];
}

/** One shared, rank-ordered experiment scope for every workspace control. */
export function experimentsForInvestigation(ranked: RankedInvestigation[], investigationId: string | null) {
  return [...(ranked.find(inv => inv.psi_id === investigationId)?.top_experiments ?? [])]
    .sort((a, b) => a.rank - b.rank);
}

export function validComparisonIds(ids: string[], experiments: TopExperiment[]) {
  const allowed = new Set(experiments.map(exp => exp.experiment_id));
  return [...new Set(ids.filter(id => allowed.has(id)))].slice(0, 3);
}

export function selectWorkspace(ranked: RankedInvestigation[], investigationId: string | null,
  previous: Pick<WorkspaceSelection, 'activeId' | 'compareIds'> = { activeId: null, compareIds: [] }): WorkspaceSelection {
  const investigation = ranked.find(inv => inv.psi_id === investigationId);
  const experiments = experimentsForInvestigation(ranked, investigationId);
  const ids = experiments.map(exp => exp.experiment_id);
  const compareIds = validComparisonIds(previous.compareIds, experiments);
  for (const id of ids) {
    if (compareIds.length >= 3) break;
    if (!compareIds.includes(id)) compareIds.push(id);
  }
  return {
    investigationId: investigation?.psi_id ?? null,
    activeId: previous.activeId && ids.includes(previous.activeId) ? previous.activeId : ids[0] ?? null,
    compareIds,
  };
}
