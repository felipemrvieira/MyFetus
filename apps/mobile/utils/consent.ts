/**
 * Consentimento no cadastro (E7-01.1).
 *
 * A política (finalidades, versões e texto) vem da API em GET /consents/policy;
 * o app envia de volta exatamente as versões vigentes que a pessoa aceitou.
 */
export type ConsentPurpose = {
  purpose: string;
  title: string;
  version: string;
  required: boolean;
  text: string;
};

export type ConsentPolicy = {
  purposes: ConsentPurpose[];
};

export type ConsentReference = {
  purpose: string;
  version: string;
};

export function parseConsentPolicy(data: unknown): ConsentPolicy | null {
  const purposes = (data as { purposes?: unknown })?.purposes;
  if (!Array.isArray(purposes) || purposes.length === 0) return null;

  const valid = purposes.every(
    (item) =>
      item &&
      typeof item.purpose === 'string' &&
      typeof item.version === 'string' &&
      typeof item.title === 'string' &&
      typeof item.text === 'string' &&
      typeof item.required === 'boolean'
  );
  return valid ? { purposes: purposes as ConsentPurpose[] } : null;
}

export function buildSignupConsents(policy: ConsentPolicy): ConsentReference[] {
  return policy.purposes
    .filter((item) => item.required)
    .map(({ purpose, version }) => ({ purpose, version }));
}

export type ApiErrorInfo = {
  status: number | null;
  code: string | null;
  message: string | null;
};

// Lê o corpo de erro da API ({ error, code }) a partir de um erro do axios.
export function getApiErrorInfo(error: unknown): ApiErrorInfo {
  const response = (error as { response?: { status?: number; data?: { error?: unknown; code?: unknown } } })?.response;
  return {
    status: typeof response?.status === 'number' ? response.status : null,
    code: typeof response?.data?.code === 'string' ? response.data.code : null,
    message: typeof response?.data?.error === 'string' ? response.data.error : null,
  };
}
