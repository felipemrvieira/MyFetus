export const REPORT_SHARE_GENERIC_ERROR = 'Não foi possível compartilhar o relatório agora. Tente novamente.';
export const REPORT_SHARE_UNAVAILABLE_ERROR = 'Não há aplicativo disponível para compartilhar o relatório.';

export function reportFileName(pregnancyId: number): string {
  return `myfetus-relatorio-gestacao-${pregnancyId}.pdf`;
}

export function getReportSharingError(status: number | null, reason?: string): string {
  if (reason === 'share_unavailable') return REPORT_SHARE_UNAVAILABLE_ERROR;
  if (status === 401) return 'Sua sessão expirou. Entre novamente.';
  if (status === 404) return 'Não encontramos uma gestação para gerar o relatório.';
  if (status === 429) return 'Muitas solicitações. Aguarde alguns minutos e tente novamente.';
  if (status === null) return 'Sem conexão com o servidor. Verifique a internet e tente novamente.';
  return REPORT_SHARE_GENERIC_ERROR;
}
