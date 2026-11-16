/**
 * Texto das fontes exibidas no chat (E4-04).
 *
 * Regras puras: rótulo do botão "Fontes", identificação de cada documento e o
 * texto lido pelo leitor de tela. A página só aparece quando existe.
 */
import type { ChatCitacao } from './chatApi';

export function sourcesToggleLabel(count: number, expanded: boolean): string {
  const noun = count === 1 ? 'fonte' : 'fontes';
  return `${expanded ? 'Ocultar' : 'Ver'} ${count} ${noun}`;
}

// "Caderneta brasileira da gestante — Ministério da Saúde, 1ª edição, 2026"
export function citationTitle(citation: ChatCitacao): string {
  const details = [citation.emissor, citation.edicao, citation.ano ? String(citation.ano) : null].filter(Boolean);
  return details.length > 0 ? `${citation.titulo} — ${details.join(', ')}` : citation.titulo;
}

// "p. 12 · sinais de alerta"
export function citationLocation(citation: ChatCitacao): string | null {
  const parts = [citation.pagina ? `p. ${citation.pagina}` : null, citation.secao].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function citationAccessibilityLabel(citation: ChatCitacao): string {
  const location = [citation.pagina ? `página ${citation.pagina}` : null, citation.secao ? `seção ${citation.secao}` : null]
    .filter(Boolean)
    .join(', ');
  return [`Fonte ${citation.numero}: ${citationTitle(citation)}`, location, `Trecho: ${citation.trecho}`]
    .filter(Boolean)
    .join('. ');
}

export function canOpenSource(citation: ChatCitacao): boolean {
  return typeof citation.url === 'string' && citation.url.startsWith('https://');
}
