import { userFacingError } from '@/lib/user-facing-errors';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetHomepageBanner, useUpdateHomepageBanner, getGetHomepageBannerQueryKey, useListProducts } from '@workspace/api-client-react';
import type { HomepageBanner, HomepageBannerSlide, HomepageBannerUpdate } from '@workspace/api-client-react';
import { ErrorState, Loading, Notice } from '@/components/feedback';
import { ImageUploadField } from '@/components/image-upload';
import { VideoUploadField } from '@/components/video-upload';
import { HomepageBannerPreview } from '@/components/catalog-home';
import { useCan } from '@/components/admin-permissions';
import { HomepageLayoutEditor } from '@/components/homepage-layout-editor';
import { useConfirmation } from '@/components/ui/confirmation-provider';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const errText = userFacingError;
const isHttp = (v: string) => {
  try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; }
  catch { return false; }
};
type BannerForm = { enabled: boolean; slides: HomepageBannerSlide[] };
const blankSlide = (): HomepageBannerSlide => ({ id: crypto.randomUUID(), enabled: false, title: '', description: '', imageUrl: null, mobileImageUrl: null, alt: '', ctaLabel: '', ctaHref: null, mediaType: 'image', videoUrl: null, mobileVideoUrl: null, posterUrl: null, mobilePosterUrl: null, imageDurationMs: 6000 });
const toBannerForm = (banner: HomepageBanner): BannerForm => ({ enabled: banner.enabled, slides: (banner.slides ?? []).map(slide => ({ mediaType: 'image', videoUrl: null, mobileVideoUrl: null, posterUrl: null, mobilePosterUrl: null, ...slide, imageDurationMs: 6000 })) });
const bannerProductId = (href: string | null) => href?.match(/^\/product\/([^/?#]+)/)?.[1] ?? '';
const demoSlides = (): HomepageBannerSlide[] => {
  const asset = (name: string) => new URL(`/demo/homepage/${name}`, window.location.origin).toString();
  return [
  { ...blankSlide(), id: 'demo-cinza-editorial', enabled: true, title: 'Uma nova fase da Loja Rádio 88', description: 'Conteúdo de demonstração para avaliação visual.', imageUrl: asset('cinza-desktop.png'), mobileImageUrl: asset('cinza-mobile.png'), alt: 'Fundo cinza de demonstração do carrossel Rádio 88.', ctaLabel: 'Explorar a loja', ctaHref: '/?view=catalog', imageDurationMs: 6000 },
  { ...blankSlide(), id: 'demo-estrelas-editorial', enabled: true, mediaType: 'video', title: 'Uma nova fase da Loja Rádio 88', description: 'Conteúdo de demonstração para avaliação visual.', videoUrl: asset('estrelas-desktop.mp4'), mobileVideoUrl: asset('estrelas-mobile.mp4'), posterUrl: asset('estrelas-poster-desktop.png'), mobilePosterUrl: asset('estrelas-poster-mobile.png'), alt: 'Estrelas brancas se movendo sobre fundo preto.', ctaLabel: 'Explorar a loja', ctaHref: '/?view=catalog' },
  ];
};
const validBannerHref = (value: string) => !/[\u0000-\u0020\\]/.test(value) && ((value.startsWith('/') && !value.startsWith('//')) || isHttp(value));
const validateBanner = (form: BannerForm) => {
  const errors: Record<string, string> = {};
  if (form.slides.length > 8) errors.slides = 'O limite é de 8 destaques.';
  if (form.enabled && !form.slides.some(slide => slide.enabled)) errors.slides = 'Ative ao menos um destaque ou desative a apresentação de banners.';
  form.slides.forEach(slide => {
    const key = (field: string) => `${slide.id}.${field}`;
    const urls = ['imageUrl', 'mobileImageUrl', 'videoUrl', 'mobileVideoUrl', 'posterUrl', 'mobilePosterUrl'] as const;
    for (const field of urls) if (slide[field]?.trim() && !isHttp(slide[field]!.trim())) errors[key(field)] = 'Use um endereço http:// ou https://.';
    if (form.enabled && slide.enabled && (slide.mediaType ?? 'image') === 'image' && !slide.imageUrl?.trim()) errors[key('imageUrl')] = 'Informe uma imagem desktop para este destaque ativo.';
    if (form.enabled && slide.enabled && slide.mediaType === 'video' && !slide.videoUrl?.trim()) errors[key('videoUrl')] = 'Envie o vídeo desktop deste destaque.';
    if (form.enabled && slide.enabled && slide.mediaType === 'video' && !slide.posterUrl?.trim()) errors[key('posterUrl')] = 'Informe uma imagem de capa para este vídeo.';
    if (form.enabled && slide.enabled && !slide.alt.trim()) errors[key('alt')] = 'Descreva o conteúdo no texto alternativo.';
    if (slide.ctaHref?.trim() && !validBannerHref(slide.ctaHref.trim())) errors[key('ctaHref')] = 'Use um caminho interno (/...) ou endereço http(s).';
    if (slide.ctaLabel.trim() && !slide.ctaHref?.trim()) errors[key('ctaLabel')] = 'Informe o destino do botão.';
  });
  return errors;
};

function BannerEditor() {
  const q = useGetHomepageBanner({ query: { queryKey: getGetHomepageBannerQueryKey() } });
  const products = useListProducts(undefined, { query: { queryKey: ['/api/products'], staleTime: 30_000 } });
  const qc = useQueryClient();
  const save = useUpdateHomepageBanner();
  const canManage = useCan('content:manage');
  const confirmAction = useConfirmation();
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
  const loadDemo = async () => {
    if (form.slides.length && dirty && !await confirmAction({
      title: 'Substituir o rascunho atual?',
      description: 'Os slides de demonstração vão substituir as alterações ainda não salvas. A demonstração será carregada apenas como rascunho.',
      confirmLabel: 'Substituir rascunho',
      destructive: true,
    })) return;
    change({ enabled: false, slides: demoSlides() });
    setShowErrors(false);
    toast.success('Demonstração carregada no rascunho. Salve para aplicar as alterações.');
  };
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
        mediaType: slide.mediaType ?? 'image',
        videoUrl: slide.videoUrl?.trim() || null,
        mobileVideoUrl: slide.mobileVideoUrl?.trim() || null,
        posterUrl: slide.posterUrl?.trim() || null,
        mobilePosterUrl: slide.mobilePosterUrl?.trim() || null,
        imageDurationMs: 6000,
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
        setFeedback(null);
        toast.success('Destaques salvos. A vitrine já está atualizada.');
      },
      onError: error => { setFeedback(null); toast.error(errText(error)); },
    });
  };
  const fieldError = (id: string, field: string) => showErrors ? errors[`${id}.${field}`] : undefined;
  return (
    <form onSubmit={submit} className="grid gap-4 rounded-[28px] bg-card p-4 shadow-soft md:gap-5 md:p-6" noValidate data-testid="form-homepage-banners">
      <label className="flex items-start gap-3 rounded-2xl bg-muted/60 p-4 text-sm">
        <input type="checkbox" className="mt-0.5 accent-black" disabled={disabled} checked={form.enabled} onChange={event => change({ ...form, enabled: event.target.checked })} data-testid="checkbox-banner-enabled" />
        <span><b className="block">Exibir destaques na página inicial</b><span className="mt-1 block text-xs text-muted-foreground">Quando não houver destaque ativo, a apresentação padrão da Rádio 88 FM continua visível.</span></span>
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div><h3 className="display text-xl">Slides da vitrine</h3><p className="mt-1 text-xs text-muted-foreground">{form.slides.length} de 8 posições · a ordem abaixo é a ordem de exibição</p></div>
        {canManage && <div className="flex flex-wrap gap-2"><button type="button" className="button button-outline" disabled={disabled || form.slides.length >= 8} onClick={() => change({ ...form, slides: [...form.slides, blankSlide()] })} data-testid="button-add-banner-slide"><Plus size={16} />Adicionar destaque</button><button type="button" className="button button-outline" disabled={disabled} onClick={loadDemo} data-testid="button-load-demo-banner">Carregar demonstração</button></div>}
      </div>
      {showErrors && errors.slides && <p className="text-sm text-destructive" role="alert">{errors.slides}</p>}
      <aside className="rounded-2xl border border-border bg-muted/40 p-4 text-sm" aria-label="Padrão das artes do carrossel">
        <h4 className="font-bold">Conteúdo de demonstração para avaliação visual</h4>
        <p className="mt-2">O botão “Carregar demonstração” inclui uma arte cinza e um vídeo próprio de estrelas sobre fundo preto. O conteúdo fica somente como rascunho e não é publicado automaticamente.</p>
        <p className="mt-2 text-xs text-muted-foreground">Envie a arte que tiver: não exigimos dimensões ou proporção específicas. O banner preenche a área em 2:1 no desktop e 4:5 no celular, recortando o centro; use uma imagem mobile separada quando a composição pedir outro enquadramento. JPG, PNG ou WebP até 8 MB. Vídeos MP4 H.264, sem áudio, até 15 segundos e 3,5 MiB.</p>
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
                <button type="button" className="grid h-9 w-9 place-items-center rounded-full border border-border text-destructive hover:bg-destructive/5 disabled:opacity-40" disabled={disabled} onClick={async () => {
                  const confirmed = await confirmAction({
                    title: `Remover destaque ${index + 1}?`,
                    description: 'O destaque será removido do rascunho. A alteração só aparece na loja depois de salvar.',
                    confirmLabel: 'Remover destaque',
                    destructive: true,
                  });
                  if (!confirmed) return;
                  change({ ...form, slides: form.slides.filter(item => item.id !== slide.id) });
                  toast.success('Destaque removido do rascunho. Salve para publicar.');
                }} aria-label={`Remover destaque ${index + 1}`} data-testid={`button-slide-remove-${slide.id}`}><Trash2 size={15} /></button>
              </div>
            </header>
            <div className="grid gap-4 p-4 md:p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-xs font-bold">Tipo de mídia<select className="field mt-1.5" disabled={disabled} value={slide.mediaType ?? 'image'} onChange={event => patchSlide(slide.id, { mediaType: event.target.value as 'image' | 'video' })} data-testid={`select-slide-media-${slide.id}`}><option value="image">Imagem</option><option value="video">Vídeo (MP4)</option></select></label>
                <label className="block text-xs font-bold">Título editorial (opcional)<input className="field mt-1.5" maxLength={120} disabled={disabled} value={slide.title} onChange={event => patchSlide(slide.id, { title: event.target.value })} placeholder="Ex.: A Rádio 88 acompanha você" data-testid={`input-slide-title-${slide.id}`} /><span className="mt-1 block font-normal text-muted-foreground">Aparece sobre a imagem, junto do texto e do botão.</span></label>
                <label className="block text-xs font-bold">Texto de apoio (opcional)<textarea className="field mt-1.5 min-h-24 resize-y" maxLength={400} disabled={disabled} value={slide.description} onChange={event => patchSlide(slide.id, { description: event.target.value })} placeholder="Uma frase curta sobre esta campanha" data-testid={`input-slide-description-${slide.id}`} /></label>
              </div>
              {fieldError(slide.id, 'ctaLabel') && <p className="-mt-2 text-xs font-normal text-destructive" role="alert">{fieldError(slide.id, 'ctaLabel')}</p>}
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block text-xs font-bold">Produto do botão (opcional)<select className="field mt-1.5" disabled={disabled || products.isLoading} value={bannerProductId(slide.ctaHref)} onChange={event => { const productId = event.target.value; patchSlide(slide.id, { ctaHref: productId ? `/product/${productId}` : null, ctaLabel: productId && !slide.ctaLabel.trim() ? 'Comprar' : slide.ctaLabel }); }} data-testid={`select-slide-product-${slide.id}`}><option value="">Selecione um produto</option>{products.data?.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select><span className="mt-1 block font-normal text-muted-foreground">O botão leva diretamente à página do produto escolhido.</span></label>
                <label className="block text-xs font-bold">Texto do botão (opcional)<input className="field mt-1.5" maxLength={60} disabled={disabled} value={slide.ctaLabel} onChange={event => patchSlide(slide.id, { ctaLabel: event.target.value })} placeholder="Comprar" data-testid={`input-slide-cta-label-${slide.id}`} /></label>
                <label className="block text-xs font-bold md:col-span-2">Destino personalizado (opcional)<input className="field mt-1.5" maxLength={2048} disabled={disabled} value={slide.ctaHref ?? ''} onChange={event => patchSlide(slide.id, { ctaHref: event.target.value || null })} placeholder="/caminho interno ou https://…" data-testid={`input-slide-cta-href-${slide.id}`} /><span className="mt-1 block font-normal text-muted-foreground">Use este campo para um destino que não seja um produto. Sem texto de botão, o destino continua aplicado à imagem.</span>{fieldError(slide.id, 'ctaHref') && <span className="mt-1 block font-normal text-destructive">{fieldError(slide.id, 'ctaHref')}</span>}</label>
              </div>
              <label className="block text-xs font-bold">Texto alternativo do conteúdo<input className="field mt-1.5" maxLength={240} disabled={disabled} value={slide.alt} onChange={event => patchSlide(slide.id, { alt: event.target.value })} data-testid={`input-slide-alt-${slide.id}`} />{fieldError(slide.id, 'alt') && <span className="mt-1 block font-normal text-destructive">{fieldError(slide.id, 'alt')}</span>}</label>
              {(slide.mediaType ?? 'image') === 'image' ? <div className="grid gap-4 md:grid-cols-2">
                <div><label className="block text-xs font-bold">Imagem desktop (URL)<input className="field mt-1.5" maxLength={2048} disabled={disabled} value={slide.imageUrl ?? ''} onChange={event => patchSlide(slide.id, { imageUrl: event.target.value || null })} placeholder="https://…" data-testid={`input-slide-image-${slide.id}`} /></label>{fieldError(slide.id, 'imageUrl') && <span className="mt-1 block text-xs text-destructive">{fieldError(slide.id, 'imageUrl')}</span>}<ImageUploadField value={slide.imageUrl ?? ''} onChange={imageUrl => patchSlide(slide.id, { imageUrl: imageUrl || null })} onUploadingChange={uploading => setPendingUploads(current => ({ ...current, [`${slide.id}-desktop`]: uploading }))} disabled={disabled} label={`Enviar imagem desktop ${index + 1}`} /></div>
                <div><label className="block text-xs font-bold">Imagem mobile (URL, opcional)<input className="field mt-1.5" maxLength={2048} disabled={disabled} value={slide.mobileImageUrl ?? ''} onChange={event => patchSlide(slide.id, { mobileImageUrl: event.target.value || null })} placeholder="https://…" data-testid={`input-slide-mobile-image-${slide.id}`} /></label>{fieldError(slide.id, 'mobileImageUrl') && <span className="mt-1 block text-xs text-destructive">{fieldError(slide.id, 'mobileImageUrl')}</span>}<ImageUploadField value={slide.mobileImageUrl ?? ''} onChange={mobileImageUrl => patchSlide(slide.id, { mobileImageUrl: mobileImageUrl || null })} onUploadingChange={uploading => setPendingUploads(current => ({ ...current, [`${slide.id}-mobile`]: uploading }))} disabled={disabled} label={`Enviar imagem mobile ${index + 1}`} /></div>
              </div> : <div className="grid gap-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div><b className="text-xs">Vídeo desktop</b>{fieldError(slide.id, 'videoUrl') && <span className="mt-1 block text-xs text-destructive">{fieldError(slide.id, 'videoUrl')}</span>}<VideoUploadField value={slide.videoUrl ?? ''} onChange={videoUrl => patchSlide(slide.id, { videoUrl })} onUploadingChange={uploading => setPendingUploads(current => ({ ...current, [`${slide.id}-video`]: uploading }))} disabled={disabled} label={`Enviar vídeo desktop ${index + 1}`} /></div>
                  <div><b className="text-xs">Vídeo mobile (opcional)</b><VideoUploadField value={slide.mobileVideoUrl ?? ''} onChange={mobileVideoUrl => patchSlide(slide.id, { mobileVideoUrl: mobileVideoUrl || null })} onUploadingChange={uploading => setPendingUploads(current => ({ ...current, [`${slide.id}-mobile-video`]: uploading }))} disabled={disabled} label={`Enviar vídeo mobile ${index + 1}`} /></div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div><label className="block text-xs font-bold">Poster desktop (URL)<input className="field mt-1.5" maxLength={2048} disabled={disabled} value={slide.posterUrl ?? ''} onChange={event => patchSlide(slide.id, { posterUrl: event.target.value || null })} placeholder="https://…" data-testid={`input-slide-poster-${slide.id}`} /></label>{fieldError(slide.id, 'posterUrl') && <span className="text-xs text-destructive">{fieldError(slide.id, 'posterUrl')}</span>}<ImageUploadField value={slide.posterUrl ?? ''} onChange={posterUrl => patchSlide(slide.id, { posterUrl: posterUrl || null })} onUploadingChange={uploading => setPendingUploads(current => ({ ...current, [`${slide.id}-poster`]: uploading }))} disabled={disabled} label={`Enviar poster desktop ${index + 1}`} /></div>
                  <div><label className="block text-xs font-bold">Poster mobile (URL, opcional)<input className="field mt-1.5" maxLength={2048} disabled={disabled} value={slide.mobilePosterUrl ?? ''} onChange={event => patchSlide(slide.id, { mobilePosterUrl: event.target.value || null })} placeholder="https://…" data-testid={`input-slide-mobile-poster-${slide.id}`} /></label><ImageUploadField value={slide.mobilePosterUrl ?? ''} onChange={mobilePosterUrl => patchSlide(slide.id, { mobilePosterUrl: mobilePosterUrl || null })} onUploadingChange={uploading => setPendingUploads(current => ({ ...current, [`${slide.id}-mobile-poster`]: uploading }))} disabled={disabled} label={`Enviar poster mobile ${index + 1}`} /></div>
                </div>
              </div>}
              {(slide.imageUrl || slide.mobileImageUrl) && (slide.mediaType ?? 'image') === 'image' && <div className="grid gap-3 sm:grid-cols-2">
                {slide.imageUrl && isHttp(slide.imageUrl) && <figure><figcaption className="eyebrow mb-1">Imagem desktop · recorte 2:1</figcaption><img src={slide.imageUrl} alt={slide.alt || 'Prévia desktop'} className="aspect-[2/1] w-full rounded-[18px] bg-muted object-cover" />{(slide.title || slide.description || (slide.ctaLabel && slide.ctaHref)) && <p className="mt-1 text-xs text-muted-foreground">O texto, a descrição e o botão aparecem sobre esta imagem.</p>}</figure>}
                {slide.mobileImageUrl && isHttp(slide.mobileImageUrl) && <figure><figcaption className="eyebrow mb-1">Imagem mobile · recorte 4:5</figcaption><img src={slide.mobileImageUrl} alt={slide.alt || 'Prévia mobile'} className="aspect-[4/5] w-full rounded-[18px] bg-muted object-cover" /></figure>}
              </div>}
            </div>
          </article>
        ))}
      </div>
      {form.slides.length > 0 && <section className="grid gap-3" aria-label="Prévia do carrossel"><div><h4 className="text-sm font-bold">Prévia local do rascunho</h4><p className="text-xs text-muted-foreground">A apresentação permanece privada até você ativá-la e salvar.</p></div><HomepageBannerPreview banner={form} /></section>}
      <p className="text-xs text-muted-foreground">Envie imagens JPG, PNG ou WebP para o Cloudflare R2, ou informe os endereços diretamente. O carrossel ajusta a arte ao quadro e mantém o texto sobre a imagem. Imagens enviadas ficam públicas. No máximo 8 slides podem ser cadastrados.</p>
      {!canManage && <p className="text-xs text-muted-foreground">Acesso somente para consulta. Você não pode alterar os destaques.</p>}
      {canManage && <div className="banner-save-bar">
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
