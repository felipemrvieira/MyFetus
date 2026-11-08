import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ChatCitacao } from '../utils/chatApi';
import {
  canOpenSource,
  citationAccessibilityLabel,
  citationLocation,
  citationTitle,
  sourcesToggleLabel,
} from '../utils/chatCitations';

function citation(overrides: Partial<ChatCitacao> = {}): ChatCitacao {
  return {
    numero: 1,
    documento_id: 'caderneta-gestante-ms-2026',
    titulo: 'Caderneta brasileira da gestante',
    emissor: 'Ministério da Saúde',
    edicao: '1ª edição',
    ano: 2026,
    pagina: 12,
    secao: 'sinais de alerta',
    trecho: 'Procure a maternidade se houver sangramento.',
    url: 'https://www.gov.br/saude/caderneta.pdf',
    ...overrides,
  };
}

describe('fontes do chat', () => {
  it('rótulo do botão no singular e no plural', () => {
    assert.equal(sourcesToggleLabel(1, false), 'Ver 1 fonte');
    assert.equal(sourcesToggleLabel(3, false), 'Ver 3 fontes');
    assert.equal(sourcesToggleLabel(3, true), 'Ocultar 3 fontes');
  });

  it('identifica o documento com órgão, edição e ano', () => {
    assert.equal(citationTitle(citation()), 'Caderneta brasileira da gestante — Ministério da Saúde, 1ª edição, 2026');
    assert.equal(citationTitle(citation({ emissor: null, edicao: null, ano: null })), 'Caderneta brasileira da gestante');
  });

  it('mostra a página só quando existe', () => {
    assert.equal(citationLocation(citation()), 'p. 12 · sinais de alerta');
    assert.equal(citationLocation(citation({ pagina: null })), 'sinais de alerta');
    assert.equal(citationLocation(citation({ pagina: null, secao: null })), null);
  });

  it('o leitor de tela ouve número, documento, local e trecho', () => {
    assert.equal(
      citationAccessibilityLabel(citation()),
      'Fonte 1: Caderneta brasileira da gestante — Ministério da Saúde, 1ª edição, 2026. página 12, seção sinais de alerta. Trecho: Procure a maternidade se houver sangramento.'
    );
  });

  it('só abre link https', () => {
    assert.equal(canOpenSource(citation()), true);
    assert.equal(canOpenSource(citation({ url: null })), false);
    assert.equal(canOpenSource(citation({ url: 'http://x.gov.br' })), false);
  });
});
