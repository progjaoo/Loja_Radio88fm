import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'wouter';
import type { Product } from '@workspace/api-client-react';
import { money } from '@/lib/format';
import { FavoriteToggle } from '@/components/favorite-toggle';

export function ProductImage({ src, name, className = '' }: { src?: string | null; name: string; className?: string }) {
  return (
    <div className={`relative aspect-square overflow-hidden rounded-[20px] bg-muted ${className}`}>
      {src ? <img src={src} alt={name} loading="lazy" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center p-3 text-center text-xs text-muted-foreground">Foto em breve</div>}
    </div>
  );
}

export function effectiveVariantPrice(
  product: Product,
  variant: Product["variants"][number],
  now = Date.now(),
) {
  if (product.promotionalPrice == null) return variant.price;
  if (product.promotionStartsAt && now < Date.parse(product.promotionStartsAt)) return variant.price;
  if (product.promotionEndsAt && now > Date.parse(product.promotionEndsAt)) return variant.price;
  return Math.min(variant.price, product.promotionalPrice);
}

export const fromPrice = (p: Product) =>
  p.variants.length ? Math.min(...p.variants.map(variant => effectiveVariantPrice(p, variant))) : null;

export function ProductCard({ product: p }: { product: Product }) {
  const price = fromPrice(p);
  const hoverImage = p.images?.find(image => image.isHover);
  const [loadedHoverUrl, setLoadedHoverUrl] = useState('');
  const [failedHoverUrl, setFailedHoverUrl] = useState('');
  const prices = p.variants.map(variant => Math.round(effectiveVariantPrice(p, variant) * 100));
  const hasPriceRange = price !== null && prices.some(value => value !== Math.round(price * 100));
  const soldOut = p.variants.length > 0 && p.variants.every(v => v.stock <= 0);
  return (
    <div className="catalog-product-card">
      <Link href={`/product/${p.id}`} className="product-card-link group" data-testid={`card-product-${p.id}`}>
        <div className={`product-card-media ${hoverImage ? 'has-hover' : ''} ${hoverImage && loadedHoverUrl === hoverImage.url && failedHoverUrl !== hoverImage.url ? 'hover-ready' : ''}`} aria-hidden="true">
          {p.imageUrl
            ? <img src={p.imageUrl} alt="" loading="lazy" decoding="async" className="product-card-photo product-card-cover" />
            : <span className="product-card-no-image">Foto em breve</span>}
          {hoverImage && failedHoverUrl !== hoverImage.url && <img
            src={hoverImage.url}
            alt=""
            loading="lazy"
            decoding="async"
            className={`product-card-photo product-card-hover ${loadedHoverUrl === hoverImage.url ? 'is-loaded' : ''}`}
            onLoad={() => setLoadedHoverUrl(hoverImage.url)}
            onError={() => setFailedHoverUrl(hoverImage.url)}
          />}
          {hoverImage && <span className="product-card-hover-cue">Foto alternativa</span>}
        </div>
        <div className="product-card-copy px-3 pb-3 pt-3">
          <h3 className="product-card-title text-sm font-medium">{p.name}</h3>
          <p className="product-card-category mt-0.5 text-xs text-muted-foreground">{p.categoryName ?? 'Rádio 88 FM'}</p>
          <p className="product-card-price text-sm">{soldOut ? 'Indisponível' : price !== null ? `${hasPriceRange ? 'A partir de ' : ''}${money(price)}` : ''}</p>
        </div>
      </Link>
      <FavoriteToggle product={p} />
    </div>
  );
}

export function ThumbStrip({ products }: { products: Product[] }) {
  const items = products.filter(p => p.imageUrl).slice(0, 4);
  if (!items.length) return null;
  return (
    <div className="flex gap-0.5" aria-hidden="true">
      {items.map(p => <img key={p.id} src={p.imageUrl!} alt="" className="h-12 w-12 rounded-xl object-cover" />)}
    </div>
  );
}

export function ProductRail({ products, title }: { products: Product[]; title: string }) {
  const rail = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    const update = () => {
      setCanPrev(element.scrollLeft > 2);
      setCanNext(element.scrollLeft + element.clientWidth < element.scrollWidth - 2);
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => { element.removeEventListener('scroll', update); observer.disconnect(); };
  }, [products.length]);
  const move = (direction: number) => {
    const element = rail.current;
    if (element) element.scrollBy({
      left: direction * element.clientWidth * .8,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };
  return <div className="relative">
    <div ref={rail} role="list" aria-label={title} className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-4 pt-1">
      {products.map(product => <div key={product.id} role="listitem" className="w-[76%] shrink-0 snap-start sm:w-[45%] lg:w-[24%]"><ProductCard product={product} /></div>)}
    </div>
    {canPrev && <button onClick={() => move(-1)} aria-label={`Ver produtos anteriores em ${title}`} className="absolute left-0 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white shadow-soft-lg"><ChevronLeft size={16} /></button>}
    {canNext && <button onClick={() => move(1)} aria-label={`Ver próximos produtos em ${title}`} className="absolute right-0 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white shadow-soft-lg"><ChevronRight size={16} /></button>}
  </div>;
}

/** Editorial composition uses only products already published in this category. */
export function CategoryShowcase({ products }: { products: Product[] }) {
  const hero = products.find(product => product.imageUrl);
  if (!hero) return null;
  const remaining = products.filter(product => product.id !== hero.id);
  const price = fromPrice(hero);
  return <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
    <Link href={`/product/${hero.id}`} className="relative block min-h-[320px] overflow-hidden rounded-[28px] lg:min-h-[460px]" aria-label={`Ver ${hero.name}`}>
      <img src={hero.imageUrl!} alt={hero.name} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-black/15" aria-hidden="true" />
      <span className="absolute left-6 top-6 max-w-[85%] text-3xl font-medium tracking-tight text-white [text-shadow:0_1px_5px_rgb(0_0_0/80%)]">{hero.categoryName ?? 'Rádio 88 FM'}</span>
      <span className="absolute bottom-4 left-4 right-4 w-fit max-w-[calc(100%-32px)] rounded-xl bg-white/95 p-3 text-sm text-black">{hero.name}{price !== null && <span className="mt-1 block">{money(price)}</span>}</span>
    </Link>
    <div className="grid grid-cols-2 content-start gap-3">
      {remaining.map(product => <Link key={product.id} href={`/product/${product.id}`} className="relative block aspect-square overflow-hidden rounded-[20px]" aria-label={`Ver ${product.name}`}>
        <ProductImage src={product.imageUrl} name={product.name} />
        <span className="absolute bottom-3 left-3 right-3 w-fit max-w-[calc(100%-24px)] rounded-xl bg-white/95 p-3 text-sm text-black">{product.name}</span>
      </Link>)}
    </div>
  </div>;
}

const tilt = ['-rotate-6 translate-y-6', 'rotate-3 -translate-y-2', '-rotate-2 translate-y-8', 'rotate-6 translate-y-2'];
export function Constellation({ products }: { products: Product[] }) {
  const items = [...products].sort((a, b) => Number(b.featured) - Number(a.featured)).filter(p => p.imageUrl).slice(0, 4);
  if (!items.length) return null;
  return (
    <div className="mx-auto flex max-w-[760px] justify-center px-2 pb-6" data-testid="hero-constellation">
      {items.map((p, i) => (
        <Link key={p.id} href={`/product/${p.id}`} aria-label={p.name} className={`float-card w-[26%] max-w-[170px] rounded-[28px] bg-card shadow-soft-2 ${tilt[i]} ${i ? '-ml-4 sm:-ml-6' : ''}`} style={{ zIndex: i % 2 ? 2 : 1 }}>
          <div className="p-1.5"><ProductImage src={p.imageUrl} name={p.name} /></div>
          <div className="truncate px-3 pb-2.5 pt-1 text-xs font-medium">{p.name}</div>
        </Link>
      ))}
    </div>
  );
}
