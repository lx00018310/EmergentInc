import { apiRequest } from './client';
import type {
  PixelDocumentResponseDto,
  PixelArtifactsResponseDto,
  PixelArtifactResponseDto,
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

export async function fetchPixelArtifact(
  pixelId: string,
  filename: string,
  signal?: AbortSignal
): Promise<PixelArtifactResponseDto> {
  const encId = encodeURIComponent(pixelId);
  const encFilename = encodeURIComponent(filename);
  return apiRequest<PixelArtifactResponseDto>(`/api/pixels/${encId}/artifacts/${encFilename}`, { signal });
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
