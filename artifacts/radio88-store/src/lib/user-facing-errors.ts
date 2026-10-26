type ErrorWithDetails = {
  message?: unknown;
  name?: unknown;
  status?: unknown;
};

const STATUS_MESSAGES: Record<number, string> = {
  400: 'Não foi possível processar esses dados. Confira as informações e tente novamente.',
  401: 'Sua sessão expirou ou não está ativa. Entre novamente para continuar.',
  403: 'Você não tem permissão para realizar esta ação.',
  404: 'Não encontramos esse item. Atualize a página e tente novamente.',
  409: 'Algumas informações mudaram. Atualize a página e tente novamente.',
  422: 'Revise os campos informados e tente novamente.',
  429: 'Muitas tentativas. Aguarde um pouco e tente novamente.',
};

export function userFacingError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'Não foi possível concluir. Tente novamente.';
  }

  const details = error as ErrorWithDetails;
  if (details.name === 'ZodError') {
    return 'Revise os campos destacados e tente novamente.';
  }

  const message = typeof details.message === 'string' ? details.message : '';
  const statusFromProperty =
    typeof details.status === 'number' ? details.status : undefined;
  const statusFromMessage = message.match(/\bHTTP\s+(\d{3})\b/i)?.[1];
  const status = statusFromProperty ?? (statusFromMessage ? Number(statusFromMessage) : undefined);

  if (status !== undefined) {
    if (status === 409) {
      const detail = message.split(/:\s*/, 2)[1] ?? '';
      if (/perfil fiscal|regime tribut[aá]rio/i.test(detail)) {
        return 'Este produto ainda não está liberado para compra: há dados fiscais pendentes. A equipe da loja precisa completar o cadastro.';
      }
      if (/estoque insuficiente|saldo dispon[ií]vel/i.test(detail)) {
        return 'A disponibilidade mudou e não há estoque suficiente para esta quantidade. Atualize a sacola e tente novamente.';
      }
      if (/mudaram durante a cota[cç][aã]o|mudaram durante a cotação|calcule o frete novamente/i.test(detail)) {
        return 'A sacola ou as opções de entrega mudaram. Calcule o frete novamente antes de confirmar.';
      }
    }
    if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];
    if (status >= 500) return 'O serviço está temporariamente indisponível. Tente novamente em instantes.';
  }

  if (/failed to fetch|networkerror|network request failed|econnrefused|timed? ?out/i.test(message)) {
    return 'Não foi possível conectar à loja. Verifique sua conexão e tente novamente.';
  }

  return 'Não foi possível concluir. Tente novamente.';
}
