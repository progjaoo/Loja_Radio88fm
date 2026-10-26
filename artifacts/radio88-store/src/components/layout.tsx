import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { AccessibilityPreferencesButton } from '@/components/accessibility-preferences-button';
import { useAuth, useClerk, useUser } from '@clerk/react';
import { useGetAdminCapabilities, useGetCart, useListCategories, getGetAdminCapabilitiesQueryKey, getGetCartQueryKey } from '@workspace/api-client-react';
import type { Category } from '@workspace/api-client-react';
import { Activity, ClipboardList, Heart, LogIn, LogOut, MapPin, Search, ShoppingBag, UserRound, X } from 'lucide-react';
import { FaFacebookF, FaInstagram, FaTiktok, FaYoutube } from 'react-icons/fa';
import { CategoryIconView } from '@/components/category-icon';
import { CookiePreferences, CookiePreferencesReopen } from '@/components/shop-support';
import { useGuestCart } from '@/lib/guest-cart';
import { STORE_CONTACT } from '@/lib/legal-documents';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function Logo() {
  return <Link href="/" className="inline-flex items-baseline text-[22px] font-medium tracking-[-0.06em]" data-testid="link-home" aria-label="Rádio 88 FM, página inicial">rádio 88<span className="text-[#bd382f]">.</span></Link>;
}

export function SearchBar({ onClose }: { onClose?: () => void }) {
  const [, go] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const current = params.get('q') ?? '';
  const [value, setValue] = useState(current);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setValue(current); }, [current]);
  useEffect(() => { input.current?.focus(); }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams();
    if (value.trim()) next.set('q', value.trim());
    const cat = params.get('categoryId'); if (cat) next.set('categoryId', cat);
    const s = next.toString();
    go(s ? `/?${s}` : '/');
    onClose?.();
  };
  const clear = () => { setValue(''); const next = new URLSearchParams(search); next.delete('q'); const s = next.toString(); go(s ? `/?${s}` : '/'); };
  return (
    <form role="search" onSubmit={submit} className="store-search-form">
      <button type="submit" aria-label="Pesquisar produtos" data-testid="button-search" className="store-search-submit"><Search size={20} aria-hidden="true" /></button>
      <input ref={input} type="search" aria-label="Buscar produtos" data-testid="input-search" placeholder="Buscar produtos" value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') onClose?.(); }} />
      {(value || current) && <button type="button" onClick={clear} aria-label="Limpar busca" data-testid="button-clear-search" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground"><X size={16} /></button>}
    </form>
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

function CategoryLinks({ categories, active, onNavigate, vertical = false }: { categories: Category[]; active: string; onNavigate?: () => void; vertical?: boolean }) {
  const cls = (on: boolean) => `flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm transition-colors ${on ? 'bg-foreground text-background' : 'hover:bg-muted'} ${vertical ? 'w-full rounded-xl' : ''}`;
  return <>
    <Link href="/" onClick={onNavigate} aria-current={!active ? 'page' : undefined} className={cls(false)} data-testid="nav-all">Vitrine</Link>
    {categories.map(c => <Link key={c.id} href={`/?categoryId=${encodeURIComponent(c.id)}`} onClick={onNavigate} aria-current={active === c.id ? 'page' : undefined} className={cls(active === c.id)} data-testid={`nav-category-${c.id}`}><CategoryIconView category={c} size={16} />{c.name}</Link>)}
  </>;
}

export function Header() {
  const { isSignedIn } = useAuth();
  const guestCart = useGuestCart();
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const wasSearchOpen = useRef(false);
  const closeSearch = () => setSearchOpen(false);
  useEffect(() => {
    if (!searchOpen && wasSearchOpen.current) searchTrigger.current?.focus();
    wasSearchOpen.current = searchOpen;
  }, [searchOpen]);
  return (
    <header className="store-header sticky top-0 z-40">
      <div className={`store-header-inner ${searchOpen ? 'is-search-open' : ''}`}>
        {searchOpen ? <>
          <div className="store-header-search"><SearchBar onClose={closeSearch} /></div>
          <button type="button" onClick={closeSearch} className="store-search-cancel" data-testid="button-close-search">Cancelar</button>
        </> : <>
          <Logo />
          <nav className="store-actions" aria-label="Ações da loja">
            <button ref={searchTrigger} type="button" onClick={() => setSearchOpen(true)} className="store-search-trigger" aria-label="Buscar produtos" data-testid="button-open-search"><Search size={21} strokeWidth={1.8} aria-hidden="true" /><span>Buscar</span></button>
            <Link href={isSignedIn ? '/favorites' : '/sign-in'} aria-label="Favoritos" title="Favoritos" data-testid="link-favorites" className="store-action"><Heart size={19} strokeWidth={1.7} /><span>Favoritos</span></Link>
            <CartAction guestCart={guestCart.lines.reduce((sum, line) => sum + line.quantity, 0)} signedIn={!!isSignedIn} />
            <AccountMenu />
          </nav>
        </>}
      </div>
    </header>
  );
}

function CartAction({ guestCart, signedIn }: { guestCart: number; signedIn: boolean }) {
  const cart = useGetCart({ query: { enabled: signedIn, queryKey: getGetCartQueryKey() } });
  const count = signedIn ? (cart.data?.lines ?? []).reduce((total, line) => total + line.quantity, 0) : guestCart;
  return <Link href="/cart" aria-label={count ? `Sacola, ${count} itens` : 'Sacola'} title="Sacola" data-testid="link-cart" className="store-action store-cart-action"><ShoppingBag size={19} strokeWidth={1.7} /><span>Sacola</span>{count > 0 && <span data-testid="badge-cart-count" className="store-badge">{count}</span>}</Link>;
}

export function Shell({ children }: { children: ReactNode }) {
  const categories = useListCategories();
  const [path] = useLocation();
  const search = useSearch();
  const activeCategory = path === '/' ? new URLSearchParams(search).get('categoryId') ?? '' : '';
  useEffect(() => {
    if (!window.location.hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [path, search]);
  return (
    <div className="min-h-[100dvh]">
      <Header />
      {!!categories.data?.length && <nav className="shell flex flex-wrap items-center justify-center gap-1.5 border-b border-border py-2" aria-label="Categorias">
        <CategoryLinks categories={categories.data} active={activeCategory} />
      </nav>}
      {children}
      <footer className="mt-16 bg-[#332f2d] text-white">
        <div className="shell grid gap-10 py-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div><div className="text-[22px] font-medium tracking-[-0.06em]">rádio 88<span className="text-[#e18c73]">.</span></div><p className="mt-4 max-w-sm text-sm text-white/70">Produtos da estação, vendidos diretamente. Preço claro, pedido confirmado e atendimento de verdade.</p>
            <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-xs text-white/75" aria-label="Redes sociais">
              <a className="footer-social-link" href="https://www.facebook.com/radio88oficial/" target="_blank" rel="noopener noreferrer" aria-label="Facebook" data-testid="link-social-facebook"><FaFacebookF aria-hidden="true" size={14} /><span>Facebook</span></a>
              <a className="footer-social-link" href="https://www.instagram.com/radio88fm" target="_blank" rel="noopener noreferrer" aria-label="Instagram" data-testid="link-social-instagram"><FaInstagram aria-hidden="true" size={15} /><span>Instagram</span></a>
              <a className="footer-social-link" href="https://www.youtube.com/@radio88oficial" target="_blank" rel="noopener noreferrer" aria-label="YouTube" data-testid="link-social-youtube"><FaYoutube aria-hidden="true" size={16} /><span>YouTube</span></a>
              <a className="footer-social-link" href="https://www.tiktok.com/@radio88fm" target="_blank" rel="noopener noreferrer" aria-label="TikTok" data-testid="link-social-tiktok"><FaTiktok aria-hidden="true" size={14} /><span>TikTok</span></a>
            </div>
          </div>
          <div><div className="mb-4 text-sm text-white/60">Categorias</div><div className="grid gap-3 text-sm">{categories.data?.length ? categories.data.map(c => <Link key={c.id} href={`/?categoryId=${encodeURIComponent(c.id)}`} className="flex items-center gap-2"><CategoryIconView category={c} size={15} />{c.name}</Link>) : <span className="text-white/50">Em breve</span>}</div></div>
          <div><div className="mb-4 text-sm text-white/60">Atendimento</div><div className="grid gap-3 text-sm"><Link href="/contact" data-testid="link-footer-contact">Fale conosco</Link><a href={STORE_CONTACT.whatsappUrl} target="_blank" rel="noopener noreferrer" data-testid="link-footer-whatsapp">WhatsApp: {STORE_CONTACT.whatsappLabel}<span className="sr-only"> (abre em nova aba)</span></a><a href={`mailto:${STORE_CONTACT.email}`} className="break-all" data-testid="link-footer-email">{STORE_CONTACT.email}</a><span>Horário: {STORE_CONTACT.hours}</span><Link href="/orders">Meus pedidos</Link><Link href="/account">Minha conta</Link><Link href="/returns">Trocas e devoluções</Link></div></div>
          <div><div className="mb-4 text-sm text-white/60">Transparência</div><div className="grid gap-3 text-sm"><Link href="/terms">Termos de uso</Link><Link href="/privacy">Privacidade (LGPD)</Link><Link href="/cookies">Política de cookies</Link><Link href="/returns">Trocas e devoluções</Link><CookiePreferencesReopen /></div></div>
        </div>
         <div className="border-t border-white/10 py-4 text-center text-xs text-white/60">
           <p className="m-0">Rádio 88 FM · Comércio direto, com cuidado e transparência.</p>
            <p className="m-0 mt-1">© 2026 Rádio 88 FM. Todos os direitos reservados.</p>
           <AccessibilityPreferencesButton />
         </div>
      </footer>
      <CookiePreferences />
    </div>
  );
}
