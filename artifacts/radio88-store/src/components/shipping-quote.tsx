import { useEffect, useMemo, useRef, useState } from 'react';
import { useCotarFrete } from '@workspace/api-client-react';
import type { CartLine, FreteRate, ShippingOption } from '@workspace/api-client-react';
import { money } from '@/lib/format';
import { userFacingError } from '@/lib/user-facing-errors';
import { Truck } from 'lucide-react';
import { usePostalAddress } from '@/lib/postal-address';
import { PostalLookupStatus } from '@/components/postal-lookup-status';

export const PICKUP_OPTION: ShippingOption = {
  id: 'retirada-combinada', label: 'Retirada combinada', method: 'pickup', fee: 0, estimatedDays: 0,
  description: 'Retirada sem custo, combinada com a equipe da Rádio 88 FM',
};
const toOption = (r: FreteRate): ShippingOption => ({
  id: `superfrete-${r.servicoId}`, label: r.nome, method: 'delivery', fee: r.preco, estimatedDays: r.prazoDias, description: r.transportadora,
});
export const onlyDigits = (v: string) => v.replace(/\D/g, '');
const msg = userFacingError;

export function ShippingQuote({ lines, cep, onCepChange, contextKey = '', selected, onSelect, subtotal, testPrefix = 'shipping' }: {
  lines: CartLine[]; cep: string; onCepChange: (v: string) => void; contextKey?: string;
  selected: ShippingOption | null; onSelect: (o: ShippingOption | null) => void; subtotal: number; testPrefix?: string;
}) {
  const digits = onlyDigits(cep);
  const postalLookup = usePostalAddress(cep);
  const key = useMemo(() => JSON.stringify([digits, contextKey, lines.map(l => [l.variantId, l.quantity, l.unitPrice])]), [digits, contextKey, lines]);
  const keyRef = useRef(key); keyRef.current = key;
  const [quote, setQuote] = useState<{ key: string; rates: FreteRate[] } | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(null);
  const cotar = useCotarFrete();
  const fresh = quote?.key === key ? quote.rates : null;
  const freshError = error?.key === key ? error.text : '';
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const valid = digits.length === 8;

  useEffect(() => {
    const s = selectedRef.current;
    if (s && s.method === 'delivery') onSelectRef.current(null);
  }, [key]);

  const calc = () => {
    if (!valid || !lines.length) return;
     const requested = key; setError(null); setQuote(null);
     if (selectedRef.current?.method === 'delivery') onSelectRef.current(null);
    cotar.mutate({ data: { cepDestino: digits, itens: lines.map(l => ({ variantId: l.variantId, quantity: l.quantity })) } }, {
      onSuccess: rates => { if (keyRef.current === requested) setQuote({ key: requested, rates }); },
      onError: e => { if (keyRef.current === requested) setError({ key: requested, text: msg(e) }); },
    });
  };
  const options = [PICKUP_OPTION, ...(fresh ?? []).map(r => ({ rate: r, option: toOption(r) }))];
  const loading = cotar.isPending;
  const fee = selected?.fee ?? 0;
  return <div data-testid={`${testPrefix}-quote`}>
    <label className="block text-xs font-bold">CEP de entrega
       <div className="mt-2 flex flex-col gap-2 sm:flex-row"><input className="field min-w-0" inputMode="numeric" maxLength={9} value={cep} onChange={e => onCepChange(e.target.value)} placeholder="00000-000" aria-invalid={!!cep && !valid} data-testid={`${testPrefix}-input-cep`} />
      <button type="button" className="button shrink-0" disabled={!valid || loading || !lines.length} onClick={calc} data-testid={`${testPrefix}-button-calculate`}><Truck size={16} />{loading ? 'Calculando…' : 'Calcular frete'}</button></div>
    </label>
    <PostalLookupStatus lookup={postalLookup} />
    {cep && !valid && <p className="mt-2 text-xs text-destructive" role="alert" data-testid={`${testPrefix}-cep-error`}>Informe um CEP com 8 dígitos.</p>}
    {loading && <div className="mt-3 grid gap-2" aria-busy="true"><div className="h-14 animate-pulse rounded-[20px] bg-muted" /><div className="h-14 animate-pulse rounded-[20px] bg-muted" /></div>}
    {freshError && !loading && <p className="mt-3 text-sm text-destructive" role="alert" data-testid={`${testPrefix}-quote-error`}>{freshError}</p>}
    <div className="mt-3 grid gap-2" role="radiogroup" aria-label="Opções de entrega">
      {(() => { const p = PICKUP_OPTION; return <button type="button" role="radio" aria-checked={selected?.id === p.id} onClick={() => onSelect(p)} className={`flex justify-between rounded-[20px] border p-4 text-left ${selected?.id === p.id ? 'border-foreground bg-muted' : 'border-border'}`} data-testid={`${testPrefix}-option-${p.id}`}><span><b className="block text-sm">{p.label}</b><small className="text-muted-foreground">{p.description}</small></span><b>Grátis</b></button>; })()}
      {!loading && options.slice(1).map(o => { const { rate, option } = o as { rate: FreteRate; option: ShippingOption }; const off = !!rate.erro; const on = selected?.id === option.id;
        return <button type="button" role="radio" aria-checked={on} aria-disabled={off} disabled={off} key={option.id} onClick={() => onSelect(option)} className={`flex justify-between gap-3 rounded-[20px] border p-4 text-left disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'border-foreground bg-muted' : 'border-border'}`} data-testid={`${testPrefix}-option-${option.id}`}><span><b className="block text-sm">{option.label}</b><small className="text-muted-foreground">{off ? rate.erro : `${option.description} · ${option.estimatedDays} ${option.estimatedDays === 1 ? 'dia útil' : 'dias úteis'}`}</small></span><b>{off ? 'Indisponível' : option.fee ? money(option.fee) : 'Grátis'}</b></button>; })}
      {fresh && !loading && !fresh.length && <p className="text-xs" data-testid={`${testPrefix}-empty`}>Nenhuma entrega disponível para este CEP. A retirada continua disponível.</p>}
    </div>
    <p className="mt-2 text-xs text-muted-foreground">O valor final do frete é confirmado pelo servidor ao criar o pedido.</p>
    <div className="mt-4 grid gap-1 border-t border-border pt-3 text-sm" data-testid={`${testPrefix}-totals`}>
      <div className="flex justify-between"><span>Subtotal</span><b>{money(subtotal)}</b></div>
      <div className="flex justify-between"><span>Frete</span><b>{selected ? (fee ? money(fee) : 'Grátis') : 'Selecione uma opção'}</b></div>
      <div className="flex justify-between pt-1"><b>Total</b><b className="text-lg" data-testid={`${testPrefix}-total`}>{money(subtotal + fee)}</b></div>
    </div>
  </div>;
}
