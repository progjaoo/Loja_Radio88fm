import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { useAuth } from '@clerk/react';
import { useListFavorites, getListFavoritesQueryKey } from '@workspace/api-client-react';
import { Heart, LockKeyhole, Radio, SlidersHorizontal } from 'lucide-react';
import { ErrorState, Loading } from '@/components/feedback';
import { ProductCard } from '@/components/product-ui';
export { FavoriteToggle } from '@/components/favorite-toggle';

const PREF_KEY = 'radio88.cookie-preferences.v1';
const PREF_EVENT = 'radio88:open-cookie-preferences';
type Preferences = { chosen: boolean; essential: true; analytics: boolean; savedAt: string | null };
const defaultPreferences: Preferences = { chosen: false, essential: true, analytics: false, savedAt: null };
const readPreferences = (): Preferences => {
  try {
    const stored = localStorage.getItem(PREF_KEY);
    if (!stored) return defaultPreferences;
    const parsed = JSON.parse(stored) as Partial<Preferences>;
    return {
      chosen: parsed.chosen === true,
      essential: true,
      analytics: parsed.chosen === true && parsed.analytics === true,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : null,
    };
  } catch {
    return defaultPreferences;
  }
};
const savePreferences = (analytics: boolean): Preferences => {
  const next: Preferences = { chosen: true, essential: true, analytics, savedAt: new Date().toISOString() };
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(next));
  } catch {
    // Keep the current choice for this page even when browser storage is unavailable.
  }
  window.dispatchEvent(new Event('radio88:cookie-preference-saved'));
  return next;
};

function PreferencesDialog({
  initialAnalytics,
  onClose,
  onSave,
}: {
  initialAnalytics: boolean;
  onClose: () => void;
  onSave: (analytics: boolean) => void;
}) {
  const [analytics, setAnalytics] = useState(initialAnalytics);
  return <div className="cookie-scrim" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="cookie-dialog" role="dialog" aria-modal="true" aria-labelledby="cookie-dialog-title" data-testid="cookie-preferences-dialog" onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
      <button className="cookie-dialog-close" type="button" onClick={onClose} aria-label="Fechar preferências" data-testid="button-close-cookie-preferences">×</button>
      <div className="eyebrow">PREFERÊNCIAS DE PRIVACIDADE · RÁDIO 88 FM</div><h2 id="cookie-dialog-title" className="display">Você escolhe.</h2>
      <p>Cookies essenciais mantêm funções básicas da loja. Analytics é opcional; nenhuma métrica opcional é enviada enquanto não houver uma ferramenta de análise ativa.</p>
      <div className="cookie-setting"><span><strong>Essenciais</strong><small>Necessários para o funcionamento principal da loja.</small></span><span className="always-on">Sempre ativos</span></div>
      <label className="cookie-setting cookie-setting-toggle" htmlFor="cookie-analytics">
        <span><strong>Analytics opcionais</strong><small>Autorize métricas de uso caso a ferramenta de análise seja ativada.</small></span>
        <input id="cookie-analytics" type="checkbox" checked={analytics} onChange={event => setAnalytics(event.target.checked)} data-testid="checkbox-cookie-analytics" />
      </label>
      <button type="button" onClick={() => onSave(analytics)} className="button w-full" data-testid="button-save-cookie-preferences">Salvar preferências</button>
    </section>
  </div>;
}

export function CookiePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    const refresh = () => setPreferences(readPreferences());
    window.addEventListener(PREF_EVENT, show);
    window.addEventListener('radio88:cookie-preference-saved', refresh);
    return () => {
      window.removeEventListener(PREF_EVENT, show);
      window.removeEventListener('radio88:cookie-preference-saved', refresh);
    };
  }, []);
  const choose = (analytics: boolean) => {
    const next = savePreferences(analytics);
    setPreferences(next);
    setOpen(false);
  };
  return <>
     {!preferences.chosen && <aside className="cookie-banner" aria-label="Preferências de cookies" data-testid="cookie-consent-banner">
       <div className="cookie-banner-copy">
         <span className="eyebrow">SUA PRIVACIDADE · RÁDIO 88 FM</span>
         <p>Cookies essenciais mantêm a loja funcionando. Analytics é opcional e só deve ser ativado com sua autorização. Leia a <Link href="/cookies" data-testid="link-cookie-policy">Política de cookies</Link>, a <Link href="/privacy" data-testid="link-cookie-privacy">Política de privacidade</Link> e os <Link href="/terms" data-testid="link-cookie-terms">Termos de uso</Link>.</p>
       </div>
       <div className="cookie-banner-actions">
         <button type="button" className="cookie-action cookie-action-settings" onClick={() => setOpen(true)} data-testid="button-cookie-options">Configurações de cookies</button>
         <button type="button" className="cookie-action cookie-action-reject" onClick={() => choose(false)} data-testid="button-cookie-reject">Rejeitar todos</button>
         <button type="button" className="cookie-action cookie-action-accept" onClick={() => choose(true)} data-testid="button-cookie-accept">Aceitar todos os cookies</button>
       </div>
     </aside>}
     {open && <PreferencesDialog initialAnalytics={preferences.analytics} onClose={() => setOpen(false)} onSave={choose} />}
  </>;
}

export function CookiePolicyPage() {
  const [preferences, setPreferences] = useState<Preferences>(readPreferences);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const refresh = () => setPreferences(readPreferences());
    window.addEventListener('radio88:cookie-preference-saved', refresh);
    return () => window.removeEventListener('radio88:cookie-preference-saved', refresh);
  }, []);
  return <main className="shell legal-page">
    <div className="eyebrow">TRANSPARÊNCIA DIGITAL · RÁDIO 88 FM</div><h1 className="display">Política de cookies</h1>
    <p className="legal-lede">Uma explicação direta do que fica no seu navegador e por quê.</p>
    <article className="legal-copy">
      <h2>Cookies essenciais</h2><p>Utilizamos cookies essenciais e armazenamento local para manter as funções principais da loja, lembrar sua escolha de preferências e, quando você compra sem conta, manter a sacola somente neste navegador. Esses recursos são necessários para a operação do site.</p>
      <h2>Analytics opcionais</h2><p>Você pode autorizar métricas opcionais nas preferências. Atualmente, a loja ainda não tem uma ferramenta de analytics ativa, então nenhuma métrica opcional é enviada.</p>
      <h2>Preferências salvas</h2><p>A escolha fica salva neste navegador. Cookies essenciais continuam ativos; Analytics permanece desativado por padrão e só será permitido se você aceitar. Use “Preferências de cookies” no rodapé para rever a escolha.</p>
    </article>
    <div className="cookie-current" data-testid="text-cookie-current"><span><strong>Essenciais</strong><small>Ativos para o funcionamento da loja</small></span><span><strong>Analytics</strong><small>{preferences.analytics ? 'Consentidos, sem ferramenta ativa' : 'Desativados'}</small></span><span><strong>Sua escolha</strong><small>{preferences.chosen ? 'Salva neste navegador' : 'Ainda não registrada'}</small></span></div>
    <button type="button" className="button mt-6" onClick={() => setEditing(true)} data-testid="button-edit-cookie-preferences"><SlidersHorizontal size={16} />Rever preferências</button>
    {editing && <PreferencesDialog initialAnalytics={preferences.analytics} onClose={() => setEditing(false)} onSave={analytics => { setPreferences(savePreferences(analytics)); setEditing(false); }} />}
  </main>;
}

export function CookiePreferencesReopen() {
  return <button type="button" className="footer-cookie-link" onClick={() => window.dispatchEvent(new Event(PREF_EVENT))} data-testid="button-reopen-cookie-preferences">Preferências de cookies</button>;
}

export function FavoritesPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const query = useListFavorites({ query: { enabled: !!isSignedIn, queryKey: getListFavoritesQueryKey() } });
  if (!isLoaded) return <main className="shell store-page"><Loading label="Verificando sua conta" /></main>;
  if (!isSignedIn) return <main className="shell store-page"><section className="store-empty"><span className="store-empty-mark"><LockKeyhole size={21} /></span><div className="eyebrow">FAVORITOS DA SUA CONTA</div><h1 className="display">Sua seleção merece ficar guardada.</h1><p>Entre na sua conta para ver e salvar produtos favoritos. Favoritos não são armazenados sem login.</p><Link href="/sign-in" className="button mt-4" data-testid="link-favorites-signin">Entrar na Rádio 88 FM</Link></section></main>;
  return <main className="shell store-page"><div className="store-page-head"><div><div className="eyebrow">GUARDADOS NA SUA CONTA</div><h1 className="display">Seus favoritos</h1><p>Itens oficiais que você marcou para voltar depois.</p></div><span className="store-step"><Heart size={17} /> 88</span></div>
    {query.isLoading ? <Loading /> : query.isError ? <ErrorState retry={() => query.refetch()} /> : !query.data?.length ? <section className="store-empty"><span className="store-empty-mark"><Radio size={22} /></span><h2 className="display">Ainda não marcou nenhum.</h2><p>Toque em “Favoritar” na página de um produto para guardar por aqui.</p><Link href="/" className="button mt-4" data-testid="link-empty-favorites-shop">Ir para a vitrine</Link></section> : <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4" data-testid="grid-favorites">{query.data.map(product => <ProductCard key={product.id} product={product} />)}</div>}
  </main>;
}
