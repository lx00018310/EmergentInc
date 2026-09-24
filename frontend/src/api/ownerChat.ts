import { apiRequest } from './client';

export interface OwnerChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface OwnerChatAnswer {
  answer: string;
  sources: string[];
  as_of: string;
  usage: { tokens: number | null; cost_cny: number | null };
}

export function askOwner(question: string, history: OwnerChatTurn[]): Promise<OwnerChatAnswer> {
  return apiRequest<OwnerChatAnswer>('owner/chat', {
    method: 'POST',
    body: JSON.stringify({ question, history }),
    timeoutMs: 2 * 60 * 60 * 1000,
  });
}
