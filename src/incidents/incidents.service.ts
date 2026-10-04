import { ValidationError } from '../errors/validation-error.js';
import type { IncidentRepository } from './incidents.repository.js';
import { canTransitionIncidentStatus } from './incidents.rules.js';
import type {
  CreateIncidentInput,
  EvidenceInput,
  HypothesisConfidenceAdjustmentInput,
  HypothesisInput,
  IncidentResponse,
  TimelineInput,
  UpdateIncidentInput,
} from './incidents.types.js';

export class IncidentService {
  constructor(private readonly repository: IncidentRepository) {}

  create(input: CreateIncidentInput): Promise<IncidentResponse> {
    return this.repository.create(input);
  }

  list(): Promise<IncidentResponse[]> {
    return this.repository.list();
  }

  findById(incidentId: string): Promise<IncidentResponse | undefined> {
    return this.repository.findById(incidentId);
  }

  async update(
    incidentId: string,
    input: UpdateIncidentInput,
  ): Promise<IncidentResponse | undefined> {
    const current = await this.repository.findById(incidentId);

    if (!current) {
      return undefined;
    }

    const nextStatus = input.status ?? current.status;

    if (!canTransitionIncidentStatus(current.status, nextStatus)) {
      throw new ValidationError(`Incident cannot move from ${current.status} to ${nextStatus}`);
    }

    if (nextStatus === 'resolved') {
      if (!input.rootCause && !current.rootCause) {
        throw new ValidationError('rootCause is required when resolving an incident');
      }

      if (!input.preventiveActions && !current.preventiveActions) {
        throw new ValidationError('preventiveActions is required when resolving an incident');
      }
    }

    return this.repository.updateExisting(incidentId, input, current);
  }

  addEvidence(incidentId: string, input: EvidenceInput): Promise<IncidentResponse | undefined> {
    return this.repository.addEvidence(incidentId, input);
  }

  addHypothesis(incidentId: string, input: HypothesisInput): Promise<IncidentResponse | undefined> {
    return this.repository.addHypothesis(incidentId, input);
  }

  adjustHypothesisConfidence(
    incidentId: string,
    hypothesisId: string,
    input: HypothesisConfidenceAdjustmentInput,
  ): Promise<IncidentResponse | undefined> {
    return this.repository.adjustHypothesisConfidence(incidentId, hypothesisId, input);
  }

  addTimelineEvent(
    incidentId: string,
    input: TimelineInput,
  ): Promise<IncidentResponse | undefined> {
    return this.repository.addTimelineEvent(incidentId, input);
  }
}
