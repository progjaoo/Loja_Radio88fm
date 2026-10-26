import { useState } from 'react';
import { toast } from 'sonner';

const SIENNA_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/sienna-accessibility@2.2.333/dist/sienna-accessibility.umd.js';
let triggerPromise: Promise<HTMLAnchorElement> | null = null;

function loadSiennaTrigger(): Promise<HTMLAnchorElement> {
  const existing = document.querySelector<HTMLAnchorElement>('.asw-menu-btn');
  if (existing) return Promise.resolve(existing);
  if (triggerPromise) return triggerPromise;

  const pending = new Promise<HTMLAnchorElement>((resolve, reject) => {
    let settled = false;
    const observer = new MutationObserver(() => {
      const trigger = document.querySelector<HTMLAnchorElement>('.asw-menu-btn');
      if (trigger) finish(() => resolve(trigger));
    });
    const timeout = window.setTimeout(
      () => finish(() => reject(new Error('Tempo esgotado ao carregar as opções de acessibilidade.'))),
      10000,
    );
    const script = document.createElement('script');
    script.src = SIENNA_SCRIPT_URL;
    script.async = true;
    script.dataset.lang = 'pt';
    script.dataset.position = 'bottom-right';
    script.dataset.offset = '16,16';
    script.onerror = () => finish(() => reject(new Error('Não foi possível carregar as opções de acessibilidade.')));
    script.onload = () => {
      const trigger = document.querySelector<HTMLAnchorElement>('.asw-menu-btn');
      if (trigger) finish(() => resolve(trigger));
    };

    function finish(action: () => void) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      observer.disconnect();
      action();
    }

    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.head.appendChild(script);
  });
  const handled = pending.catch(error => {
    triggerPromise = null;
    throw error;
  });
  triggerPromise = handled;
  return handled;
}

export function AccessibilityPreferencesButton() {
  const [loading, setLoading] = useState(false);

  const openPreferences = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const trigger = await loadSiennaTrigger();
      trigger.click();
    } catch {
      toast.error('Não foi possível abrir as opções de acessibilidade. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      className="footer-accessibility-link"
      onClick={() => void openPreferences()}
      disabled={loading}
      aria-label="Abrir opções de acessibilidade"
      data-testid="footer-accessibility-button"
    >
      {loading ? 'Carregando…' : 'Acessibilidade'}
    </button>
  );
}
