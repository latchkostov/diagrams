export interface SimulationMetadata {
  id: string;
  title: string;
  description?: string;
  deadLetter: boolean;
}

// Kept in the Lab chunk; timelines, traffic and expectations stay in the example chunks.
export const labMetadata: Record<string, SimulationMetadata[]> = {};
