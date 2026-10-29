import { useState } from 'react';
import { LEGAL_DOCUMENTS, LEGAL_UPDATED_AT, LEGAL_VERSION, type LegalDocumentType } from '@/lib/legal-documents';
import { LegalDocumentContent } from '@/components/legal-pages';
import { Link } from 'wouter';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type LegalDocumentDialogProps = {
  type: LegalDocumentType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function LegalDocumentDialog({ type, open, onOpenChange }: LegalDocumentDialogProps) {
  if (!type) return null;
  const document = LEGAL_DOCUMENTS[type];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto border-border bg-background sm:max-w-2xl" data-testid={`dialog-legal-${type}`}>
        <DialogHeader className="text-left">
          <div className="eyebrow text-foreground">RÁDIO 88 FM · INFORMAÇÃO CLARA</div>
          <DialogTitle className="display mt-2 text-3xl font-medium">{document.title}</DialogTitle>
          <DialogDescription>{document.introduction}</DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">Atualização: {LEGAL_UPDATED_AT} · Versão {LEGAL_VERSION}</p>
        <LegalDocumentContent type={type} />
        <Link href={type === 'privacy' ? '/privacy' : type === 'returns' ? '/returns' : '/terms'} target="_blank" rel="noopener noreferrer" className="text-sm underline">Abrir página completa em nova aba</Link>
      </DialogContent>
    </Dialog>
  );
}

type TermsAcceptanceProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  checkboxTestId: string;
  termsTestId: string;
  privacyTestId: string;
  className?: string;
};

export function TermsAcceptance({
  checked,
  onCheckedChange,
  checkboxTestId,
  termsTestId,
  privacyTestId,
  className,
}: TermsAcceptanceProps) {
  const [documentType, setDocumentType] = useState<LegalDocumentType | null>(null);

  return (
    <div className={`terms-choice ${className ?? ''}`}>
      <input
        id={checkboxTestId}
        data-testid={checkboxTestId}
        type="checkbox"
        checked={checked}
        onChange={event => onCheckedChange(event.target.checked)}
      />
      <span className="terms-choice-copy">
        <label htmlFor={checkboxTestId}>Li e aceito os </label>
        <button
          type="button"
          className="terms-choice-trigger"
          aria-haspopup="dialog"
          aria-label="Ler os Termos de uso"
          data-testid={termsTestId}
          onClick={() => setDocumentType('terms')}
        >Termos de uso</button>
        {' e estou ciente da '}
        <button
          type="button"
          className="terms-choice-trigger"
          aria-haspopup="dialog"
          aria-label="Ler a Política de privacidade"
          data-testid={privacyTestId}
          onClick={() => setDocumentType('privacy')}
        >Política de privacidade</button>.
        <span className="mt-2 block text-xs">Consulte também <Link className="underline" href="/returns" target="_blank" rel="noopener noreferrer">Trocas e devoluções (nova aba)</Link> e <Link className="underline" href="/contact" target="_blank" rel="noopener noreferrer">Atendimento (nova aba)</Link>. Marketing e analytics opcionais não fazem parte deste aceite.</span>
      </span>
      <LegalDocumentDialog
        type={documentType}
        open={documentType !== null}
        onOpenChange={open => { if (!open) setDocumentType(null); }}
      />
    </div>
  );
}
