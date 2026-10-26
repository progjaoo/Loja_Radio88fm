import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

const responseSchema = z.object({
  cep: z.string(), logradouro: z.string().optional().default(''),
  bairro: z.string().optional().default(''), localidade: z.string().min(1),
  uf: z.string().length(2), ibge: z.string().regex(/^\d{7}$/).optional(),
});
export type PostalAddress = { postalCode: string; street: string; neighborhood: string; city: string; state: string; municipalityCode?: string };
export const postalDigits = (value: string) => value.replace(/\D/g, '');
const cache = new Map<string, PostalAddress>();

export function usePostalAddress(postal: string, onFound?: (address: PostalAddress) => void, enabled = true) {
  const cep = postalDigits(postal);
  const callback = useRef(onFound);
  callback.current = onFound;
  const [retryCount, setRetryCount] = useState(0);
  const [result, setResult] = useState<{ cep: string; status: 'loading' | 'success' | 'error'; address?: PostalAddress; message?: string } | null>(null);
  useEffect(() => {
    if (!enabled || cep.length !== 8) { setResult(null); return; }
    const controller = new AbortController();
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(async () => {
      setResult({ cep, status: 'loading' });
      try {
        let address = cache.get(cep);
        if (!address) {
          timeout = setTimeout(() => controller.abort('timeout'), 8000);
          const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: controller.signal, credentials: 'omit' });
          if (!response.ok) throw new Error('unavailable');
          const body = await response.json();
          if (body?.erro === true || body?.erro === 'true') throw new Error('not-found');
          const parsed = responseSchema.safeParse(body);
          if (!parsed.success || postalDigits(parsed.data.cep) !== cep) throw new Error('unavailable');
          address = {
            postalCode: parsed.data.cep,
            street: parsed.data.logradouro,
            neighborhood: parsed.data.bairro,
            city: parsed.data.localidade,
            state: parsed.data.uf,
            ...(parsed.data.ibge ? { municipalityCode: parsed.data.ibge } : {}),
          };
          if (cache.size >= 100) cache.clear();
          cache.set(cep, address);
        }
        if (!active || controller.signal.aborted) return;
        setResult({ cep, status: 'success', address });
        callback.current?.(address);
      } catch (error) {
        if (!active || (controller.signal.aborted && controller.signal.reason !== 'timeout')) return;
        setResult({ cep, status: 'error', message: error instanceof Error && error.message === 'not-found'
          ? 'CEP não encontrado. Confira o CEP ou preencha o endereço manualmente.'
          : 'Não foi possível consultar o CEP. Você pode preencher o endereço manualmente.' });
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }, 400);
    return () => { active = false; clearTimeout(timer); if (timeout) clearTimeout(timeout); controller.abort(); };
  }, [cep, enabled, retryCount]);
  return { ...(enabled && result?.cep === cep ? result : { status: 'idle' as const }), retry: () => setRetryCount(count => count + 1) };
}
