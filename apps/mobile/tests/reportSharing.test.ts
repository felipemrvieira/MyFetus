import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getReportSharingError,
  reportFileName,
  REPORT_SHARE_GENERIC_ERROR,
  REPORT_SHARE_UNAVAILABLE_ERROR,
} from '../utils/reportSharing';

describe('compartilhamento do relatório da gestação', () => {
  test('gera nome de arquivo sem dados pessoais', () => {
    assert.equal(reportFileName(42), 'myfetus-relatorio-gestacao-42.pdf');
  });

  test('mapeia indisponibilidade, sessão, limite e conexão', () => {
    assert.equal(getReportSharingError(503), REPORT_SHARE_GENERIC_ERROR);
    assert.equal(getReportSharingError(503, 'share_unavailable'), REPORT_SHARE_UNAVAILABLE_ERROR);
    assert.match(getReportSharingError(401), /sessão expirou/);
    assert.match(getReportSharingError(429), /Muitas solicitações/);
    assert.match(getReportSharingError(null), /Sem conexão/);
  });
});
