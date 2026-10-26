import { Link, useLocation, useSearch } from 'wouter';
import { useEffect, useState } from 'react';
import { useGetHomepageBanner, useGetHomepageLayout, getGetHomepageBannerQueryKey, getGetHomepageLayoutQueryKey, useListCategories, useListProducts } from '@workspace/api-client-react';
import type { Category, HomepageBannerSlide, HomepageLayout, HomepageSection, ListProductsParams, Product } from '@workspace/api-client-react';
import useEmblaCarousel from 'embla-carousel-react';
import { ArrowLeft, ArrowRight, ShoppingBag } from 'lucide-react';
import { CategoryIconView } from '@/components/category-icon';
import { ProductCard, fromPrice } from '@/components/product-ui';
import { ErrorState, Loading } from '@/components/feedback';

const FRESH = 30_000;

function SmartLink({ href, className, children, testId }: { href: string; className?: string; children: React.ReactNode; testId?: string }) {
  if (href.startsWith('/') && !href.startsWith('//')) return <Link href={href} className={className} data-testid={testId}>{children}</Link>;
  return <a href={href} className={className} rel="noopener noreferrer" data-testid={testId}>{children}</a>;
}

function BannerCta({ href, className, children }: { href?: string | null; className?: string; children: React.ReactNode }) {
  if (!href) return <>{children}</>;
  return <SmartLink href={href} className={className} testId="link-banner-cta">{children}</SmartLink>;
}

function Hero({ layout }: { layout: HomepageLayout }) {
  const q = useGetHomepageBanner({ query: { staleTime: FRESH, queryKey: getGetHomepageBannerQueryKey() } });
  const slides: HomepageBannerSlide[] = q.data?.enabled ? (q.data.slides ?? []).filter(slide => slide.enabled && !!slide.imageUrl) : [];
  const [carouselRef, api] = useEmblaCarousel({ loop: slides.length > 1, align: 'center', containScroll: false, duration: 32 });
  const [pageHidden, setPageHidden] = useState(false);
  useEffect(() => {
    const update = () => setPageHidden(document.hidden);
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const [selected, setSelected] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!api) return;
    const onSelect = () => setSelected(api.selectedScrollSnap());
    onSelect();
    api.on('select', onSelect);
    api.on('reInit', onSelect);
    return () => { api.off('select', onSelect); api.off('reInit', onSelect); };
  }, [api]);
  const h = layout.hero;
  const center = h.alignment === 'center';
  const showCarousel = slides.length > 0;
  const nextSlide = () => {
    if (!api) return;
    if (api.canScrollNext()) api.scrollNext();
    else api.scrollTo(0);
  };
  const previousSlide = () => {
    if (!api) return;
    if (api.canScrollPrev()) api.scrollPrev();
    else api.scrollTo(api.scrollSnapList().length - 1);
  };
  useEffect(() => {
    if (!showCarousel || slides.length <= 1 || paused || pageHidden || reducedMotion || !api) return;
    const timer = window.setTimeout(() => {
      if (api.canScrollNext()) api.scrollNext();
      else api.scrollTo(0);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [api, paused, pageHidden, reducedMotion, showCarousel, slides.length, selected]);
  if (q.isLoading) return <section className="shell pt-6"><Loading label="Carregando apresentação da loja" /></section>;
  if (q.isError) return <section className="shell pt-6"><ErrorState retry={() => q.refetch()} message="Não foi possível carregar a apresentação da loja." /></section>;
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); previousSlide(); }
    if (event.key === 'ArrowRight') { event.preventDefault(); nextSlide(); }
  };
  const renderSlide = (slide: HomepageBannerSlide, index: number) => {
    const picture = (
      <picture>
        {slide.mobileImageUrl && <source media="(max-width: 767px)" srcSet={slide.mobileImageUrl} />}
        <img src={slide.imageUrl ?? ''} alt={slide.alt} className="hero88-img" data-testid={`img-banner-${slide.id}`} />
      </picture>
    );
    return (
      <div className="hero88-slide" role="group" aria-roledescription="slide" aria-label={`${index + 1} de ${slides.length || 1}`} key={slide.id}>
        <div className="hero88-card"><BannerCta href={slide.ctaHref} className="block w-full">{picture}</BannerCta></div>
      </div>
    );
  };
  if (showCarousel) {
    const pauseOnBlur = (event: React.FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
    };
    return (
      <section
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
        <div className="hero88-viewport" ref={carouselRef}>
          <div className={`hero88-track${slides.length > 1 ? ' is-multi' : ''}`}>{slides.map(renderSlide)}</div>
        </div>
        {slides.length > 1 && (
          <div className="hero88-controls">
            <button type="button" className="hero88-arrow" onClick={previousSlide} aria-label="Destaque anterior" data-testid="button-banner-previous"><ArrowLeft size={18} /></button>
            <button type="button" className="hero88-arrow" onClick={nextSlide} aria-label="Próximo destaque" data-testid="button-banner-next"><ArrowRight size={18} /></button>
          </div>
        )}
      </section>
    );
  }
  return (
    <section aria-label="Apresentação" className="shell pt-6" data-testid="section-hero">
      <div className={`rounded-[28px] bg-card px-6 py-12 shadow-soft md:px-12 md:py-16 ${center ? 'text-center' : ''}`} data-testid="hero-text">
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
  return (
    <section id={isFeatured ? 'destaques' : 'vitrine'} className="shell mt-14 scroll-mt-36 lg:scroll-mt-20" aria-labelledby={titleId} data-testid={`section-${section.id}`}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><h2 id={titleId} className="display text-xl">{section.title}</h2>{section.description && <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>}</div>
        {!isFeatured && !preview && <Link href="/?filters=1" className="text-sm underline" data-testid="link-open-filters">Filtrar e ordenar</Link>}
      </div>
      {products.isLoading ? <Loading /> : products.isError ? <ErrorState retry={() => products.refetch()} /> : list.length
        ? <div className={`grid gap-3 ${gridClass(section.columns)}`}>{list.map(p => <ProductCard key={p.id} product={p} />)}</div>
        : <Empty title={isFeatured ? 'Nenhum destaque por enquanto' : 'Estamos preparando a vitrine'} text={isFeatured ? 'Os produtos escolhidos pela equipe aparecem aqui.' : 'Ainda não há produtos para esta seção.'} />}
    </section>
  );
}

function CategoriesSection({ section, preview }: { section: HomepageSection; preview?: boolean }) {
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
          <div className={`grid gap-3 ${gridClass(section.columns)}`}>
            {list.map(c => <Link key={c.id} href={preview ? '#' : `/?categoryId=${encodeURIComponent(c.id)}`} data-testid={`card-category-${c.id}`} className="lift flex flex-col gap-3 rounded-[28px] bg-card p-5 shadow-soft"><span className="grid h-11 w-11 place-items-center rounded-full bg-muted"><CategoryIconView category={c} size={22} /></span><span><b className="block text-base">{c.name}</b>{c.description && <small className="mt-1 block text-muted-foreground">{c.description}</small>}</span></Link>)}
          </div>
        )}
      </div>
    </section>
  );
}

/** Shared renderer used by the public homepage and the admin preview. */
export function HomepageSections({ layout, preview }: { layout: HomepageLayout; preview?: boolean }) {
  const products = useListProducts(undefined, { query: { staleTime: FRESH, queryKey: ['/api/products'] } });
  return <>
    {layout.sections.filter(s => s.enabled).map(s => {
      if (s.id === 'hero') return <Hero key={s.id} layout={layout} />;
      if (s.id === 'categories') return <CategoriesSection key={s.id} section={s} preview={preview} />;
      return <ProductSection key={s.id} section={s} products={products} preview={preview} />;
    })}
  </>;
}

type Sort = '' | 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc';
const SORTS: { v: Sort; l: string }[] = [
  { v: '', l: 'Relevância' }, { v: 'name-asc', l: 'Nome (A-Z)' }, { v: 'name-desc', l: 'Nome (Z-A)' },
  { v: 'price-asc', l: 'Menor preço' }, { v: 'price-desc', l: 'Maior preço' },
];
const isSoldOut = (p: Product) => !p.variants.some(v => v.stock > 0);

function Results() {
  const categories = useListCategories();
  const search = useSearch();
  const [, go] = useLocation();
  const sp = new URLSearchParams(search);
  const query = sp.get('q') ?? ''; const cat = sp.get('categoryId') ?? ''; const featuredOnly = sp.get('featured') === 'true';
  const pieceType = sp.get('pieceType') ?? '';
  const selectedSizes = (sp.get('sizes') ?? '').split('|').filter(Boolean);
  const [selectedCategory, setSelectedCategory] = useState(cat);
  const [filtersOpen, setFiltersOpen] = useState(() => sp.get('filters') === '1');
  const [draftSizes, setDraftSizes] = useState(selectedSizes);
  useEffect(() => { setSelectedCategory(cat); }, [cat]);
  useEffect(() => { setDraftSizes(selectedSizes); }, [search]);
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
    .filter(product => (!pieceType || product.pieceType === pieceType) && hasClothingSizes(product))
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
    n.delete('filters');
    Object.entries(p).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
    const s = n.toString();
    go(s ? `/?${s}` : '/');
  };
  const active = !!(query || cat || featuredOnly || minPrice || maxPrice || avail || sort || pieceType || selectedSizes.length);
  const activeFilterCount = [query, cat, featuredOnly, minPrice, maxPrice, avail, sort, pieceType, selectedSizes.length > 0].filter(Boolean).length;
  const invalidRange = num(minPrice) !== undefined && num(maxPrice) !== undefined && num(minPrice)! > num(maxPrice)!;
  const title = query ? `Resultados para “${query}”` : activeCat ? activeCat.name : featuredOnly ? 'Em destaque' : 'Toda a vitrine';
  const clear = () => go('/');
  return (
    <section id="vitrine" className="shell scroll-mt-36 pt-8 lg:scroll-mt-20" aria-labelledby="resultados">
      <div className="catalog-results-layout">
        <aside className="catalog-filter-sidebar" aria-label="Filtros de catálogo" data-testid="catalog-filter-sidebar">
          <button
            type="button"
            className="catalog-filter-mobile-toggle"
            aria-expanded={filtersOpen}
            aria-controls="catalog-filter-form"
            onClick={() => setFiltersOpen(open => !open)}
            data-testid="button-toggle-mobile-filters"
          >
            <span>Filtros{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}</span>
            <span aria-hidden="true">{filtersOpen ? '−' : '+'}</span>
          </button>
          <form
            id="catalog-filter-form"
            key={search}
            className={`catalog-filter-form${filtersOpen ? ' is-open' : ''}`}
            data-testid="form-filters"
            onSubmit={e => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              patch({
                q: String(f.get('q') ?? '').trim(),
                minPrice: String(f.get('minPrice') ?? ''),
                maxPrice: String(f.get('maxPrice') ?? ''),
                categoryId: String(f.get('categoryId') ?? ''),
                pieceType: String(f.get('pieceType') ?? ''),
                sizes: f.getAll('sizes').map(String).join('|'),
                sort: String(f.get('sort') ?? ''),
                availability: f.get('availability') ? 'in_stock' : '',
                featured: f.get('featured') ? 'true' : '',
              });
              setFiltersOpen(false);
            }}
          >
            <div className="catalog-filter-form-heading">
              <h2>Filtrar produtos</h2>
              <button type="button" className="catalog-filter-reset" onClick={clear}>Redefinir</button>
            </div>
            <label className="catalog-filter-search">Buscar<input name="q" className="field" defaultValue={query} placeholder="Nome ou descrição" data-testid="input-filter-search" /></label>
            <details className="catalog-filter-group" open>
              <summary>Categoria</summary>
              <label className="catalog-filter-select-label">Escolha uma categoria
                <select name="categoryId" className="field" value={selectedCategory} onChange={event => setSelectedCategory(event.target.value)} data-testid="select-filter-category">
                  <option value="">Todas</option>{catList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            </details>
            <details className="catalog-filter-group" open>
              <summary>Tipo de produto</summary>
              <label className="catalog-filter-select-label"><span className="sr-only">Escolha um tipo de produto</span>
                <select name="pieceType" className="field" defaultValue={pieceType} data-testid="select-filter-piece-type">
                  <option value="">Todos</option>{productTypes.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
            </details>
            {sizeOptions.length > 0 && <details className="catalog-filter-group" open>
              <summary>Tamanho</summary>
              <div className="catalog-size-options" role="group" aria-label="Tamanhos disponíveis">
                {sizeOptions.map(size => <label key={size} className="catalog-filter-check">
                  <input type="checkbox" name="sizes" value={size} checked={draftSizes.includes(size)} onChange={() => {
                    setDraftSizes(current => current.includes(size) ? current.filter(value => value !== size) : [...current, size]);
                  }} />
                  <span>{size}</span>
                </label>)}
              </div>
            </details>}
            <details className="catalog-filter-group" open>
              <summary>Preço</summary>
              <div className="catalog-price-fields">
                <label>De (R$)<input name="minPrice" type="number" min="0" step="0.01" inputMode="decimal" className="field" defaultValue={minPrice} data-testid="input-filter-min" /></label>
                <label>Até (R$)<input name="maxPrice" type="number" min="0" step="0.01" inputMode="decimal" className="field" defaultValue={maxPrice} data-testid="input-filter-max" /></label>
              </div>
            </details>
            <details className="catalog-filter-group">
              <summary>Mais filtros</summary>
              <div className="catalog-filter-more">
                <label className="catalog-filter-check"><input name="featured" type="checkbox" defaultChecked={featuredOnly} data-testid="checkbox-filter-featured" /><span>Somente destaques</span></label>
                <label className="catalog-filter-check"><input name="availability" type="checkbox" defaultChecked={avail} data-testid="checkbox-filter-available" /><span>Somente disponíveis</span></label>
                <label className="catalog-filter-select-label">Ordenar por
                  <select name="sort" className="field" defaultValue={sort} data-testid="select-filter-sort">{SORTS.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}</select>
                </label>
              </div>
            </details>
            <div className="catalog-filter-actions">
              <button className="button" data-testid="button-apply-filters">Aplicar filtros</button>
              {invalidRange && <p role="alert">O preço mínimo é maior que o máximo; nenhum produto vai corresponder.</p>}
            </div>
          </form>
        </aside>
        <div className="catalog-results">
          <div className="catalog-results-heading">
            <h1 id="resultados" className="display text-2xl" aria-live="polite" data-testid="text-result-count">{title}{!products.isLoading && !products.isError && ` · ${list.length} ${list.length === 1 ? 'produto' : 'produtos'}`}</h1>
            <button className="button button-outline" onClick={clear} data-testid="button-clear-filters">{active ? 'Limpar filtros' : 'Voltar ao início'}</button>
          </div>
          {products.isLoading ? <Loading /> : products.isError ? <ErrorState retry={() => products.refetch()} /> : list.length
            ? <div className="catalog-product-grid">{list.map(p => <ProductCard key={p.id} product={p} />)}</div>
            : <Empty title="Nenhum resultado por aqui" text="Tente outra busca, ajuste o preço, o tamanho ou escolha uma categoria diferente." action={<button className="button button-outline mt-5" onClick={clear}>Limpar filtros</button>} />}
        </div>
      </div>
    </section>
  );
}

export function Catalog({ configOverride, preview }: { configOverride?: HomepageLayout; preview?: boolean } = {}) {
  const search = useSearch();
  const layoutQ = useGetHomepageLayout({ query: { staleTime: FRESH, queryKey: getGetHomepageLayoutQueryKey(), enabled: !configOverride } });
  if (configOverride) return <main><HomepageSections layout={configOverride} preview={preview} /></main>;
  const sp = new URLSearchParams(search);
  const filtering = ['q', 'categoryId', 'featured', 'minPrice', 'maxPrice', 'availability', 'sort', 'pieceType', 'sizes', 'filters'].some(k => sp.has(k));
  if (filtering) return <main><Results /></main>;
  if (layoutQ.isLoading) return <main className="shell pt-6"><Loading label="Carregando a página inicial" /></main>;
  if (layoutQ.isError || !layoutQ.data) return <main className="shell pt-6"><ErrorState retry={() => layoutQ.refetch()} message="Não foi possível carregar a configuração da página inicial." /></main>;
  return <main><HomepageSections layout={layoutQ.data} /></main>;
}
