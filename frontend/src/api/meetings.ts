import { apiRequest } from './client';

export interface MeetingDto {
  meetingId: string;
  topic: string;
  participantIds: string[];
  createdAt: number;
  messages: Array<{ messageId: string; qianjiId: string | null; speaker: string;
    content: string; promptTokens: number | null; completionTokens: number | null;
    costCny: number | null; createdAt: number }>;
}
export interface ApprovalDto {
  requestId: string; qianjiId: string | null; pixelId: string;
  capability: string; status: 'pending' | 'approved' | 'rejected';
  decisionReason: string | null; createdAt: number; decidedAt: number | null;
}
export async function listMeetings(): Promise<MeetingDto[]> {
  const result = await apiRequest<{ items: MeetingDto[] }>('/api/meetings');
  return result.items;
}
export async function createMeeting(topic: string, participantIds: string[]): Promise<MeetingDto> {
  return apiRequest('/api/meetings', { method: 'POST', body: JSON.stringify({ topic, participantIds }) });
}
export async function postMeetingMessage(meetingId: string, content: string): Promise<MeetingDto> {
  return apiRequest(`/api/meetings/${encodeURIComponent(meetingId)}/messages`, {
    method: 'POST', body: JSON.stringify({ content }),
  });
}
export async function listApprovals(): Promise<ApprovalDto[]> {
  const result = await apiRequest<{ items: ApprovalDto[] }>('/api/approvals');
  return result.items;
}
export async function decideApproval(requestId: string, decision: 'approved' | 'rejected'): Promise<void> {
  await apiRequest(`/api/approvals/${encodeURIComponent(requestId)}/decision`, {
    method: 'POST', body: JSON.stringify({ decision }),
  });
}
