import { api } from './apiClient';

export interface ChatFonte {
  fonte: string;
  secao?: string;
  relevancia: number;
}

/** Fonte de um trecho usado na resposta, na ordem dos números [n] (E4-04). */
export interface ChatCitacao {
  numero: number;
  documento_id: string | null;
  titulo: string;
  emissor: string | null;
  edicao: string | null;
  ano: number | null;
  pagina: number | null;
  secao: string | null;
  trecho: string;
  url: string | null;
}

export interface ChatResponse {
  resposta: string;
  semFonte: boolean;
  citacoes: ChatCitacao[];
  fontes: ChatFonte[];
}

/**
 * Envia a pergunta da paciente para o chat clínico (retrieval + geração via Gemini)
 * em POST /api/internal/rag/chat.
 */
export async function askClinicalChat(query: string): Promise<ChatResponse> {
  const response = await api.post('/internal/rag/chat', { query });
  const data = response.data;
  return {
    resposta: data.resposta,
    semFonte: data.sem_fonte === true,
    citacoes: Array.isArray(data.citacoes) ? data.citacoes : [],
    fontes: data.fontes || [],
  };
}
