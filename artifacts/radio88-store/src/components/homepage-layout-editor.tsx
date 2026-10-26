import './homepage-layout-editor.css';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetHomepageLayout, useUpdateHomepageLayout, getGetHomepageLayoutQueryKey, useListCategories, useListProducts } from '@workspace/api-client-react';
import type { HomepageLayout, HomepageSection } from '@workspace/api-client-react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { ErrorState, Loading, Notice } from '@/components/feedback';
import { useCan } from '@/components/admin-permissions';
import { userFacingError } from '@/lib/user-facing-errors';
import { Catalog } from '@/components/catalog-home';

const NAMES: Record<string, string> = { hero: 'Apresentação (topo)', featured: 'Em destaque', catalog: 'Vitrine', categories: 'Categorias' };
const sec = (id: HomepageSection['id'], title: string, description: string, limit: number, columns: number): HomepageSection => ({ id, enabled: true, title, description, limit, columns, categoryIds: [], productIds: [] });
const DEFAULT_LAYOUT: HomepageLayout = {
  sections: [
    sec('hero', 'Apresentação', '', 100, 4),
    sec('featured', 'Em destaque', '', 100, 4),
    sec('catalog', 'Toda a vitrine', '', 100, 4),
    sec('categories', 'Explore por categoria', '', 100, 4),
  ],
  hero: { title: 'A loja oficial dos ouvintes da Rádio 88 FM.', description: 'Produtos oficiais da estação, com venda direta, preço claro e pagamento via PIX confirmado manualmente pela equipe.', ctaLabel: 'Ver a vitrine', ctaHref: '/#vitrine', alignment: 'left' },
};
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const isHref = (v: string) => {
  if (/[\u0000-\u0020\\]/.test(v)) return false;
  if (/^#[A-Za-z0-9_-]+$/.test(v) || (v.startsWith('/') && !v.startsWith('//'))) return true;
  try { const url = new URL(v); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
};

function validate(d: HomepageLayout) {
  const e: string[] = [];
  if (!d.sections.some(s => s.enabled)) e.push('Mantenha ao menos uma seção visível.');
  if (!d.hero.title.trim()) e.push('O título da apresentação é obrigatório.');
  if (!d.hero.ctaLabel.trim()) e.push('Informe o texto do botão da apresentação.');
  if (!d.hero.ctaHref.trim() || !isHref(d.hero.ctaHref.trim())) e.push('Destino do botão inválido: use #âncora, /caminho ou http(s)://.');
  d.sections.forEach(s => { if (!Number.isInteger(s.limit) || s.limit < 1 || s.limit > 100) e.push(`${NAMES[s.id]}: o limite deve estar entre 1 e 100.`); });
  return e;
}

function IdPicker({ label, items, selected, onChange, disabled, testId }: { label: string; items: { id: string; name: string }[]; selected: string[]; onChange: (ids: string[]) => void; disabled: boolean; testId: string }) {
  const [filter, setFilter] = useState('');
  const shown = items.filter(i => i.name.toLowerCase().includes(filter.toLowerCase()));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  const move = (i: number, d: number) => { const n = [...selected]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange(n); };
  return (
    <div className="grid gap-2">
      <div className="text-xs font-bold">{label} <span className="font-normal text-muted-foreground">({selected.length ? `${selected.length} selecionados` : 'vazio = todos'})</span></div>
      <input className="field" placeholder="Filtrar lista" value={filter} onChange={e => setFilter(e.target.value)} aria-label={`Filtrar ${label}`} />
      <div className="hle-list" data-testid={testId}>
        {shown.length ? shown.map(i => <label key={i.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-black" disabled={disabled} checked={selected.includes(i.id)} onChange={() => toggle(i.id)} />{i.name}</label>) : <span className="text-xs text-muted-foreground">Nada encontrado.</span>}
      </div>
      {selected.length > 0 && <ol className="grid gap-1 text-sm">{selected.map((id, i) => (
        <li key={id} className="hle-row"><span className="flex-1 truncate">{i + 1}. {items.find(x => x.id === id)?.name ?? 'Item indisponível'}</span>
          <button type="button" className="hle-iconbtn" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label="Mover para cima"><ArrowUp size={14} /></button>
          <button type="button" className="hle-iconbtn" disabled={disabled || i === selected.length - 1} onClick={() => move(i, 1)} aria-label="Mover para baixo"><ArrowDown size={14} /></button>
          <button type="button" className="hle-iconbtn" disabled={disabled} onClick={() => toggle(id)} aria-label="Remover"><X size={14} /></button></li>
      ))}</ol>}
    </div>
  );
}

export function HomepageLayoutEditor() {
  const canManage = useCan('content:manage');
  const q = useGetHomepageLayout({ query: { queryKey: getGetHomepageLayoutQueryKey(), staleTime: 30_000 } });
  const cats = useListCategories();
  const prods = useListProducts();
  const qc = useQueryClient();
  const save = useUpdateHomepageLayout();
  const [draft, setDraft] = useState<HomepageLayout | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const init = useRef(false);
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (q.data && !init.current) { init.current = true; setDraft(clone(q.data)); } }, [q.data]);
  useEffect(() => { previewRef.current?.setAttribute('inert', ''); });
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data || !draft) return <ErrorState retry={() => q.refetch()} message="Não foi possível carregar o layout da página inicial." />;
  const saved = q.data;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const errors = validate(draft);
  const off = !canManage || save.isPending;
  const edit = (d: HomepageLayout) => { setDraft(d); setFeedback(null); };
  const setSec = (i: number, p: Partial<HomepageSection>) => edit({ ...draft, sections: draft.sections.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  const setHero = (p: Partial<HomepageLayout['hero']>) => edit({ ...draft, hero: { ...draft.hero, ...p } });
  const move = (i: number, d: number) => { const s = [...draft.sections]; [s[i], s[i + d]] = [s[i + d], s[i]]; edit({ ...draft, sections: s }); };
  const submit = () => {
    if (!canManage) return;
    setShowErrors(true);
    if (errors.length) return;
    const body: HomepageLayout = { ...draft, hero: { ...draft.hero, title: draft.hero.title.trim(), ctaLabel: draft.hero.ctaLabel.trim(), ctaHref: draft.hero.ctaHref.trim() } };
    save.mutate({ data: body }, {
      onSuccess: s => { qc.setQueryData(getGetHomepageLayoutQueryKey(), s); qc.invalidateQueries({ queryKey: getGetHomepageLayoutQueryKey() }); setDraft(clone(s)); setShowErrors(false); setFeedback({ ok: true, text: 'Layout salvo. A página inicial já usa esta configuração.' }); },
      onError: e => setFeedback({ ok: false, text: userFacingError(e) }),
    });
  };
  const catItems = (cats.data ?? []).map(c => ({ id: c.id, name: c.name }));
  const prodItems = (prods.data ?? []).map(p => ({ id: p.id, name: p.name }));
  return (
    <div className="grid gap-4" data-testid="homepage-layout-editor">
      {!canManage && <p className="text-xs text-muted-foreground">Acesso somente para consulta. Você não pode alterar o layout.</p>}
      {(cats.isError || prods.isError) && <ErrorState retry={() => { cats.refetch(); prods.refetch(); }} message="Não foi possível carregar categorias ou produtos para seleção." />}
      {draft.sections.map((s, i) => (
        <div key={s.id} className={`hle-card ${s.enabled ? '' : 'is-off'}`} data-testid={`editor-section-${s.id}`}>
          <div className="hle-row justify-between">
            <b className="text-base">{i + 1}. {NAMES[s.id]}</b>
            <div className="hle-row">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-black" disabled={off} checked={s.enabled} onChange={e => setSec(i, { enabled: e.target.checked })} data-testid={`checkbox-section-${s.id}`} />Visível</label>
              <button type="button" className="hle-iconbtn" disabled={off || i === 0} onClick={() => move(i, -1)} aria-label={`Subir ${NAMES[s.id]}`} data-testid={`button-up-${s.id}`}><ArrowUp size={14} /></button>
              <button type="button" className="hle-iconbtn" disabled={off || i === draft.sections.length - 1} onClick={() => move(i, 1)} aria-label={`Descer ${NAMES[s.id]}`} data-testid={`button-down-${s.id}`}><ArrowDown size={14} /></button>
            </div>
          </div>
          {s.id === 'hero' ? (
            <div className="mt-3 grid gap-3">
              <label className="block text-xs font-bold">Título<input className="field mt-1.5" maxLength={120} disabled={off} value={draft.hero.title} onChange={e => setHero({ title: e.target.value })} data-testid="input-hero-title" /></label>
              <label className="block text-xs font-bold">Descrição<textarea className="field mt-1.5" rows={3} maxLength={400} disabled={off} value={draft.hero.description} onChange={e => setHero({ description: e.target.value })} /></label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-xs font-bold">Texto do botão<input className="field mt-1.5" maxLength={60} disabled={off} value={draft.hero.ctaLabel} onChange={e => setHero({ ctaLabel: e.target.value })} /></label>
                <label className="block text-xs font-bold">Destino do botão<input className="field mt-1.5" maxLength={2048} disabled={off} value={draft.hero.ctaHref} onChange={e => setHero({ ctaHref: e.target.value })} placeholder="#vitrine, /?featured=true ou https://" /></label>
                <label className="block text-xs font-bold">Alinhamento<select className="field mt-1.5" disabled={off} value={draft.hero.alignment} onChange={e => setHero({ alignment: e.target.value as 'left' | 'center' })}><option value="left">Esquerda</option><option value="center">Centralizado</option></select></label>
              </div>
              <p className="text-xs text-muted-foreground">Com banner ativo e imagem, o banner (editado abaixo) é exibido no lugar deste texto.</p>
            </div>
          ) : (
            <div className="mt-3 grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-bold">Título<input className="field mt-1.5" maxLength={120} disabled={off} value={s.title} onChange={e => setSec(i, { title: e.target.value })} /></label>
                <label className="block text-xs font-bold">Descrição<input className="field mt-1.5" maxLength={400} disabled={off} value={s.description} onChange={e => setSec(i, { description: e.target.value })} /></label>
                <label className="block text-xs font-bold">Limite de itens (1 a 100)<input type="number" min={1} max={100} className="field mt-1.5" disabled={off} value={Number.isNaN(s.limit) ? '' : s.limit} onChange={e => setSec(i, { limit: e.target.value === '' ? NaN : Number(e.target.value) })} data-testid={`input-limit-${s.id}`} /></label>
                <label className="block text-xs font-bold">Colunas na grade<select className="field mt-1.5" disabled={off} value={s.columns} onChange={e => setSec(i, { columns: Number(e.target.value) })}><option value={2}>2 colunas</option><option value={3}>3 colunas</option><option value={4}>4 colunas</option></select></label>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <IdPicker label="Categorias" items={catItems} selected={s.categoryIds} onChange={ids => setSec(i, { categoryIds: ids })} disabled={off} testId={`picker-categories-${s.id}`} />
                {s.id !== 'categories' && <IdPicker label="Produtos (ordem de exibição)" items={prodItems} selected={s.productIds} onChange={ids => setSec(i, { productIds: ids })} disabled={off} testId={`picker-products-${s.id}`} />}
              </div>
            </div>
          )}
        </div>
      ))}
      <div>
        <h3 className="display mb-2 text-lg">Prévia com dados reais</h3>
        <div className="hle-preview" ref={previewRef} aria-label="Prévia da página inicial" data-testid="layout-preview">
          {errors.length ? <p className="p-6 text-sm text-muted-foreground">Corrija os avisos abaixo para visualizar a prévia.</p> : <Catalog configOverride={draft} preview />}
        </div>
      </div>
      {(showErrors || dirty) && errors.length > 0 && <ul className="grid gap-1 text-xs text-destructive" role="alert">{errors.map(m => <li key={m}>{m}</li>)}</ul>}
      {feedback && <Notice text={feedback.text} kind={feedback.ok ? 'success' : 'error'} />}
      {canManage && (
        <div className="hle-bar" data-testid="layout-actions">
          <span className="flex-1 text-sm" aria-live="polite">{dirty ? 'Alterações não salvas' : 'Tudo salvo'}</span>
          <button type="button" className="button button-outline" disabled={off} onClick={() => { edit(clone(DEFAULT_LAYOUT)); }} data-testid="button-reset-layout">Restaurar padrão</button>
          <button type="button" className="button button-outline" disabled={off || !dirty} onClick={() => { setDraft(clone(saved)); setShowErrors(false); setFeedback(null); }} data-testid="button-cancel-layout">Cancelar</button>
          <button type="button" className="button" disabled={off || !dirty} onClick={submit} data-testid="button-save-layout">{save.isPending ? 'Salvando…' : 'Salvar layout'}</button>
        </div>
      )}
    </div>
  );
}
