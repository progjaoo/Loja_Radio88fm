import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { AccessibilityPreferencesButton } from '@/components/accessibility-preferences-button';
import { useAuth, useClerk, useUser } from '@clerk/react';
import { useGetAdminCapabilities, useGetCart, useListCategories, useListProducts, getGetAdminCapabilitiesQueryKey, getGetCartQueryKey, getListProductsQueryKey } from '@workspace/api-client-react';
import { Activity, ClipboardList, Heart, LogOut, MapPin, Menu, Search, ShoppingBag, UserRound, X } from 'lucide-react';
import { FaFacebookF, FaInstagram, FaTiktok, FaYoutube } from 'react-icons/fa';
import { CategoryIconView } from '@/components/category-icon';
import { CookiePreferences, CookiePreferencesReopen } from '@/components/shop-support';
import { useGuestCart } from '@/lib/guest-cart';
import { STORE_CONTACT } from '@/lib/legal-documents';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const StoreSearchContext = createContext(false);

export function useStoreSearchOverlayOpen() {
  return useContext(StoreSearchContext);
}

export function Logo() {
  return <Link href="/" className="inline-flex items-baseline text-[22px] font-medium tracking-[-0.06em]" data-testid="link-home" aria-label="Rádio 88 FM, página inicial">rádio 88<span className="text-[#bd382f]">.</span></Link>;
}

export function SearchBar({ onClose }: { onClose?: () => void }) {
  const [, go] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const current = params.get('q') ?? '';
  const [value, setValue] = useState(current);
  const [debounced, setDebounced] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setValue(current); }, [current]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const term = value.trim();
    if (term.length < 2) { setDebounced(''); return; }
    const timer = window.setTimeout(() => setDebounced(term), 275);
    return () => window.clearTimeout(timer);
  }, [value]);
  const suggestionParams = debounced ? { search: debounced } : undefined;
  const suggestions = useListProducts(suggestionParams, {
    query: { enabled: debounced.length >= 2, staleTime: 20_000, queryKey: getListProductsQueryKey(suggestionParams) },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const term = value.trim();
    const currentParams = new URLSearchParams(search);
    const nextParams = new URLSearchParams();
    for (const key of ['categoryId', 'featured', 'minPrice', 'maxPrice', 'availability', 'sort', 'pieceType', 'sizes', 'filters']) {
      const value = currentParams.get(key);
      if (value) nextParams.set(key, value);
    }
    nextParams.set('view', 'catalog');
    if (term) nextParams.set('q', term);
    go(`/?${nextParams.toString()}`);
    onClose?.();
  };
  const clear = () => { setValue(''); input.current?.focus(); };
  return (
    <div className="store-search-wrap">
      <form role="search" onSubmit={submit} className="store-search-form">
        <button type="submit" aria-label="Pesquisar produtos" data-testid="button-search" className="store-search-submit"><Search size={20} aria-hidden="true" /></button>
        <input ref={input} type="search" aria-label="Buscar produtos" data-testid="input-search" placeholder="Buscar" value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') onClose?.(); }} />
        {value && <button type="button" onClick={clear} aria-label="Limpar campo de busca" title="Limpar campo" data-testid="button-clear-search" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground"><X size={16} /></button>}
      </form>
      {value.trim().length < 2 && <div className="store-search-suggestions" aria-label="Sugestões de busca">
        <span>Explore a loja</span>
        <Link href="/?view=catalog" onClick={onClose}>Toda a vitrine</Link>
      </div>}
      {debounced.length >= 2 && <div className="store-search-suggestions" aria-live="polite">
        <span>{suggestions.isFetching ? 'Buscando produtos…' : suggestions.isError ? 'Sugestões indisponíveis' : suggestions.data?.length ? 'Produtos' : 'Nenhum produto encontrado'}</span>
        {suggestions.data?.slice(0, 6).map(product => <Link key={product.id} href={`/product/${product.id}`} onClick={onClose} className="store-search-result">
          <span>{product.name}</span><small>{product.categoryName ?? 'Rádio 88 FM'}</small>
        </Link>)}
        {suggestions.isError && <small className="store-search-message">Digite Enter para abrir a busca completa.</small>}
        <button type="button" onClick={submit} className="store-search-all">Ver todos os resultados <span aria-hidden="true">→</span></button>
      </div>}
    </div>
  );
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current(); };
    document.addEventListener('keydown', key); document.addEventListener('mousedown', down);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('mousedown', down); };
  }, [open]);
  return ref;
}

function AccountMenu() {
  const { isSignedIn, isLoaded } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [loc] = useLocation(); const search = useSearch();
  const ref = useDismiss(open, () => setOpen(false));
  const admin = useGetAdminCapabilities({ query: { enabled: !!isSignedIn, queryKey: getGetAdminCapabilitiesQueryKey(), retry: false } });
  useEffect(() => { setOpen(false); }, [loc, search]);
  useEffect(() => { if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(); }, [open]);
  if (isLoaded && !isSignedIn) return <Link href="/sign-in" aria-label="Perfil: entrar" title="Perfil" data-testid="link-account" className="profile-avatar"><UserRound size={18} strokeWidth={1.6} /></Link>;
  if (!isSignedIn) return <span className="profile-avatar profile-avatar-loading" aria-hidden="true">88</span>;
  const name = user?.fullName || user?.primaryEmailAddress?.emailAddress || 'Conta';
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase() || 'R';
  const item = 'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-muted';
  return (
    <div ref={ref} className="relative">
      <button ref={trigger} onClick={() => setOpen(!open)} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }} aria-haspopup="menu" aria-expanded={open} aria-label="Menu da conta" data-testid="link-account" className="grid h-10 w-10 cursor-pointer place-items-center overflow-hidden rounded-full bg-foreground text-xs font-medium text-background">
        {user?.imageUrl ? <img src={user.imageUrl} alt="" className="h-full w-full object-cover" /> : initials}
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label="Conta" onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); trigger.current?.focus(); return; }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault();
          const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
          const index = items.findIndex(item => item === document.activeElement);
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }} className="absolute right-0 top-12 z-50 w-60 rounded-[20px] bg-card p-2 shadow-soft-lg ring-1 ring-border">
          <div className="truncate px-3 py-2 text-xs text-muted-foreground">{name}</div>
          <Link role="menuitem" href="/account" onClick={() => setOpen(false)} className={item} data-testid="menu-account"><UserRound size={17} />Minha conta</Link>
          <Link role="menuitem" href="/orders" onClick={() => setOpen(false)} className={item} data-testid="menu-orders"><ClipboardList size={17} />Meus pedidos</Link>
          <Link role="menuitem" href="/account/addresses" onClick={() => setOpen(false)} className={item} data-testid="menu-addresses"><MapPin size={17} />Endereços</Link>
          {admin.data?.permissions.length ? <Link role="menuitem" href="/admin" onClick={() => setOpen(false)} className={item} data-testid="menu-admin"><Activity size={17} />Operação da loja</Link> : null}
          <button role="menuitem" onClick={() => signOut({ redirectUrl: basePath || '/' })} className={`${item} w-full`} data-testid="menu-signout"><LogOut size={17} />Sair</button>
        </div>
      )}
    </div>
  );
}

function CartLink() {
  const { isSignedIn } = useAuth();
  const cart = useGetCart({ query: { enabled: !!isSignedIn, queryKey: getGetCartQueryKey() } });
  const count = isSignedIn ? (cart.data?.lines ?? []).reduce((n, l) => n + l.quantity, 0) : 0;
  return (
    <Link href={isSignedIn ? '/cart' : '/sign-in'} aria-label={count ? `Sacola, ${count} ${count === 1 ? 'item' : 'itens'}` : 'Sacola'} data-testid="link-cart" className="relative grid h-10 w-10 place-items-center rounded-full hover:bg-muted">
      <ShoppingBag size={21} strokeWidth={1.6} />
      {count > 0 && <span data-testid="badge-cart-count" className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-foreground px-1 text-[11px] leading-none text-background">{count}</span>}
    </Link>
  );
}

export function Header({ searchOpen, setSearchOpen }: { searchOpen: boolean; setSearchOpen: (open: boolean) => void }) {
  const { isSignedIn } = useAuth();
  const guestCart = useGuestCart();
  const categories = useListCategories();
  const [path] = useLocation();
  const searchParams = new URLSearchParams(useSearch());
  const activeCategory = path === '/' ? searchParams.get('categoryId') ?? '' : '';
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const closeSearch = () => setSearchOpen(false);
  const purchaseFlow = path === '/cart' || path === '/checkout';
  const adminFlow = path.startsWith('/admin');
  useEffect(() => { setMobileMenuOpen(false); setSearchOpen(false); }, [path]);
  return (
    <>
      {!purchaseFlow && !adminFlow && <div className="store-utility-bar"><Link href="/orders">Pedidos</Link><Link href="/help">Ajuda</Link><Link href={isSignedIn ? '/account' : '/sign-in'}>Conta</Link></div>}
      <header className={`store-header sticky top-0 z-40${purchaseFlow ? ' is-purchase-flow' : ''}${adminFlow ? ' is-admin-flow' : ''}`}>
        <div className="store-header-inner">
          <Logo />
          {!purchaseFlow && !adminFlow && <nav className="store-primary-nav" aria-label="Navegação principal">
            <Link href="/?view=catalog" data-testid="nav-all" aria-current={path === '/' && searchParams.get('view') === 'catalog' ? 'page' : undefined}>Toda a loja</Link>
            {categories.data?.slice(0, 3).map(category => <Link key={category.id} href={`/?categoryId=${encodeURIComponent(category.id)}`} data-testid={`nav-category-${category.id}`} aria-current={activeCategory === category.id ? 'page' : undefined}>{category.name}</Link>)}
          </nav>}
          <nav className="store-actions" aria-label="Ações da loja">
            {!purchaseFlow && <>
              <button ref={searchTrigger} type="button" onClick={() => setSearchOpen(true)} className="store-search-trigger" aria-label="Buscar produtos" aria-haspopup="dialog" aria-expanded={searchOpen} data-testid="button-open-search"><Search size={21} strokeWidth={1.8} aria-hidden="true" /><span>Buscar</span></button>
              <Link href={isSignedIn ? '/favorites' : '/sign-in'} aria-label="Favoritos" title="Favoritos" data-testid="link-favorites" className="store-action"><Heart size={19} strokeWidth={1.7} /><span>Favoritos</span></Link>
            </>}
            <CartAction guestCart={guestCart.lines.reduce((sum, line) => sum + line.quantity, 0)} signedIn={!!isSignedIn} />
            {!purchaseFlow && <AccountMenu />}
            {!purchaseFlow && !adminFlow && <button type="button" className="store-mobile-menu-trigger" aria-label="Abrir navegação da loja" onClick={() => setMobileMenuOpen(true)} data-testid="button-open-store-menu"><Menu size={21} /></button>}
            {purchaseFlow && <Link href="/contact" className="store-purchase-help">Precisa de ajuda?</Link>}
          </nav>
        </div>
      </header>
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent
          className="store-search-dialog"
          overlayClassName="store-search-overlay"
          hideCloseButton
          onCloseAutoFocus={event => { event.preventDefault(); searchTrigger.current?.focus(); }}
          aria-describedby="store-search-description"
          data-testid="dialog-global-search"
        >
          <DialogTitle className="sr-only">Buscar produtos</DialogTitle>
          <DialogDescription id="store-search-description" className="sr-only">Digite para ver sugestões de produtos ou envie a busca completa.</DialogDescription>
          <div className="store-search-dialog-row">
            <div className="store-header-search"><SearchBar onClose={closeSearch} /></div>
            <DialogClose asChild><button type="button" className="store-search-cancel" data-testid="button-close-search">Cancelar</button></DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
      <SheetContent side="left" className="store-mobile-menu" aria-describedby="store-mobile-menu-description">
        <SheetHeader><SheetTitle>Loja Rádio 88</SheetTitle><SheetDescription id="store-mobile-menu-description">Acesse categorias, sua conta e o atendimento.</SheetDescription></SheetHeader>
        <nav className="store-mobile-menu-links" aria-label="Navegação da loja">
          <Link href="/?view=catalog" onClick={() => setMobileMenuOpen(false)}>Toda a loja</Link>
          {categories.data?.map(category => <Link key={category.id} href={`/?categoryId=${encodeURIComponent(category.id)}`} onClick={() => setMobileMenuOpen(false)}>{category.name}</Link>)}
          <Link href={isSignedIn ? '/favorites' : '/sign-in'} onClick={() => setMobileMenuOpen(false)}>Favoritos</Link>
          <Link href="/orders" onClick={() => setMobileMenuOpen(false)}>Meus pedidos</Link>
          <Link href="/account" onClick={() => setMobileMenuOpen(false)}>Minha conta</Link>
            <Link href="/help" onClick={() => setMobileMenuOpen(false)}>Ajuda e atendimento</Link>
        </nav>
      </SheetContent>
    </Sheet>
    </>
  );
}

function CartAction({ guestCart, signedIn }: { guestCart: number; signedIn: boolean }) {
  const cart = useGetCart({ query: { enabled: signedIn, queryKey: getGetCartQueryKey() } });
  const count = signedIn ? (cart.data?.lines ?? []).reduce((total, line) => total + line.quantity, 0) : guestCart;
  return <Link href="/cart" aria-label={count ? `Sacola, ${count} ${count === 1 ? 'item' : 'itens'}` : 'Sacola'} title="Sacola" data-testid="link-cart" className="store-action store-cart-action"><ShoppingBag size={19} strokeWidth={1.7} /><span>Sacola</span>{count > 0 && <span data-testid="badge-cart-count" className="store-badge">{count}</span>}</Link>;
}

function AccountSectionNav({ path }: { path: string }) {
  const items = [
    { href: '/account', label: 'Minha conta', active: path === '/account' },
    { href: '/orders', label: 'Pedidos', active: path.startsWith('/orders') },
    { href: '/account/addresses', label: 'Endereços', active: path === '/account/addresses' },
    { href: '/favorites', label: 'Favoritos', active: path === '/favorites' },
  ];
  return <nav className="account-area-nav" aria-label="Sua conta">
    <span className="eyebrow">SUA CONTA</span>
    {items.map(item => <Link key={item.href} href={item.href} aria-current={item.active ? 'page' : undefined}>{item.label}</Link>)}
  </nav>;
}

export function Shell({ children }: { children: ReactNode }) {
  const categories = useListCategories();
  const [path] = useLocation();
  const search = useSearch();
  const purchaseFlow = path === '/cart' || path === '/checkout';
  const adminFlow = path.startsWith('/admin');
  const [searchOpen, setSearchOpen] = useState(false);
  const accountArea = path === '/account' || path === '/account/addresses' || path.startsWith('/orders') || path === '/favorites';
  const [wideFooter, setWideFooter] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [path, search]);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const update = () => setWideFooter(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return (
    <StoreSearchContext.Provider value={searchOpen}>
      <div className={`min-h-[100dvh] ${adminFlow ? 'store-admin-site' : 'store-public-site'}${purchaseFlow ? ' store-checkout-site' : ''}`}>
      <Header searchOpen={searchOpen} setSearchOpen={setSearchOpen} />
      {accountArea ? <div className="shell account-area-layout">
        <AccountSectionNav path={path} />
        <div className="account-area-content">{children}</div>
      </div> : children}
      <footer className={`store-footer mt-16 bg-[#332f2d] text-white${purchaseFlow ? ' is-compact' : ''}`}>
        {purchaseFlow ? <div className="store-purchase-footer shell"><Logo /><span>Compra acompanhada pela equipe da Rádio 88 FM.</span><Link href="/contact">Fale conosco</Link><Link href="/terms">Termos</Link><Link href="/privacy">Privacidade</Link><CookiePreferencesReopen /></div> : <>
        <div className="shell grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div><div className="text-[22px] font-medium tracking-[-0.06em]">rádio 88<span className="text-[#e18c73]">.</span></div><p className="mt-4 max-w-sm text-sm text-white/70">Produtos da estação, vendidos diretamente. Preço claro, pedido confirmado e atendimento de verdade.</p>
            <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-xs text-white/75" aria-label="Redes sociais">
              <a className="footer-social-link" href="https://www.facebook.com/radio88oficial/" target="_blank" rel="noopener noreferrer" aria-label="Facebook" data-testid="link-social-facebook"><FaFacebookF aria-hidden="true" size={14} /><span>Facebook</span></a>
              <a className="footer-social-link" href="https://www.instagram.com/radio88fm" target="_blank" rel="noopener noreferrer" aria-label="Instagram" data-testid="link-social-instagram"><FaInstagram aria-hidden="true" size={15} /><span>Instagram</span></a>
              <a className="footer-social-link" href="https://www.youtube.com/@radio88oficial" target="_blank" rel="noopener noreferrer" aria-label="YouTube" data-testid="link-social-youtube"><FaYoutube aria-hidden="true" size={16} /><span>YouTube</span></a>
              <a className="footer-social-link" href="https://www.tiktok.com/@radio88fm" target="_blank" rel="noopener noreferrer" aria-label="TikTok" data-testid="link-social-tiktok"><FaTiktok aria-hidden="true" size={14} /><span>TikTok</span></a>
            </div>
          </div>
          <details className="store-footer-group" open={wideFooter}><summary>Categorias</summary><div className="grid gap-3 text-sm">{categories.data?.length ? categories.data.map(c => <Link key={c.id} href={`/?categoryId=${encodeURIComponent(c.id)}`} className="flex items-center gap-2"><CategoryIconView category={c} size={15} />{c.name}</Link>) : <span className="text-white/50">Em breve</span>}</div></details>
          <details className="store-footer-group" open={wideFooter}><summary>Atendimento</summary><div className="grid gap-3 text-sm"><Link href="/help">Central de ajuda</Link><Link href="/contact" data-testid="link-footer-contact">Fale conosco</Link><a href={STORE_CONTACT.whatsappUrl} target="_blank" rel="noopener noreferrer" data-testid="link-footer-whatsapp">WhatsApp: {STORE_CONTACT.whatsappLabel}<span className="sr-only"> (abre em nova aba)</span></a><a href={`mailto:${STORE_CONTACT.email}`} className="break-all" data-testid="link-footer-email">{STORE_CONTACT.email}</a><span>Horário: {STORE_CONTACT.hours}</span><Link href="/orders">Meus pedidos</Link><Link href="/account">Minha conta</Link><Link href="/returns">Trocas e devoluções</Link></div></details>
          <details className="store-footer-group" open={wideFooter}><summary>Transparência</summary><div className="grid gap-3 text-sm"><Link href="/terms">Termos de uso</Link><Link href="/privacy">Privacidade (LGPD)</Link><Link href="/cookies">Política de cookies</Link><Link href="/returns">Trocas e devoluções</Link><CookiePreferencesReopen /></div></details>
        </div>
         <div className="border-t border-white/10 py-4 text-center text-xs text-white/60">
           <p className="m-0">Rádio 88 FM · Comércio direto, com cuidado e transparência.</p>
            <p className="m-0 mt-1">© 2026 Rádio 88 FM. Todos os direitos reservados.</p>
           <AccessibilityPreferencesButton />
         </div>
        </>}
      </footer>
      <CookiePreferences />
      </div>
    </StoreSearchContext.Provider>
  );
}
