import { NotFoundError } from '../errors/not-found-error.js';
import type { IncidentRepository } from './incidents.repository.js';
import type {
  CreateIncidentInput,
  EvidenceInput,
  HypothesisConfidenceAdjustmentInput,
  HypothesisInput,
  IncidentListInput,
  IncidentListResponse,
  IncidentResponse,
  TimelineInput,
  UpdateIncidentInput,
} from './incidents.types.js';

export class IncidentService {
  constructor(private readonly repository: IncidentRepository) {}

  create(input: CreateIncidentInput): Promise<IncidentResponse> {
    return this.repository.create(input);
  }

  list(input: IncidentListInput): Promise<IncidentListResponse> {
    return this.repository.list(input);
  }

  async findById(incidentId: string): Promise<IncidentResponse> {
    const incident = await this.repository.findById(incidentId);

    if (!incident) {
      throw new NotFoundError('Incident not found');
    }

    return incident;
  }

  async update(
    incidentId: string,
    input: UpdateIncidentInput,
  ): Promise<IncidentResponse | undefined> {
    return this.repository.update(incidentId, input);
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
