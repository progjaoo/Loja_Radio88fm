import { useEffect, useState } from 'react';
import { userFacingError } from '@/lib/user-facing-errors';
import { useQueryClient } from '@tanstack/react-query';
import { useGetShippingSettings, useUpdateShippingSettings, getGetShippingSettingsQueryKey } from '@workspace/api-client-react';
import type { ShippingSettings } from '@workspace/api-client-react';
import { Loading, ErrorState, Notice } from '@/components/feedback';
import { useCan } from '@/components/admin-permissions';
import { formatBrazilPhone, phoneDigits } from '@/lib/phone-format';

const envText = { sandbox: 'Sandbox (testes)', production: 'Produção', unconfigured: 'Não configurado' } as const;
type Str = Record<string, string>;
const toForm = (s: ShippingSettings): Str => ({
  originPostalCode: s.originPostalCode, handlingDays: String(s.handlingDays), marginPercent: String(s.marginPercent), marginFixed: String(s.marginFixed),
  freeShippingAbove: s.freeShippingAbove == null ? '' : String(s.freeShippingAbove),
  defaultWeightKg: String(s.defaultWeightKg), defaultHeightCm: String(s.defaultHeightCm), defaultWidthCm: String(s.defaultWidthCm), defaultLengthCm: String(s.defaultLengthCm),
  ...Object.fromEntries(Object.entries(s.sender).map(([k, v]) => [`sender.${k}`, k === 'phone' ? formatBrazilPhone(v) : v])),
});
const num = (v: string) => Number(v.replace(',', '.'));

const senderFields: [string, string, string?][] = [['name', 'Nome do remetente'], ['document', 'CPF ou CNPJ (somente números)'], ['street', 'Rua'], ['number', 'Número'], ['complement', 'Complemento'], ['neighborhood', 'Bairro'], ['city', 'Cidade'], ['state', 'UF'], ['phone', 'Telefone (DDD + número)'], ['email', 'E-mail']];

export function AdminShippingConfig() {
  const can = useCan('shipping:manage'); const qc = useQueryClient();
  const q = useGetShippingSettings({ query: { queryKey: getGetShippingSettingsQueryKey() } });
  const save = useUpdateShippingSettings();
  const [f, setF] = useState<Str | null>(null); const [saved, setSaved] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { if (q.data && !f) setF(toForm(q.data.settings)); }, [q.data, f]);
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data || !f) return <ErrorState retry={() => q.refetch()} message="As configurações de frete não estão disponíveis para este perfil." />;
  const set = (k: string, v: string) => { setF({ ...f, [k]: v }); setSaved(false); };
  const input = (k: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => {
    const isPhone = k === 'sender.phone';
    const isEmail = k === 'sender.email';
    return <label key={k} className="text-xs font-bold">{label}<input
      {...props}
      className="field mt-2"
      type={isPhone ? 'tel' : isEmail ? 'email' : props.type}
      inputMode={isPhone ? 'tel' : isEmail ? 'email' : props.inputMode}
      autoComplete={isPhone ? 'tel' : isEmail ? 'email' : props.autoComplete}
      maxLength={isPhone ? 20 : props.maxLength}
      placeholder={isPhone ? '(00) 00000-0000' : props.placeholder}
      value={isPhone ? formatBrazilPhone(f[k] ?? '') : f[k] ?? ''}
      disabled={!can || save.isPending}
      onChange={e => set(k, isPhone ? formatBrazilPhone(e.target.value) : e.target.value)}
      data-testid={`input-shipping-${k.replace('.', '-')}`}
    /></label>;
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setSaved(false);
    const sender = Object.fromEntries(senderFields.map(([k]) => [k, (f[`sender.${k}`] ?? '').trim()])) as unknown as ShippingSettings['sender'];
    sender.state = sender.state.toUpperCase();
    sender.phone = phoneDigits(sender.phone);
    const data: ShippingSettings = { originPostalCode: f.originPostalCode.replace(/\D/g, ''), handlingDays: num(f.handlingDays), marginPercent: num(f.marginPercent), marginFixed: num(f.marginFixed), freeShippingAbove: f.freeShippingAbove.trim() === '' ? null : num(f.freeShippingAbove), defaultWeightKg: num(f.defaultWeightKg), defaultHeightCm: num(f.defaultHeightCm), defaultWidthCm: num(f.defaultWidthCm), defaultLengthCm: num(f.defaultLengthCm), sender };
    if (Object.entries(data).some(([k, v]) => typeof v === 'number' && Number.isNaN(v))) { setErr('Revise os campos numéricos.'); return; }
    save.mutate({ data }, { onSuccess: () => { setSaved(true); qc.invalidateQueries({ queryKey: getGetShippingSettingsQueryKey() }); }, onError: e2 => setErr(userFacingError(e2)) });
  };
  const { ready, environment } = q.data;
  return <form onSubmit={submit} className="grid gap-6" data-testid="form-shipping-settings">
    <div className="rounded-[28px] bg-card shadow-soft p-5 flex flex-wrap items-center justify-between gap-3">
       <div><div className="eyebrow">CONEXÃO SUPERFRETE</div><p className="mt-1 text-sm" data-testid="status-shipping-connection">{ready ? 'Configuração pronta para cotar. A próxima cotação verificará as credenciais.' : 'Cotação indisponível: credenciais ou CEP de origem não configurados.'}</p><p className="mt-1 text-xs text-muted-foreground">As credenciais ficam somente no servidor e nunca são exibidas aqui.</p></div>
      <span className="rounded-full bg-muted px-3 py-1.5 text-xs font-bold" data-testid="status-shipping-environment">{envText[environment]}</span>
    </div>
    {!can && <Notice text="Seu perfil pode apenas visualizar estas configurações." kind="success" />}
    <fieldset className="rounded-[28px] bg-card shadow-soft p-5"><legend className="display text-xl px-1">Origem e prazos</legend><div className="mt-3 grid gap-4 sm:grid-cols-2">{input('originPostalCode', 'CEP de origem', { inputMode: 'numeric', placeholder: '00000000' })}{input('handlingDays', 'Dias de preparo', { type: 'number', min: 0, max: 30, step: 1 })}</div></fieldset>
    <fieldset className="rounded-[28px] bg-card shadow-soft p-5"><legend className="display text-xl px-1">Remetente</legend><div className="mt-3 grid gap-4 sm:grid-cols-2">{senderFields.map(([k, l]) => input(`sender.${k}`, l))}</div></fieldset>
    <fieldset className="rounded-[28px] bg-card shadow-soft p-5"><legend className="display text-xl px-1">Padrões de embalagem</legend><p className="text-xs text-muted-foreground">Usados quando uma variante não tem peso ou dimensões cadastrados. O peso das variantes é armazenado em gramas e editado em kg no catálogo.</p><div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{input('defaultWeightKg', 'Peso padrão (kg)', { type: 'number', step: '0.001', min: 0 })}{input('defaultLengthCm', 'Comprimento padrão (cm)', { type: 'number', step: '0.1', min: 0 })}{input('defaultWidthCm', 'Largura padrão (cm)', { type: 'number', step: '0.1', min: 0 })}{input('defaultHeightCm', 'Altura padrão (cm)', { type: 'number', step: '0.1', min: 0 })}</div></fieldset>
    <fieldset className="rounded-[28px] bg-card shadow-soft p-5"><legend className="display text-xl px-1">Margem e frete grátis</legend><div className="mt-3 grid gap-4 sm:grid-cols-3">{input('marginPercent', 'Margem percentual (%)', { type: 'number', step: '0.01', min: 0, max: 100 })}{input('marginFixed', 'Margem fixa (R$)', { type: 'number', step: '0.01', min: 0, max: 1000 })}{input('freeShippingAbove', 'Frete grátis acima de (R$, opcional)', { type: 'number', step: '0.01', min: 0, placeholder: 'Sem limite' })}</div><p className="mt-3 text-xs text-muted-foreground">Todos os valores de frete são calculados no servidor.</p></fieldset>
    <div className="flex flex-wrap items-center gap-4"><button className="button" disabled={!can || save.isPending} data-testid="button-save-shipping">{save.isPending ? 'Salvando…' : 'Salvar configurações'}</button>{!can && <span className="text-xs text-muted-foreground">Somente leitura</span>}{saved && <span className="text-sm" role="status" data-testid="status-shipping-saved">Configurações salvas.</span>}</div>
    {err && <Notice text={err} />}
  </form>;
}
