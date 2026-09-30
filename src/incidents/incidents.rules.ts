import type { IncidentStatus } from './incidents.types.js';

export function canTransitionIncidentStatus(
  currentStatus: IncidentStatus,
  nextStatus: IncidentStatus,
): boolean {
  if (currentStatus === nextStatus) {
    return true;
  }

  if (currentStatus === 'resolved') {
    return false;
  }

  const allowedTransitions: Record<IncidentStatus, IncidentStatus[]> = {
    investigating: ['mitigated', 'resolved'],
    mitigated: ['investigating', 'resolved'],
    open: ['investigating', 'mitigated', 'resolved'],
    resolved: [],
  };

  return allowedTransitions[currentStatus].includes(nextStatus);
}
