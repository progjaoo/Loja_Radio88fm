import { userFacingError } from '@/lib/user-facing-errors';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetHomepageBanner, useUpdateHomepageBanner, getGetHomepageBannerQueryKey } from '@workspace/api-client-react';
import type { HomepageBanner, HomepageBannerSlide, HomepageBannerUpdate } from '@workspace/api-client-react';
import { ErrorState, Loading, Notice } from '@/components/feedback';
import { ImageUploadField } from '@/components/image-upload';
import { useCan } from '@/components/admin-permissions';
import { HomepageLayoutEditor } from '@/components/homepage-layout-editor';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

const errText = userFacingError;
const desktopBannerRequirements = { width: 1920, height: 1080, minWidth: 960, minHeight: 540 };
const mobileBannerRequirements = { width: 960, height: 540, minWidth: 960, minHeight: 540 };
const isHttp = (v: string) => {
  try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; }
  catch { return false; }
};
type BannerForm = { enabled: boolean; slides: HomepageBannerSlide[] };
const blankSlide = (): HomepageBannerSlide => ({ id: crypto.randomUUID(), enabled: false, title: '', description: '', imageUrl: null, mobileImageUrl: null, alt: '', ctaLabel: '', ctaHref: null });
const toBannerForm = (banner: HomepageBanner): BannerForm => ({ enabled: banner.enabled, slides: (banner.slides ?? []).map(slide => ({ ...slide })) });
const validBannerHref = (value: string) => !/[\u0000-\u0020\\]/.test(value) && ((value.startsWith('/') && !value.startsWith('//')) || isHttp(value));
const validateBanner = (form: BannerForm) => {
  const errors: Record<string, string> = {};
  if (form.slides.length > 8) errors.slides = 'O limite é de 8 destaques.';
  if (form.enabled && !form.slides.some(slide => slide.enabled)) errors.slides = 'Ative ao menos um destaque ou desative a apresentação de banners.';
  form.slides.forEach(slide => {
    const key = (field: string) => `${slide.id}.${field}`;
    if (slide.imageUrl?.trim() && !isHttp(slide.imageUrl.trim())) errors[key('imageUrl')] = 'Use um endereço http:// ou https://.';
    if (slide.mobileImageUrl?.trim() && !isHttp(slide.mobileImageUrl.trim())) errors[key('mobileImageUrl')] = 'Use um endereço http:// ou https://.';
    if (form.enabled && slide.enabled && !slide.imageUrl?.trim()) errors[key('imageUrl')] = 'Informe uma imagem desktop para este destaque ativo.';
    if (form.enabled && slide.enabled && !slide.alt.trim()) errors[key('alt')] = 'Descreva a imagem no texto alternativo.';
    if (slide.ctaHref?.trim() && !validBannerHref(slide.ctaHref.trim())) errors[key('ctaHref')] = 'Use um caminho interno (/...) ou endereço http(s).';
  });
  return errors;
};

function BannerEditor() {
  const q = useGetHomepageBanner({ query: { queryKey: getGetHomepageBannerQueryKey() } });
  const qc = useQueryClient();
  const save = useUpdateHomepageBanner();
  const canManage = useCan('content:manage');
  const [form, setForm] = useState<BannerForm | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<Record<string, boolean>>({});
  const init = useRef(false);
  useEffect(() => { if (q.data && !init.current) { init.current = true; setForm(toBannerForm(q.data)); } }, [q.data]);
  if (q.isLoading) return <Loading />;
  if (q.isError || !q.data || !form) return <ErrorState retry={() => q.refetch()} message="Não foi possível carregar os destaques." />;

  const errors = validateBanner(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(toBannerForm(q.data));
  const uploadPending = Object.values(pendingUploads).some(Boolean);
  const disabled = !canManage || save.isPending;
  const change = (next: BannerForm) => { setForm(next); setFeedback(null); };
  const patchSlide = (id: string, patch: Partial<HomepageBannerSlide>) => change({ ...form, slides: form.slides.map(slide => slide.id === id ? { ...slide, ...patch } : slide) });
  const moveSlide = (index: number, direction: number) => {
    const slides = [...form.slides];
    [slides[index], slides[index + direction]] = [slides[index + direction], slides[index]];
    change({ ...form, slides });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (uploadPending) { setFeedback({ ok: false, text: 'Aguarde o envio das imagens antes de salvar.' }); return; }
    if (Object.keys(errors).length) return;
    const data: HomepageBannerUpdate = {
      enabled: form.enabled,
      slides: form.slides.map(slide => ({
        ...slide,
        title: slide.title.trim(),
        description: slide.description.trim(),
        imageUrl: slide.imageUrl?.trim() || null,
        mobileImageUrl: slide.mobileImageUrl?.trim() || null,
        alt: slide.alt.trim(),
        ctaLabel: slide.ctaLabel.trim(),
        ctaHref: slide.ctaHref?.trim() || null,
      })),
    };
    save.mutate({ data }, {
      onSuccess: saved => {
        qc.setQueryData(getGetHomepageBannerQueryKey(), saved);
        setForm(toBannerForm(saved));
        setShowErrors(false);
        setFeedback({ ok: true, text: 'Destaques salvos. A vitrine já está atualizada.' });
      },
      onError: error => setFeedback({ ok: false, text: errText(error) }),
    });
  };
  const fieldError = (id: string, field: string) => showErrors ? errors[`${id}.${field}`] : undefined;
  return (
    <form onSubmit={submit} className="grid gap-4 rounded-[28px] bg-card p-5 shadow-soft md:p-6" noValidate data-testid="form-homepage-banners">
      <label className="flex items-start gap-3 rounded-2xl bg-muted/60 p-4 text-sm">
        <input type="checkbox" className="mt-0.5 accent-black" disabled={disabled} checked={form.enabled} onChange={event => change({ ...form, enabled: event.target.checked })} data-testid="checkbox-banner-enabled" />
        <span><b className="block">Exibir destaques na página inicial</b><span className="mt-1 block text-xs text-muted-foreground">Quando não houver destaque ativo, a apresentação padrão da Rádio 88 FM continua visível.</span></span>
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div><h3 className="display text-xl">Slides da vitrine</h3><p className="mt-1 text-xs text-muted-foreground">{form.slides.length} de 8 posições · a ordem abaixo é a ordem de exibição</p></div>
        {canManage && <button type="button" className="button button-outline" disabled={disabled || form.slides.length >= 8} onClick={() => change({ ...form, slides: [...form.slides, blankSlide()] })} data-testid="button-add-banner-slide"><Plus size={16} />Adicionar destaque</button>}
      </div>
      {showErrors && errors.slides && <p className="text-sm text-destructive" role="alert">{errors.slides}</p>}
      <aside className="rounded-2xl border border-border bg-muted/40 p-4 text-sm" aria-label="Padrão das artes do carrossel">
        <h4 className="font-bold">Padrão das artes: 16:9, sem bordas brancas</h4>
        <p className="mt-2">Desktop: <b>1920 × 1080 px</b>. Mobile opcional: <b>960 × 540 px</b>, com textos maiores. Os cards mantêm a mesma proporção em todas as telas.</p>
        <p className="mt-2 text-xs text-muted-foreground">Preencha toda a arte com a imagem ou o fundo da campanha. Mantenha textos e logos a pelo menos 5% das bordas. Use JPG, PNG ou WebP (até 8 MB; prefira até 500 KB). Sem uma versão mobile, a imagem desktop será reduzida proporcionalmente. URLs externas também devem seguir 16:9; imagens antigas fora do padrão podem ser cortadas nas bordas para preencher o card.</p>
      </aside>
      {form.slides.length === 0 && <div className="rounded-2xl border border-dashed border-border px-5 py-8 text-center">
        <p className="font-semibold">Nenhum destaque cadastrado</p>
        <p className="mt-1 text-sm text-muted-foreground">A área inicial seguirá usando a apresentação padrão até a equipe cadastrar um slide.</p>
        {canManage && <button type="button" className="button button-outline mt-4" disabled={disabled} onClick={() => change({ ...form, slides: [blankSlide()] })}>Criar primeiro destaque</button>}
      </div>}
      <div className="grid gap-4">
        {form.slides.map((slide, index) => (
          <article key={slide.id} className={`overflow-hidden rounded-[24px] border border-border bg-background/60 ${slide.enabled ? '' : 'opacity-75'}`} data-testid={`banner-slide-${slide.id}`}>
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-5">
              <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 font-mono text-xs text-primary">{String(index + 1).padStart(2, '0')}</span><div><b className="block text-sm">{`Destaque ${index + 1}`}</b><span className="text-xs text-muted-foreground">{slide.enabled ? 'Disponível para exibição' : 'Oculto da vitrine'}</span></div></div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" className="accent-black" disabled={disabled} checked={slide.enabled} onChange={event => patchSlide(slide.id, { enabled: event.target.checked })} data-testid={`checkbox-slide-enabled-${slide.id}`} />Ativo</label>
                <button type="button" className="grid h-9 w-9 place-items-center rounded-full border border-border hover:bg-muted disabled:opacity-40" disabled={disabled || index === 0} onClick={() => moveSlide(index, -1)} aria-label={`Mover destaque ${index + 1} para cima`} data-testid={`button-slide-up-${slide.id}`}><ArrowUp size={15} /></button>
                <button type="button" className="grid h-9 w-9 place-items-center rounded-full border border-border hover:bg-muted disabled:opacity-40" disabled={disabled || index === form.slides.length - 1} onClick={() => moveSlide(index, 1)} aria-label={`Mover destaque ${index + 1} para baixo`} data-testid={`button-slide-down-${slide.id}`}><ArrowDown size={15} /></button>
                <button type="button" className="grid h-9 w-9 place-items-center rounded-full border border-border text-destructive hover:bg-destructive/5 disabled:opacity-40" disabled={disabled} onClick={() => { if (window.confirm(`Remover o destaque ${index + 1}?`)) change({ ...form, slides: form.slides.filter(item => item.id !== slide.id) }); }} aria-label={`Remover destaque ${index + 1}`} data-testid={`button-slide-remove-${slide.id}`}><Trash2 size={15} /></button>
              </div>
            </header>
            <div className="grid gap-4 p-4 md:p-5">
              <label className="block text-xs font-bold">Texto alternativo da imagem<input className="field mt-1.5" maxLength={240} disabled={disabled} value={slide.alt} onChange={event => patchSlide(slide.id, { alt: event.target.value })} data-testid={`input-slide-alt-${slide.id}`} />{fieldError(slide.id, 'alt') && <span className="mt-1 block font-normal text-destructive">{fieldError(slide.id, 'alt')}</span>}</label>
              <div className="grid gap-4 md:grid-cols-2">
                <div><label className="block text-xs font-bold">Imagem desktop (URL)<input className="field mt-1.5" maxLength={2048} disabled={disabled} value={slide.imageUrl ?? ''} onChange={event => patchSlide(slide.id, { imageUrl: event.target.value || null })} placeholder="https://…" data-testid={`input-slide-image-${slide.id}`} /></label>{fieldError(slide.id, 'imageUrl') && <span className="mt-1 block text-xs text-destructive">{fieldError(slide.id, 'imageUrl')}</span>}<ImageUploadField value={slide.imageUrl ?? ''} imageRequirements={desktopBannerRequirements} onChange={imageUrl => patchSlide(slide.id, { imageUrl: imageUrl || null })} onUploadingChange={uploading => setPendingUploads(current => ({ ...current, [`${slide.id}-desktop`]: uploading }))} disabled={disabled} label={`Enviar imagem desktop ${index + 1}`} /></div>
                <div><label className="block text-xs font-bold">Imagem mobile (URL, opcional)<input className="field mt-1.5" maxLength={2048} disabled={disabled} value={slide.mobileImageUrl ?? ''} onChange={event => patchSlide(slide.id, { mobileImageUrl: event.target.value || null })} placeholder="https://…" data-testid={`input-slide-mobile-image-${slide.id}`} /></label>{fieldError(slide.id, 'mobileImageUrl') && <span className="mt-1 block text-xs text-destructive">{fieldError(slide.id, 'mobileImageUrl')}</span>}<ImageUploadField value={slide.mobileImageUrl ?? ''} imageRequirements={mobileBannerRequirements} onChange={mobileImageUrl => patchSlide(slide.id, { mobileImageUrl: mobileImageUrl || null })} onUploadingChange={uploading => setPendingUploads(current => ({ ...current, [`${slide.id}-mobile`]: uploading }))} disabled={disabled} label={`Enviar imagem mobile ${index + 1}`} /></div>
              </div>
              <label className="block text-xs font-bold">Link da imagem (opcional)<input className="field mt-1.5" maxLength={2048} disabled={disabled} value={slide.ctaHref ?? ''} onChange={event => patchSlide(slide.id, { ctaHref: event.target.value || null })} placeholder="/?featured=true ou https://…" data-testid={`input-slide-image-link-${slide.id}`} />{fieldError(slide.id, 'ctaHref') && <span className="mt-1 block font-normal text-destructive">{fieldError(slide.id, 'ctaHref')}</span>}<span className="mt-1 block text-xs font-normal text-muted-foreground">Quando preenchido, clicar na foto abre este destino.</span></label>
              {(slide.imageUrl || slide.mobileImageUrl) && <div className="grid gap-3 sm:grid-cols-2">
                {slide.imageUrl && isHttp(slide.imageUrl) && <figure><figcaption className="eyebrow mb-1">Prévia desktop · 16:9</figcaption><img src={slide.imageUrl} alt={slide.alt || 'Prévia desktop'} className="aspect-video w-full rounded-[18px] bg-muted object-cover" /></figure>}
                {slide.mobileImageUrl && isHttp(slide.mobileImageUrl) && <figure><figcaption className="eyebrow mb-1">Prévia mobile · 16:9</figcaption><img src={slide.mobileImageUrl} alt={slide.alt || 'Prévia mobile'} className="aspect-video w-full rounded-[18px] bg-muted object-cover" /></figure>}
              </div>}
            </div>
          </article>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Envie imagens JPG, PNG ou WebP para o Cloudflare R2, ou informe os endereços diretamente. As imagens enviadas ficam públicas. No máximo 8 slides podem ser cadastrados.</p>
      {!canManage && <p className="text-xs text-muted-foreground">Acesso somente para consulta. Você não pode alterar os destaques.</p>}
      {canManage && <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <span className="flex-1 text-sm text-muted-foreground" aria-live="polite">{dirty ? 'Alterações não salvas' : 'Tudo salvo'}</span>
        <button type="button" className="button button-outline" disabled={disabled || !dirty} onClick={() => { setForm(toBannerForm(q.data!)); setShowErrors(false); setFeedback(null); }} data-testid="button-cancel-banner">Descartar</button>
        <button className="button" disabled={disabled || uploadPending || !dirty} data-testid="button-save-banner">{save.isPending ? 'Salvando…' : uploadPending ? 'Aguarde o envio…' : 'Salvar destaques'}</button>
      </div>}
      {feedback && <Notice text={feedback.text} kind={feedback.ok ? 'success' : 'error'} />}
    </form>
  );
}

export function AdminContent() {
  return (
    <div className="grid gap-10">
      <section><h2 className="display text-2xl">Seções da página inicial</h2><p className="mb-4 mt-1 text-sm text-muted-foreground">Ordem, visibilidade, textos e produtos de cada seção.</p><HomepageLayoutEditor /></section>
      <section><h2 className="display text-2xl">Carrossel da página inicial</h2><p className="mb-4 mt-1 text-sm text-muted-foreground">Gerencie até oito destaques e a ordem em que aparecem no topo da vitrine.</p><BannerEditor /></section>
    </div>
  );
}
