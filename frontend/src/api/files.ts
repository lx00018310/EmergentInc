import { apiRequest } from './client';
import type {
  PixelDocumentResponseDto,
  PixelArtifactsResponseDto,
  PrivateFilesResponseDto,
} from './types';

export async function fetchPixelDocument(
  pixelId: string,
  docName: string,
  signal?: AbortSignal
): Promise<PixelDocumentResponseDto> {
  const encId = encodeURIComponent(pixelId);
  const encDoc = encodeURIComponent(docName);
  return apiRequest<PixelDocumentResponseDto>(`/api/pixels/${encId}/document/${encDoc}`, { signal });
}

export async function fetchPixelArtifacts(
  pixelId: string,
  signal?: AbortSignal
): Promise<PixelArtifactsResponseDto> {
  const encId = encodeURIComponent(pixelId);
  return apiRequest<PixelArtifactsResponseDto>(`/api/pixels/${encId}/artifacts`, { signal });
}

export async function fetchPrivateFiles(
  subPath = '',
  signal?: AbortSignal
): Promise<PrivateFilesResponseDto> {
  const query = subPath ? `?path=${encodeURIComponent(subPath)}` : '';
  return apiRequest<PrivateFilesResponseDto>(`/api/private-files${query}`, { signal });
}

export function getArtifactDownloadUrl(pixelId: string, filename: string): string {
  return `/api/pixels/${encodeURIComponent(pixelId)}/artifacts/${encodeURIComponent(filename)}/download`;
}

export function getPrivateImagePreviewUrl(path: string): string {
  return `/api/private-files/preview?path=${encodeURIComponent(path)}`;
}
