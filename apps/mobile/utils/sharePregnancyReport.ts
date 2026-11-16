import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { api } from './apiClient';
import { apiUrl, fetchWithAuth } from './api';
import { notifyUnauthorized } from './authEvents';
import { getStoredToken } from './sessionStorage';
import {
  getReportSharingError,
  reportFileName,
  REPORT_SHARE_GENERIC_ERROR,
  REPORT_SHARE_UNAVAILABLE_ERROR,
} from './reportSharing';

export { getReportSharingError, reportFileName, REPORT_SHARE_GENERIC_ERROR, REPORT_SHARE_UNAVAILABLE_ERROR };

function validatePregnancyId(pregnancyId: number): void {
  if (!Number.isInteger(pregnancyId) || pregnancyId <= 0) {
    throw new Error(REPORT_SHARE_GENERIC_ERROR);
  }
}

async function recordShareResult(pregnancyId: number, outcome: 'SUCCESS' | 'FAILURE', reason?: string): Promise<void> {
  try {
    await api.post(`/reports/pregnancies/${pregnancyId}/share`, {
      outcome,
      ...(reason ? { reason } : {}),
    });
  } catch {
    // A falha de auditoria não deve expor o PDF nem substituir a mensagem da operação.
  }
}

async function shareOnWeb(pregnancyId: number): Promise<void> {
  const response = await fetchWithAuth(apiUrl(`/api/reports/pregnancies/${pregnancyId}/pdf`));
  if (!response.ok) {
    await recordShareResult(pregnancyId, 'FAILURE', 'download_failed');
    throw new Error(getReportSharingError(response.status));
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = reportFileName(pregnancyId);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
  await recordShareResult(pregnancyId, 'SUCCESS');
}

export async function sharePregnancyReport(pregnancyId: number): Promise<void> {
  validatePregnancyId(pregnancyId);
  if (Platform.OS === 'web') {
    await shareOnWeb(pregnancyId);
    return;
  }

  if (!FileSystem.cacheDirectory) {
    await recordShareResult(pregnancyId, 'FAILURE', 'download_failed');
    throw new Error('Armazenamento temporário indisponível.');
  }
  if (!(await Sharing.isAvailableAsync())) {
    await recordShareResult(pregnancyId, 'FAILURE', 'share_unavailable');
    throw new Error(REPORT_SHARE_UNAVAILABLE_ERROR);
  }

  const token = await getStoredToken();
  if (!token) {
    throw new Error('Sua sessão expirou. Entre novamente.');
  }

  const fileUri = `${FileSystem.cacheDirectory}${Date.now()}-${reportFileName(pregnancyId)}`;
  try {
    const result = await FileSystem.downloadAsync(
      apiUrl(`/api/reports/pregnancies/${pregnancyId}/pdf`),
      fileUri,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (result.status === 401) {
      notifyUnauthorized();
      await recordShareResult(pregnancyId, 'FAILURE', 'download_failed');
      throw new Error(getReportSharingError(401));
    }
    if (result.status < 200 || result.status >= 300) {
      await recordShareResult(pregnancyId, 'FAILURE', 'download_failed');
      throw new Error(getReportSharingError(result.status));
    }

    try {
      await Sharing.shareAsync(result.uri, {
        dialogTitle: 'Compartilhar relatório da gestação',
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
      });
      await recordShareResult(pregnancyId, 'SUCCESS');
    } catch (error) {
      await recordShareResult(pregnancyId, 'FAILURE', 'share_failed');
      throw error;
    }
  } finally {
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
  }
}
