import { Link, useLocation, useSearch } from 'wouter';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useGetHomepageBanner, useGetHomepageLayout, getGetHomepageBannerQueryKey, getGetHomepageLayoutQueryKey, useListCategories, useListProducts } from '@workspace/api-client-react';
import type { Category, HomepageBanner, HomepageBannerSlide, HomepageLayout, HomepageSection, ListProductsParams, Product } from '@workspace/api-client-react';
import useEmblaCarousel from 'embla-carousel-react';
import { ArrowLeft, ArrowRight, ChevronDown, ChevronLeft, ChevronRight, Pause, Play, ShoppingBag, SlidersHorizontal } from 'lucide-react';
import { CategoryIconView } from '@/components/category-icon';
import { ProductCard, ProductRail, fromPrice } from '@/components/product-ui';
import { ErrorState, Loading } from '@/components/feedback';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { money } from '@/lib/format';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useStoreSearchOverlayOpen } from '@/components/layout';

const FRESH = 30_000;

function SmartLink({ href, className, children, testId }: { href: string; className?: string; children: React.ReactNode; testId?: string }) {
  if (href === '/#vitrine' || href === '#vitrine') return <Link href="/?view=catalog" className={className} data-testid={testId}>{children}</Link>;
  if (href.startsWith('/') && !href.startsWith('//')) return <Link href={href} className={className} data-testid={testId}>{children}</Link>;
  return <a href={href} className={className} rel="noopener noreferrer" data-testid={testId}>{children}</a>;
}

function BannerCta({ href, className, children }: { href?: string | null; className?: string; children: React.ReactNode }) {
  if (!href) return <>{children}</>;
  return <SmartLink href={href} className={className} testId="link-banner-cta">{children}</SmartLink>;
}

function Hero({ layout, bannerOverride, preview = false }: { layout: HomepageLayout; bannerOverride?: Pick<HomepageBanner, 'enabled' | 'slides'>; preview?: boolean }) {
  const q = useGetHomepageBanner({ query: { staleTime: FRESH, queryKey: getGetHomepageBannerQueryKey() } });
  const banner = bannerOverride ?? q.data;
  const slides: HomepageBannerSlide[] = useMemo(() => banner?.enabled ? (banner.slides ?? []).filter(slide => {
    if (!slide.enabled) return false;
    return (slide.mediaType ?? 'image') === 'video' ? Boolean(slide.videoUrl && slide.posterUrl) : Boolean(slide.imageUrl);
  }) : [], [banner?.enabled, banner?.slides]);
  const [carouselRef, api] = useEmblaCarousel({ loop: slides.length > 1, align: 'center', containScroll: false, duration: 32 });
  const [pageHidden, setPageHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const [inViewport, setInViewport] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const videoRefs = useRef(new Map<string, HTMLVideoElement>());
  const lastVideoId = useRef<string | null>(null);
  const searchOverlayOpen = useStoreSearchOverlayOpen();
  useEffect(() => {
    const update = () => setPageHidden(document.hidden);
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    const node = sectionRef.current;
    if (!node || !('IntersectionObserver' in window)) { setInViewport(true); return; }
    const observer = new IntersectionObserver(([entry]) => setInViewport(entry.isIntersecting), { threshold: 0.12 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [slides.length]);
  const [selected, setSelected] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  const [blockedSlideId, setBlockedSlideId] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const h = layout.hero;
  const center = h.alignment === 'center';
  const showCarousel = slides.length > 0;
  const activeSlide = slides[selected];
  const activeIsVideo = (activeSlide?.mediaType ?? 'image') === 'video';
  const carouselUnavailable = autoPaused || pageHidden || !inViewport || searchOverlayOpen;
  const paused = carouselUnavailable || (!activeIsVideo && ((hovered || focused) || reducedMotion));
  useEffect(() => {
    if (!api) return;
    const onSelect = () => setSelected(api.selectedScrollSnap());
    onSelect();
    api.on('select', onSelect);
    api.on('reInit', onSelect);
    return () => { api.off('select', onSelect); api.off('reInit', onSelect); };
  }, [api]);
  const nextSlide = () => { if (api && slides.length > 1) api.scrollNext(); };
  const previousSlide = () => { if (api && slides.length > 1) api.scrollPrev(); };
  useEffect(() => {
    if (!slides.length) { setSelected(0); return; }
    if (selected >= slides.length) api?.scrollTo(0);
  }, [api, selected, slides.length]);
  useEffect(() => {
    setBlockedSlideId(null);
  }, [activeSlide?.id]);
  useEffect(() => {
    if (!api || !showCarousel || slides.length <= 1 || paused || reducedMotion || activeIsVideo) return;
    const timer = window.setTimeout(() => api.scrollNext(), Math.min(15_000, Math.max(3_000, activeSlide?.imageDurationMs ?? 6_000)));
    return () => window.clearTimeout(timer);
  }, [activeIsVideo, activeSlide?.id, activeSlide?.imageDurationMs, api, paused, reducedMotion, showCarousel, slides.length]);
  useEffect(() => {
    for (const [id, video] of videoRefs.current) {
      if (id !== activeSlide?.id || !activeIsVideo) { video.pause(); continue; }
      const canPlay = !autoPaused && !pageHidden && inViewport && !searchOverlayOpen;
      if (!canPlay || blockedSlideId === id) { video.pause(); continue; }
      if (lastVideoId.current !== id || video.ended) {
        video.currentTime = 0;
        lastVideoId.current = id;
      }
      void video.play().then(() => setBlockedSlideId(current => current === id ? null : current)).catch(() => setBlockedSlideId(id));
    }
  }, [activeIsVideo, activeSlide?.id, autoPaused, blockedSlideId, inViewport, pageHidden, searchOverlayOpen]);
  useEffect(() => {
    if (!api || !activeIsVideo || !activeSlide || blockedSlideId !== activeSlide.id || paused || slides.length < 2) return;
    const timer = window.setTimeout(() => api.scrollNext(), 6_000);
    return () => window.clearTimeout(timer);
  }, [activeIsVideo, activeSlide?.id, api, blockedSlideId, paused, slides.length]);
  const [mobileViewport, setMobileViewport] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setMobileViewport(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  if (!bannerOverride && q.isLoading) return <section className="shell pt-6"><Loading label="Carregando apresentação da loja" /></section>;
  if (!bannerOverride && q.isError) return <section className="shell pt-6"><ErrorState retry={() => q.refetch()} message="Não foi possível carregar a apresentação da loja." /></section>;
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); previousSlide(); }
    if (event.key === 'ArrowRight') { event.preventDefault(); nextSlide(); }
  };
  const renderSlide = (slide: HomepageBannerSlide, index: number) => {
    const hasCopy = Boolean(slide.title?.trim() || slide.description?.trim() || slide.ctaLabel?.trim());
    const isVideo = (slide.mediaType ?? 'image') === 'video';
    const media = isVideo ? (
        <video
          ref={element => { if (element) videoRefs.current.set(slide.id, element); else videoRefs.current.delete(slide.id); }}
          className="hero88-img hero88-video"
          poster={mobileViewport && slide.mobilePosterUrl ? slide.mobilePosterUrl : slide.posterUrl ?? undefined}
          muted
          playsInline
          preload={index === selected ? 'auto' : 'none'}
          loop={false}
          aria-hidden="true"
          data-testid={`video-banner-${slide.id}`}
          onError={() => setBlockedSlideId(slide.id)}
          onEnded={() => { if (!carouselUnavailable && slides.length > 1) api?.scrollNext(); }}
        >
          {slide.mobileVideoUrl && <source media="(max-width: 767px)" src={slide.mobileVideoUrl} type="video/mp4" />}
          <source src={slide.videoUrl ?? ''} type="video/mp4" />
        </video>
    ) : (
      <picture>
        {slide.mobileImageUrl && <source media="(max-width: 767px)" srcSet={slide.mobileImageUrl} />}
        <img src={slide.imageUrl ?? ''} alt={slide.alt} className="hero88-img" data-testid={`img-banner-${slide.id}`} />
      </picture>
    );
    const playButton = isVideo && blockedSlideId === slide.id
      ? <button type="button" className="hero88-video-play" onClick={() => { setAutoPaused(false); setBlockedSlideId(null); const video = videoRefs.current.get(slide.id); if (video) { video.currentTime = 0; void video.play().catch(() => setBlockedSlideId(slide.id)); } }} aria-label="Reproduzir vídeo do destaque" data-testid={`button-play-banner-${slide.id}`}><Play size={20} /><span>Reproduzir vídeo</span></button>
      : null;
    return (
      <div className="hero88-slide" role="group" aria-roledescription="slide" aria-label={`${index + 1} de ${slides.length || 1}`} key={slide.id}>
        <article className={`hero88-editorial-card${hasCopy ? ' has-copy' : ''}`}>
          <div className={`hero88-card${slide.mobileImageUrl || slide.mobileVideoUrl || slide.mobilePosterUrl ? ' has-mobile-image' : ''}`}><BannerCta href={slide.ctaHref} className="hero88-media-link">{media}</BannerCta>{playButton}</div>
          {hasCopy && <div className="hero88-content">
            {slide.title?.trim() && <h2>{slide.title}</h2>}
            {slide.description?.trim() && <p>{slide.description}</p>}
            {slide.ctaLabel?.trim() && slide.ctaHref && <SmartLink href={slide.ctaHref} className="hero88-content-link" testId={`link-banner-copy-cta-${slide.id}`}>{slide.ctaLabel}<ArrowRight size={16} /></SmartLink>}
          </div>}
        </article>
      </div>
    );
  };
  if (showCarousel) {
    const pauseOnBlur = (event: React.FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
    };
    return (
      <section
        ref={sectionRef}
        role="region"
        aria-roledescription="carousel"
        aria-label="Destaques da Rádio 88 FM"
        className="hero88"
        data-testid="section-hero"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={pauseOnBlur}
        onKeyDown={onKeyDown}
      >
        {preview && <div className="hero88-preview-label" role="status">Prévia local · ainda não publicada</div>}
        <div className="hero88-stage">
          <div className="hero88-viewport" ref={carouselRef}>
            <div className="hero88-track">{slides.map(renderSlide)}</div>
          </div>
        {(slides.length > 1 || activeIsVideo) && (
          <div className={`hero88-media-controls${activeSlide?.mobileImageUrl || activeSlide?.mobileVideoUrl || activeSlide?.mobilePosterUrl ? ' has-mobile-media' : ''}`}>
            {slides.length > 1 && <div className="hero88-indicators" aria-label="Posição do carrossel">{slides.map((slide, index) => <button type="button" key={slide.id} className={index === selected ? 'is-selected' : ''} aria-label={`Ir para o destaque ${index + 1}`} aria-current={index === selected ? 'true' : undefined} onClick={() => api?.scrollTo(index)} data-testid={`button-banner-slide-${index + 1}`}><span /></button>)}</div>}
            <div className="hero88-controls" role="group" aria-label="Controles dos destaques">
              <button type="button" className="hero88-arrow hero88-play-toggle" aria-pressed={autoPaused} onClick={() => setAutoPaused(value => !value)} aria-label={autoPaused ? activeIsVideo ? 'Retomar vídeo do destaque' : 'Retomar rotação automática' : activeIsVideo ? 'Pausar vídeo do destaque' : 'Pausar rotação automática'} data-testid="button-banner-autoplay">{autoPaused ? <Play size={20} /> : <Pause size={20} />}</button>
              {slides.length > 1 && <button type="button" className="hero88-arrow" onClick={previousSlide} aria-label="Destaque anterior" data-testid="button-banner-previous"><ChevronLeft size={24} /></button>}
              {slides.length > 1 && <button type="button" className="hero88-arrow" onClick={nextSlide} aria-label="Próximo destaque" data-testid="button-banner-next"><ChevronRight size={24} /></button>}
            </div>
          </div>
        )}
        </div>
      </section>
    );
  }
  return (
    <section aria-label="Apresentação" className="shell pt-6" data-testid="section-hero">
      <div className={`hero88-fallback ${center ? 'text-center' : ''}`} data-testid="hero-text">
        <div className="eyebrow">LOJA OFICIAL · RÁDIO 88 FM</div>
        <h1 className={`display mt-3 max-w-3xl text-4xl md:text-6xl ${center ? 'mx-auto' : ''}`} style={{ fontSize: 'clamp(36px, 5vw, 60px)' }}>{h.title}</h1>
        {h.description && <p className={`mt-4 max-w-xl text-base text-muted-foreground ${center ? 'mx-auto' : ''}`}>{h.description}</p>}
        <div className={`mt-7 flex flex-wrap gap-3 ${center ? 'justify-center' : ''}`}>
          <SmartLink href={h.ctaHref} className="button" testId="link-hero-cta">{h.ctaLabel}<ArrowRight size={16} /></SmartLink>
        </div>
      </div>
    </section>
  );
}

export function HomepageBannerPreview({ banner }: { banner: Pick<HomepageBanner, 'enabled' | 'slides'> }) {
  const layout = useGetHomepageLayout({ query: { queryKey: getGetHomepageLayoutQueryKey() } });
  if (layout.isLoading) return <Loading label="Carregando a prévia do carrossel" />;
  if (layout.isError || !layout.data) return <ErrorState retry={() => layout.refetch()} message="Não foi possível carregar a prévia do carrossel." />;
  const previewBanner = { enabled: true, slides: banner.slides.map(slide => ({ ...slide, enabled: true })) };
  return <Hero layout={layout.data} bannerOverride={previewBanner} preview />;
}

function Empty({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return <div className="rounded-[28px] bg-card px-6 py-12 text-center shadow-soft"><ShoppingBag className="mx-auto" aria-hidden="true" /><h3 className="display mt-4 text-xl">{title}</h3><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{text}</p>{action}</div>;
}

const GRID: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 md:grid-cols-3',
  4: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
};
const gridClass = (c: number) => GRID[c] ?? GRID[4];

function pick(section: HomepageSection, all: Product[], featuredOnly: boolean) {
  let list: Product[];
  if (section.productIds.length) {
    const byId = new Map(all.map(p => [p.id, p]));
    list = section.productIds.map(id => byId.get(id)).filter((p): p is Product => !!p);
  } else {
    list = featuredOnly ? all.filter(p => p.featured) : all;
  }
  if (section.categoryIds.length) list = list.filter(p => p.categoryId && section.categoryIds.includes(p.categoryId));
  return list.slice(0, section.limit);
}

function ProductSection({ section, products, preview }: { section: HomepageSection; products: { data?: Product[]; isLoading: boolean; isError: boolean; refetch: () => unknown }; preview?: boolean }) {
  const isFeatured = section.id === 'featured';
  const titleId = `${section.id}-titulo`;
  const list = pick(section, products.data ?? [], isFeatured);
  if (isFeatured && !preview && !products.isLoading && !products.isError && !list.length) return null;
  if (section.id === 'catalog') return (
    <section id="vitrine" className="home-catalog-entry shell" aria-labelledby={titleId} data-testid="section-catalog">
      <div><div className="eyebrow">ENCONTRE SUA PRÓXIMA PEÇA</div><h2 id={titleId}>{section.title}</h2>{section.description && <p>{section.description}</p>}</div>
      <Link href={preview ? '#' : '/?view=catalog'} className="home-editorial-link" data-testid="link-open-full-catalog">Explorar toda a loja <ArrowRight size={17} /></Link>
    </section>
  );
  return (
    <section id={isFeatured ? 'destaques' : 'vitrine'} className="shell mt-14 scroll-mt-36 lg:scroll-mt-20" aria-labelledby={titleId} data-testid={`section-${section.id}`}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><h2 id={titleId} className="display text-xl">{section.title}</h2>{section.description && <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>}</div>
        {isFeatured && <Link href={preview ? '#' : '/?view=catalog&featured=true'} className="text-sm underline" data-testid="link-see-featured">Ver todos</Link>}
      </div>
      {products.isLoading ? <Loading /> : products.isError ? <ErrorState retry={() => products.refetch()} /> : list.length
        ? isFeatured
          ? <ProductRail products={list.slice(0, Math.min(section.limit, 12))} title={section.title} />
          : <div className={`grid gap-3 ${gridClass(section.columns)}`}>{list.map(p => <ProductCard key={p.id} product={p} />)}</div>
        : <Empty title={isFeatured ? 'Nenhum destaque por enquanto' : 'Estamos preparando a vitrine'} text={isFeatured ? 'Os produtos escolhidos pela equipe aparecem aqui.' : 'Ainda não há produtos para esta seção.'} />}
    </section>
  );
}

function CategoriesSection({ section, preview, products = [] }: { section: HomepageSection; preview?: boolean; products?: Product[] }) {
  const categories = useListCategories();
  let list: Category[] = categories.data ?? [];
  if (section.categoryIds.length) list = section.categoryIds.map(id => list.find(c => c.id === id)).filter((c): c is Category => !!c);
  list = list.slice(0, section.limit);
  return (
    <section id="categorias" className="shell mt-14" aria-labelledby="categorias-titulo" data-testid="section-categories">
      <h2 id="categorias-titulo" className="display text-xl">{section.title}</h2>
      {section.description && <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>}
      <div className="mt-5">
        {categories.isLoading ? <Loading /> : categories.isError ? <ErrorState retry={() => categories.refetch()} message="Categorias indisponíveis no momento." /> : !list.length ? <Empty title="Categorias em breve" text="Quando a equipe cadastrar categorias, elas aparecem aqui." /> : (
          <div className="home-category-grid">
            {list.map(c => {
              const image = products.find(product => product.categoryId === c.id && product.imageUrl)?.imageUrl;
              return <Link key={c.id} href={preview ? '#' : `/?categoryId=${encodeURIComponent(c.id)}`} data-testid={`card-category-${c.id}`} className="home-category-tile">
                {image ? <img src={image} alt="" loading="lazy" decoding="async" /> : <span className="home-category-icon"><CategoryIconView category={c} size={28} /></span>}
                <span className="home-category-shade" aria-hidden="true" />
                <span className="home-category-copy"><b>{c.name}</b><span>Explorar <ArrowRight size={15} /></span></span>
              </Link>;
            })}
          </div>
        )}
      </div>
    </section>
  );
}

/** Shared renderer used by the public homepage and the admin preview. */
export function HomepageSections({ layout, preview }: { layout: HomepageLayout; preview?: boolean }) {
  const products = useListProducts(undefined, { query: { staleTime: FRESH, queryKey: ['/api/products'] } });
  return <div className={`store-home${preview ? ' is-preview' : ''}`}>
    {layout.sections.filter(s => s.enabled).map(s => {
      if (s.id === 'hero') return <Hero key={s.id} layout={layout} />;
      if (s.id === 'categories') return <CategoriesSection key={s.id} section={s} preview={preview} products={products.data ?? []} />;
      return <ProductSection key={s.id} section={s} products={products} preview={preview} />;
    })}
    <section className="home-service-links shell" aria-label="Serviços da loja">
      <Link href="/orders"><span>01</span><b>Meus pedidos</b><ArrowRight size={17} /></Link>
      <Link href="/returns"><span>02</span><b>Trocas e devoluções</b><ArrowRight size={17} /></Link>
      <Link href="/contact"><span>03</span><b>Fale com a Rádio 88</b><ArrowRight size={17} /></Link>
    </section>
  </div>;
}

type Sort = '' | 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc';
type FilterDraft = {
  query: string;
  categoryId: string;
  pieceType: string;
  sizes: string[];
  minPrice: string;
  maxPrice: string;
  available: boolean;
  featured: boolean;
};

const filterDraftFromSearch = (search: string): FilterDraft => {
  const sp = new URLSearchParams(search);
  return {
    query: sp.get('q') ?? '',
    categoryId: sp.get('categoryId') ?? '',
    pieceType: sp.get('pieceType') ?? '',
    sizes: (sp.get('sizes') ?? '').split('|').filter(Boolean),
    minPrice: sp.get('minPrice') ?? '',
    maxPrice: sp.get('maxPrice') ?? '',
    available: sp.get('availability') === 'in_stock',
    featured: sp.get('featured') === 'true',
  };
};

const SORTS: { v: Sort; l: string }[] = [
  { v: '', l: 'Relevância' }, { v: 'name-asc', l: 'Nome (A-Z)' }, { v: 'name-desc', l: 'Nome (Z-A)' },
  { v: 'price-asc', l: 'Menor preço' }, { v: 'price-desc', l: 'Maior preço' },
];
const isSoldOut = (p: Product) => !p.variants.some(v => v.stock > 0);

function FilterFields({
  draft,
  setDraft,
  categories,
  productTypes,
  sizeOptions,
  invalidRange,
  onReset,
}: {
  draft: FilterDraft;
  setDraft: React.Dispatch<React.SetStateAction<FilterDraft>>;
  categories: Category[];
  productTypes: string[];
  sizeOptions: string[];
  invalidRange: boolean;
  onReset: () => void;
}) {
  const patch = <K extends keyof FilterDraft>(key: K, value: FilterDraft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const priceSelectionCount = Number(!!draft.minPrice) + Number(!!draft.maxPrice);
  const availabilitySelectionCount = Number(draft.featured) + Number(draft.available);
  return <>
    <div className="catalog-filter-form-heading">
      <h2>Filtros</h2>
      <button type="button" className="catalog-filter-reset" onClick={onReset}>Limpar rascunho</button>
    </div>
    <label className="catalog-filter-search">Buscar<input name="q" className="field" value={draft.query} onChange={event => patch('query', event.target.value)} placeholder="Nome ou descrição" data-testid="input-filter-search" /></label>
    <details className="catalog-filter-group">
      <summary><span>Categoria</span>{draft.categoryId && <span className="catalog-filter-count">(1)</span>}</summary>
      <label className="catalog-filter-select-label">Escolha uma categoria
        <select name="categoryId" className="field" value={draft.categoryId} onChange={event => patch('categoryId', event.target.value)} data-testid="select-filter-category">
          <option value="">Todas</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>
    </details>
    <details className="catalog-filter-group">
      <summary><span>Tipo de produto</span>{draft.pieceType && <span className="catalog-filter-count">(1)</span>}</summary>
      <label className="catalog-filter-select-label"><span className="sr-only">Escolha um tipo de produto</span>
        <select name="pieceType" className="field" value={draft.pieceType} onChange={event => patch('pieceType', event.target.value)} data-testid="select-filter-piece-type">
          <option value="">Todos</option>{productTypes.map(type => <option key={type} value={type}>{type}</option>)}
        </select>
      </label>
    </details>
    {sizeOptions.length > 0 && <details className="catalog-filter-group">
      <summary><span>Tamanho</span>{draft.sizes.length > 0 && <span className="catalog-filter-count">({draft.sizes.length})</span>}</summary>
      <div className="catalog-size-options" role="group" aria-label="Tamanhos disponíveis">
        {sizeOptions.map(size => <label key={size} className="catalog-filter-check">
          <input type="checkbox" name="sizes" value={size} checked={draft.sizes.includes(size)} onChange={() => setDraft(current => ({ ...current, sizes: current.sizes.includes(size) ? current.sizes.filter(value => value !== size) : [...current.sizes, size] }))} />
          <span>{size}</span>
        </label>)}
      </div>
    </details>}
    <details className="catalog-filter-group">
      <summary><span>Preço</span>{priceSelectionCount > 0 && <span className="catalog-filter-count">({priceSelectionCount})</span>}</summary>
      <div className="catalog-price-fields">
        <label>De (R$)<input name="minPrice" type="number" min="0" step="0.01" inputMode="decimal" className="field" value={draft.minPrice} onChange={event => patch('minPrice', event.target.value)} data-testid="input-filter-min" /></label>
        <label>Até (R$)<input name="maxPrice" type="number" min="0" step="0.01" inputMode="decimal" className="field" value={draft.maxPrice} onChange={event => patch('maxPrice', event.target.value)} data-testid="input-filter-max" /></label>
      </div>
    </details>
    <details className="catalog-filter-group">
      <summary><span>Disponibilidade</span>{availabilitySelectionCount > 0 && <span className="catalog-filter-count">({availabilitySelectionCount})</span>}</summary>
      <div className="catalog-filter-more">
        <label className="catalog-filter-check"><input name="featured" type="checkbox" checked={draft.featured} onChange={event => patch('featured', event.target.checked)} data-testid="checkbox-filter-featured" /><span>Somente destaques</span></label>
        <label className="catalog-filter-check"><input name="availability" type="checkbox" checked={draft.available} onChange={event => patch('available', event.target.checked)} data-testid="checkbox-filter-available" /><span>Somente disponíveis</span></label>
      </div>
    </details>
    <div className="catalog-filter-actions">
      <button type="submit" className="button" disabled={invalidRange} data-testid="button-apply-filters">Aplicar filtros</button>
      {invalidRange && <p role="alert">O preço mínimo é maior que o máximo; nenhum produto vai corresponder.</p>}
    </div>
  </>;
}

function Results() {
  const categories = useListCategories();
  const search = useSearch();
  const [, go] = useLocation();
  const sp = new URLSearchParams(search);
  const query = sp.get('q') ?? ''; const cat = sp.get('categoryId') ?? ''; const featuredOnly = sp.get('featured') === 'true';
  const pieceType = sp.get('pieceType') ?? '';
  const selectedSizes = (sp.get('sizes') ?? '').split('|').filter(Boolean);
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches);
  const [desktopFiltersOpen, setDesktopFiltersOpen] = useState(() => sp.get('filters') === '1');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [draft, setDraft] = useState(() => filterDraftFromSearch(search));
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const update = () => setIsNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const open = new URLSearchParams(search).get('filters') === '1';
    setDraft(filterDraftFromSearch(search));
    setDesktopFiltersOpen(open && !isNarrow);
    setFilterSheetOpen(open && isNarrow);
  }, [search, isNarrow]);
  const minPrice = sp.get('minPrice') ?? ''; const maxPrice = sp.get('maxPrice') ?? '';
  const avail = sp.get('availability') === 'in_stock'; const sort = (sp.get('sort') ?? '') as Sort;
  const num = (v: string) => (v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined);
  const facetParams: ListProductsParams = {
    ...(query ? { search: query } : {}), ...(cat ? { categoryId: cat } : {}), ...(featuredOnly ? { featured: true } : {}),
  };
  const params: ListProductsParams = {
    ...facetParams,
    ...(num(minPrice) !== undefined ? { minPrice: num(minPrice) } : {}), ...(num(maxPrice) !== undefined ? { maxPrice: num(maxPrice) } : {}),
    ...(pieceType ? { pieceType } : {}),
    ...(selectedSizes.length ? { sizes: selectedSizes.join('|') } : {}),
    ...(avail ? { inStock: true } : {}),
  };
  const facets = useListProducts(facetParams, { query: { staleTime: FRESH, queryKey: ['/api/products', facetParams] } });
  const products = useListProducts(params, { query: { staleTime: FRESH, queryKey: ['/api/products', params] } });
  let list = [...(products.data ?? [])];
  if (avail) list = list.filter(p => !isSoldOut(p));
  const cmpPrice = (a: Product, b: Product) => (fromPrice(a) ?? Infinity) - (fromPrice(b) ?? Infinity);
  if (sort === 'name-asc') list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  if (sort === 'name-desc') list.sort((a, b) => b.name.localeCompare(a.name, 'pt-BR'));
  if (sort === 'price-asc') list.sort(cmpPrice);
  if (sort === 'price-desc') list.sort((a, b) => -cmpPrice(a, b));
  const catList: Category[] = categories.data ?? [];
  const facetProducts = facets.data ?? [];
  const productTypes = [...new Set(facetProducts.map(product => product.pieceType?.trim()).filter((type): type is string => !!type))]
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
  const hasClothingSizes = (product: Product) => /camis|blusa|roupa|calca|vestid|short|sapato|tenis|moletom|jaqueta|meia/.test(fold(`${product.pieceType ?? ''} ${product.categoryName ?? ''}`));
  const sizeOrder: Record<string, number> = { PP: 0, XS: 0, P: 1, S: 1, M: 2, G: 3, L: 3, GG: 4, XL: 4, XG: 5, XXL: 6, EGG: 7 };
  const sizeOptions = [...new Set(facetProducts
    .filter(hasClothingSizes)
    .flatMap(product => product.variants.map(variant => variant.size?.trim() ?? '').filter(size => size && !['unico', 'u', 'one size'].includes(fold(size)))))]
    .sort((a, b) => {
      const rankA = sizeOrder[a.toUpperCase()];
      const rankB = sizeOrder[b.toUpperCase()];
      return rankA !== undefined && rankB !== undefined && rankA !== rankB
        ? rankA - rankB
        : a.localeCompare(b, 'pt-BR', { numeric: true });
    });
  const activeCat = catList.find(c => c.id === cat);
  const patch = (p: Record<string, string>) => {
    const n = new URLSearchParams(search);
    Object.entries(p).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
    n.set('view', 'catalog');
    const s = n.toString();
    go(s ? `/?${s}` : '/');
  };
  const setFilterVisibility = (open: boolean) => {
    const n = new URLSearchParams(search);
    n.set('view', 'catalog');
    if (open) n.set('filters', '1'); else n.delete('filters');
    go(`/?${n.toString()}`);
    setDesktopFiltersOpen(open && !isNarrow);
    setFilterSheetOpen(open && isNarrow);
    if (!open) setDraft(filterDraftFromSearch(search));
  };
  const openFilters = () => setFilterVisibility(true);
  const closeFilters = () => setFilterVisibility(false);
  const resetDraft = () => setDraft(filterDraftFromSearch(''));
  const invalidRange = num(draft.minPrice) !== undefined && num(draft.maxPrice) !== undefined && num(draft.minPrice)! > num(draft.maxPrice)!;
  const applyDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (invalidRange) return;
    patch({
      q: draft.query.trim(),
      categoryId: draft.categoryId,
      pieceType: draft.pieceType,
      sizes: draft.sizes.join('|'),
      minPrice: draft.minPrice,
      maxPrice: draft.maxPrice,
      availability: draft.available ? 'in_stock' : '',
      featured: draft.featured ? 'true' : '',
      filters: '',
    });
    setDesktopFiltersOpen(false);
    setFilterSheetOpen(false);
  };
  const clearFilters = () => {
    patch({ categoryId: '', featured: '', minPrice: '', maxPrice: '', availability: '', sort: '', pieceType: '', sizes: '', filters: '' });
    setDesktopFiltersOpen(false);
    setFilterSheetOpen(false);
  };
  const hasAppliedFilters = !!(cat || featuredOnly || minPrice || maxPrice || avail || sort || pieceType || selectedSizes.length);
  const activeFilterCount = [cat, featuredOnly, minPrice, maxPrice, avail, pieceType, selectedSizes.length > 0].filter(Boolean).length;
  const title = query ? `Resultados para “${query}”` : activeCat ? activeCat.name : featuredOnly ? 'Em destaque' : 'Toda a vitrine';
  const chips: { key: string; label: string; remove: () => void }[] = [];
  if (query) chips.push({ key: 'query', label: `Busca: ${query}`, remove: () => patch({ q: '' }) });
  if (activeCat) chips.push({ key: 'category', label: activeCat.name, remove: () => patch({ categoryId: '' }) });
  if (pieceType) chips.push({ key: 'pieceType', label: pieceType, remove: () => patch({ pieceType: '' }) });
  if (minPrice || maxPrice) chips.push({ key: 'price', label: `${minPrice ? `De ${money(Number(minPrice))}` : 'Até'}${maxPrice ? ` até ${money(Number(maxPrice))}` : ''}`, remove: () => patch({ minPrice: '', maxPrice: '' }) });
  selectedSizes.forEach(size => chips.push({ key: `size-${size}`, label: `Tamanho ${size}`, remove: () => patch({ sizes: selectedSizes.filter(value => value !== size).join('|') }) }));
  if (avail) chips.push({ key: 'availability', label: 'Disponíveis', remove: () => patch({ availability: '' }) });
  if (featuredOnly) chips.push({ key: 'featured', label: 'Em destaque', remove: () => patch({ featured: '' }) });
  const sortValue: Sort = SORTS.some(option => option.v === sp.get('sort')) ? sp.get('sort') as Sort : '';
  const onSheetOpenChange = (open: boolean) => open ? openFilters() : closeFilters();
  const form = <FilterFields draft={draft} setDraft={setDraft} categories={catList} productTypes={productTypes} sizeOptions={sizeOptions} invalidRange={invalidRange} onReset={resetDraft} />;
  return (
    <section id="vitrine" className="shell scroll-mt-36 pt-8 lg:scroll-mt-20" aria-labelledby="resultados">
      <div className={`catalog-results-layout${desktopFiltersOpen && !isNarrow ? ' is-filter-open' : ''}`}>
        {desktopFiltersOpen && !isNarrow && <aside className="catalog-filter-sidebar" aria-label="Filtros de catálogo" data-testid="catalog-filter-sidebar">
          <form id="catalog-filter-form" className="catalog-filter-form is-open" data-testid="form-filters" onSubmit={applyDraft}>{form}</form>
        </aside>}
        <div className="catalog-results">
          <div className="catalog-results-heading">
            <div><h1 id="resultados" className="display text-2xl" aria-live="polite" data-testid="text-result-count">{title}</h1>{!products.isLoading && !products.isError && <p className="catalog-results-count">{list.length} {list.length === 1 ? 'produto' : 'produtos'}</p>}</div>
            <div className="catalog-results-toolbar">
              <button type="button" className="catalog-toolbar-filter" aria-expanded={isNarrow ? filterSheetOpen : desktopFiltersOpen} aria-controls={(isNarrow ? filterSheetOpen : desktopFiltersOpen) ? isNarrow ? 'catalog-filter-form-mobile' : 'catalog-filter-form' : undefined} onClick={() => (isNarrow ? filterSheetOpen : desktopFiltersOpen) ? closeFilters() : openFilters()} data-testid="button-toggle-filters"><SlidersHorizontal size={20} strokeWidth={1.8} /><span>Filtros{activeFilterCount ? ` (${activeFilterCount})` : ''}</span><ChevronDown size={16} aria-hidden="true" /></button>
              <div className="catalog-sort-control"><span>Ordenar por</span><Select value={sortValue || 'relevance'} onValueChange={value => patch({ sort: value === 'relevance' ? '' : value })}>
                <SelectTrigger className="catalog-sort-trigger" aria-label="Ordenar produtos" data-testid="select-filter-sort"><SelectValue /></SelectTrigger>
                <SelectContent className="catalog-sort-menu" align="end">
                  {SORTS.map(option => <SelectItem key={option.v || 'relevance'} value={option.v || 'relevance'}>{option.l}</SelectItem>)}
                </SelectContent>
              </Select></div>
              {hasAppliedFilters && <button className="catalog-clear-button" onClick={clearFilters} data-testid="button-clear-filters">Limpar filtros</button>}
            </div>
          </div>
          {!!chips.length && <div className="catalog-active-chips" aria-label="Filtros aplicados">{chips.map(chip => <button key={chip.key} type="button" onClick={chip.remove} aria-label={`Remover filtro ${chip.label}`} data-testid={`chip-filter-${chip.key}`}>{chip.label}<span aria-hidden="true">×</span></button>)}</div>}
          {products.isLoading ? <Loading /> : products.isError ? <ErrorState retry={() => products.refetch()} /> : list.length
            ? <div className="catalog-product-grid">{list.map(p => <ProductCard key={p.id} product={p} />)}</div>
            : <Empty title="Nenhum resultado por aqui" text="Tente outra busca, ajuste o preço, o tamanho ou escolha uma categoria diferente." action={<div className="catalog-empty-actions">{(cat || featuredOnly || minPrice || maxPrice || avail || sort || pieceType || selectedSizes.length > 0) && <button className="button button-outline mt-5" onClick={clearFilters}>Limpar filtros</button>}{query && <button className="button button-outline mt-5" onClick={() => patch({ q: '' })}>Limpar busca</button>}</div>} />}
        </div>
      </div>
      <Sheet open={filterSheetOpen && isNarrow} onOpenChange={onSheetOpenChange}>
        <SheetContent side="left" className="catalog-filter-sheet-content" aria-describedby="catalog-filter-sheet-description">
          <SheetHeader className="catalog-filter-sheet-header"><SheetTitle>Filtrar produtos</SheetTitle><SheetDescription id="catalog-filter-sheet-description">Ajuste os filtros e aplique para atualizar a vitrine.</SheetDescription></SheetHeader>
          <div className="catalog-filter-sheet-cancel"><button type="button" className="catalog-filter-reset" onClick={closeFilters}>Cancelar e descartar alterações</button></div>
          <form id="catalog-filter-form-mobile" className="catalog-filter-form is-open catalog-filter-sheet-form" data-testid="form-filters-mobile" onSubmit={applyDraft}>{form}</form>
        </SheetContent>
      </Sheet>
    </section>
  );
}

export function Catalog({ configOverride, preview }: { configOverride?: HomepageLayout; preview?: boolean } = {}) {
  const search = useSearch();
  const layoutQ = useGetHomepageLayout({ query: { staleTime: FRESH, queryKey: getGetHomepageLayoutQueryKey(), enabled: !configOverride } });
  if (configOverride) return <main><HomepageSections layout={configOverride} preview={preview} /></main>;
  const sp = new URLSearchParams(search);
  const filtering = sp.get('view') === 'catalog' || ['q', 'categoryId', 'featured', 'minPrice', 'maxPrice', 'availability', 'sort', 'pieceType', 'sizes'].some(k => sp.has(k)) || sp.get('filters') === '1';
  if (filtering) return <main><Results /></main>;
  if (layoutQ.isLoading) return <main className="shell pt-6"><Loading label="Carregando a página inicial" /></main>;
  if (layoutQ.isError || !layoutQ.data) return <main className="shell pt-6"><ErrorState retry={() => layoutQ.refetch()} message="Não foi possível carregar a configuração da página inicial." /></main>;
  return <main><HomepageSections layout={layoutQ.data} /></main>;
}
