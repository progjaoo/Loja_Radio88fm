import { CircleAlert, CircleCheck, CircleHelp } from 'lucide-react';

export function Notice({ text, kind = 'error' }: { text: string; kind?: 'error' | 'success' }) {
  const Icon = kind === 'error' ? CircleAlert : CircleCheck;
  return (
    <div role="status" data-testid="status-feedback" className="flex items-start gap-3 rounded-[20px] bg-card px-4 py-3 text-sm shadow-soft ring-1 ring-border">
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span><span className="sr-only">{kind === 'error' ? 'Aviso: ' : 'Confirmação: '}</span>{text}</span>
    </div>
  );
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="grid gap-3 py-8">
      <div className="h-5 w-40 animate-pulse rounded-full bg-border" />
      <div className="h-24 animate-pulse rounded-[28px] bg-card shadow-soft" />
      <div className="h-24 animate-pulse rounded-[28px] bg-card shadow-soft" />
    </div>
  );
}

export function ErrorState({ retry, message = 'Não conseguimos carregar estas informações.' }: { retry: () => void; message?: string }) {
  return (
    <div className="rounded-[28px] bg-card p-8 text-center shadow-soft">
      <CircleHelp className="mx-auto mb-3" aria-hidden="true" />
      <h3 className="display text-xl">Algo saiu do ar</h3>
      <p className="my-2 text-sm text-muted-foreground">{message}</p>
      <button className="button button-outline mt-2" onClick={retry} data-testid="button-retry">Tentar de novo</button>
    </div>
  );
}
