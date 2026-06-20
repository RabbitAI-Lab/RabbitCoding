export interface PetTask {
  id: string;
  title: string;
  output: string;
  status: 'running' | 'error' | 'completed';
}

export interface PetTasksPayload {
  tasks: PetTask[];
  updatedAt: number;
}
