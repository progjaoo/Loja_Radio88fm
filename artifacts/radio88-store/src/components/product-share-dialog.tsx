import { useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import { FaWhatsapp } from 'react-icons/fa';
import type { Product } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { fromPrice } from '@/components/product-ui';
import { money } from '@/lib/format';
import { toast } from 'sonner';

export function ProductShareDialog({ product }: { product: Product }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${window.location.pathname}`;
  const price = fromPrice(product);
  const shareText = `${product.name} — Rádio 88 FM\n${url}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

  const copyLink = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const field = document.createElement('textarea');
        field.value = url;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        const didCopy = document.execCommand('copy');
        field.remove();
        if (!didCopy) throw new Error('Clipboard API indisponível');
      }
      setCopied(true);
      toast.success('Link do produto copiado.');
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      toast.error('Não foi possível copiar o link neste navegador.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="product-share-button" aria-label={`Compartilhar ${product.name}`} data-testid="button-share-product">
          <Share2 size={15} aria-hidden="true" /><span>Compartilhar</span>
        </button>
      </DialogTrigger>
      <DialogContent className="product-share-dialog" data-testid="dialog-share-product">
        <DialogHeader className="product-share-dialog-header">
          <DialogTitle>Compartilhar este produto</DialogTitle>
          <DialogDescription>Envie a página deste produto para alguém.</DialogDescription>
        </DialogHeader>
        <div className="product-share-preview">
          <div className="product-share-preview-image">
            {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span>Rádio 88 FM</span>}
          </div>
          <div className="product-share-preview-copy">
            <strong>{product.name}</strong>
            <span>{product.categoryName ?? 'Rádio 88 FM'}</span>
            {price !== null && <span>{product.variants.length > 1 ? 'A partir de ' : ''}{money(price)}</span>}
          </div>
        </div>
        <div className="product-share-actions">
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className="product-share-option" data-testid="link-share-whatsapp">
            <FaWhatsapp size={27} aria-hidden="true" /><span>WhatsApp</span>
          </a>
          <button type="button" onClick={() => void copyLink()} className="product-share-option" data-testid="button-copy-product-link">
            {copied ? <Check size={25} aria-hidden="true" /> : <Copy size={25} aria-hidden="true" />}
            <span>{copied ? 'Link copiado' : 'Copiar link'}</span>
          </button>
        </div>
        <span className="sr-only" aria-live="polite">{copied ? 'Link do produto copiado para a área de transferência.' : ''}</span>
      </DialogContent>
    </Dialog>
  );
}
