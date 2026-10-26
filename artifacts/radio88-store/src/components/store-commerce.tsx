import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  useGetCart, useUpdateCartLine, useRemoveCartLine, useQuoteShipping, useQuoteGuestShipping,
  useCreateCheckout, useCreateGuestCheckout, useGetProfile, useListAddresses, useAddCartLine, useGetProduct,
  getGetCartQueryKey, getListMyOrdersQueryKey, getGetProfileQueryKey, getListAddressesQueryKey, getQuoteShippingQueryKey,
  getGetProductQueryKey,
} from '@workspace/api-client-react';
import type { Address, Cart, CartLine, GuestCheckoutInput, Order, ShippingOption } from '@workspace/api-client-react';
import { ArrowRight, ChevronLeft, ChevronRight, MapPin, Maximize2, Minus, Plus, ShieldCheck, ShoppingBag, Trash2 } from 'lucide-react';
import { money } from '@/lib/format';
import { formatBrazilPhone, phoneDigits } from '@/lib/phone-format';
import { userFacingError } from '@/lib/user-facing-errors';
import { usePostalAddress } from '@/lib/postal-address';
import { PostalLookupStatus } from '@/components/postal-lookup-status';
import { ErrorState, Loading, Notice } from '@/components/feedback';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { effectiveVariantPrice, ProductImage } from '@/components/product-ui';
import { ProductShareDialog } from '@/components/product-share-dialog';
import { FavoriteToggle } from '@/components/shop-support';
import { TermsAcceptance } from '@/components/legal-document-dialog';
import { addGuestProduct, clearGuestCart, removeGuestLine, updateGuestQuantity, useGuestCart } from '@/lib/guest-cart';

const digits = (value: string) => value.replace(/\D/g, '').slice(0, 8);
const onlyNumbers = (value: string) => value.replace(/\D/g, '');
const errorMessage = userFacingError;
const pickupAddressText = 'Rua Moacyr de Paula Lobo, 104 · Vila Mury · Volta Redonda - RJ · CEP 27283-350';
const pickupMapUrl = 'https://www.google.com/maps/place/R.+Moacyr+de+Paula+Lobo,+104+-+Vila+Mury,+Volta+Redonda+-+RJ,+27283-350/@-22.495987,-44.1015592,17z/data=!3m1!4b1!4m6!3m5!1s0x9e97fee362d30b:0xeaea7ca1989a382!8m2!3d-22.495987!4d-44.0989843!16s%2Fg%2F11v12zx2md?entry=ttu&g_ep=EgoyMDI2MTAwNi4wIKXMDSoASAFQAw%3D%3D';
const pickupOption: ShippingOption = {
  id: 'retirada-combinada',
  label: 'Retirada no local — Rádio 88 FM',
  method: 'pickup',
  fee: 0,
  estimatedDays: 0,
  description: 'Economize no frete e aproveite para visitar a Rádio 88 FM.',
};

function Lines({ cart, guest = false }: { cart: Cart; guest?: boolean }) {
  const update = useUpdateCartLine();
  const remove = useRemoveCartLine();
  const qc = useQueryClient();
  if (!cart.lines.length) return <div className="store-empty">
    <span className="store-empty-mark"><ShoppingBag size={22} /></span>
    <h2 className="display">Ainda não tem nada na sacola.</h2>
    <p>Escolha um item da loja oficial e ele fica por aqui.</p>
    <Link href="/" className="button mt-4" data-testid="link-empty-cart-shop">Conhecer a vitrine</Link>
  </div>;
  return <div className="store-lines">{cart.lines.map(line => <article className="store-line" key={line.id} data-testid={`cart-line-${line.variantId}`}>
    <ProductImage src={line.imageUrl} name={line.productName} className="store-line-image" />
    <div className="store-line-main">
      <div><h2>{line.productName}</h2><p>{line.variantName} <span aria-hidden="true">·</span> SKU {line.sku}</p><strong>{money(line.unitPrice)}</strong></div>
      <div className="store-line-actions">
        <div className="quantity-control" aria-label={`Quantidade de ${line.productName}`}>
          <button type="button" aria-label="Diminuir quantidade" data-testid={`button-decrease-${line.variantId}`} disabled={line.quantity <= 1 || (!guest && update.isPending)} onClick={() => guest ? updateGuestQuantity(line.variantId, line.quantity - 1) : update.mutate({ lineId: line.id, data: { quantity: line.quantity - 1 } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetCartQueryKey() }) })}><Minus size={14} /></button>
          <span data-testid={`text-quantity-${line.variantId}`}>{line.quantity}</span>
          <button type="button" aria-label="Aumentar quantidade" data-testid={`button-increase-${line.variantId}`} disabled={line.quantity >= Math.min(20, line.stockAvailable) || (!guest && update.isPending)} onClick={() => guest ? updateGuestQuantity(line.variantId, line.quantity + 1) : update.mutate({ lineId: line.id, data: { quantity: line.quantity + 1 } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetCartQueryKey() }) })}><Plus size={14} /></button>
        </div>
        <strong className="line-total">{money(line.lineTotal)}</strong>
        <button type="button" className="remove-line" data-testid={`button-remove-${line.variantId}`} onClick={() => guest ? removeGuestLine(line.variantId) : remove.mutate({ lineId: line.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetCartQueryKey() }) })}><Trash2 size={15} /><span>Remover</span></button>
      </div>
    </div>
  </article>)}{!guest && (update.isError || remove.isError) && <Notice text={errorMessage(update.error || remove.error)} />}</div>;
}

export function StoreCartPage() {
  const { isSignedIn } = useAuth();
  const accountCart = useGetCart({ query: { enabled: !!isSignedIn, queryKey: getGetCartQueryKey() } });
  const guestCart = useGuestCart();
  const cart = isSignedIn ? accountCart.data : guestCart;
  const query = isSignedIn ? accountCart : null;
  return <main className="shell store-page">
    <div className="store-page-head"><div><div className="eyebrow">RÁDIO 88 FM · SUA ESCOLHA</div><h1 className="display">Sua sacola</h1><p>{isSignedIn ? 'Sacola da sua conta.' : 'Sacola deste navegador, separada da sacola de qualquer conta.'}</p></div><span className="store-step">01 / 03</span></div>
    {query?.isLoading ? <Loading label="Carregando sua sacola" /> : query?.isError ? <ErrorState retry={() => query.refetch()} /> : !cart ? <Loading /> : <div className="store-cart-layout">
      <section aria-label="Itens na sacola"><Lines cart={cart} guest={!isSignedIn} /></section>
      {!!cart.lines.length && <aside className="store-summary">
        <div className="eyebrow">RESUMO DO PEDIDO</div><div className="summary-row"><span>Subtotal</span><strong data-testid="text-cart-subtotal">{money(cart.subtotal)}</strong></div>
        <div className="store-trust-note"><ShieldCheck size={17} /><span>Compra direta da loja oficial. Frete e prazo confirmados antes de finalizar.</span></div>
        <Link href="/checkout" className="button w-full" data-testid="link-checkout">Continuar para entrega <ArrowRight size={16} /></Link>
        {!isSignedIn && <p className="guest-cart-note">Checkout sem conta. Sua sacola permanece local e não será mesclada automaticamente com uma conta.</p>}
      </aside>}
    </div>}
  </main>;
}

export function StoreProductPage() {
  const [, params] = useRoute('/product/:productId');
  const productId = params?.productId ?? '';
  const { isSignedIn } = useAuth();
  const query = useGetProduct(productId, { query: { enabled: !!productId, queryKey: getGetProductQueryKey(productId) } });
  const add = useAddCartLine();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [variantId, setVariantId] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [selectionError, setSelectionError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const sizeGroupRef = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    setVariantId('');
    setImageUrl('');
    setSelectionError(false);
    setLightboxOpen(false);
  }, [productId]);
  const product = query.data;
  useEffect(() => {
    if (variantId && product && !product.variants.some(variant => variant.id === variantId && variant.stock > 0)) {
      setVariantId('');
      setSelectionError(false);
    }
  }, [product, variantId]);
  if (query.isLoading) return <main className="shell store-page"><Loading label="Carregando produto" /></main>;
  if (query.isError || !product) return <main className="shell store-page"><ErrorState retry={() => query.refetch()} message="Este produto pode ter sido removido ou estar indisponível." /></main>;
  const galleryLayout = product.galleryLayout === 'portrait' ? 'portrait' : 'square';
  const sizeOptions = product.variants.length > 0 && product.variants.every(variant =>
    Boolean(variant.size?.trim()) || /^(?:TAMANHO\s*)?(?:PP|P|M|G|GG|XG|XGG|XXG)$/i.test(variant.name.trim()),
  ) && galleryLayout === 'portrait';
  const requiresOption = sizeOptions || product.variants.length > 1;
  const selectedVariant = product.variants.find(variant => variant.id === variantId);
  const selected = selectedVariant && selectedVariant.stock > 0
    ? selectedVariant
    : !sizeOptions && product.variants.length === 1 && product.variants[0].stock > 0
      ? product.variants[0]
      : undefined;
  const addToBag = () => {
    if (!selected) {
      if (requiresOption) {
        setSelectionError(true);
        sizeGroupRef.current?.focus();
      }
      return;
    }
    if (!isSignedIn) {
      addGuestProduct(product, selected);
      navigate('/cart');
      return;
    }
    add.mutate({ data: { variantId: selected.id, quantity: 1 } }, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getGetCartQueryKey() });
        navigate('/cart');
      },
      onError: error => toast.error(userFacingError(error)),
    });
  };
  const images = [...(product.images ?? [])].sort((left, right) => left.sortOrder - right.sortOrder);
  const cover = images.find(item => item.isPrimary) ?? images.find(item => item.url === product.imageUrl) ?? images[0];
  const activeImage = images.find(item => item.url === imageUrl) ?? cover;
  const selectedImage = activeImage?.url ?? product.imageUrl;
  const activeImageIndex = activeImage ? images.findIndex(item => item.id === activeImage.id) : -1;
  const effectivePrices = product.variants.map(variant => Math.round(effectiveVariantPrice(product, variant) * 100));
  const lowestPriceCents = effectivePrices.length ? Math.min(...effectivePrices) : null;
  const hasPriceRange = effectivePrices.some(price => price !== lowestPriceCents);
  const selectedPrice = selected ? effectiveVariantPrice(product, selected) : 0;
  const moveImage = (direction: number) => {
    if (images.length < 2) return;
    const nextIndex = (activeImageIndex + direction + images.length) % images.length;
    setImageUrl(images[nextIndex].url);
  };
  const cleanDescription = product.description
    .replace(/\s*A galeria reúne a arte da frente e das costas e fotos de referência no manequim\.?/i, '')
    .trim();
  const allVariantsUnavailable = product.variants.length > 0 && product.variants.every(variant => variant.stock <= 0);
  return <main className="shell store-page product-detail">
    <div className="product-detail-grid">
      <div className={`product-gallery-wrap ${images.length > 1 ? 'has-thumbnails' : 'single-image'}`}>
        <nav className="product-breadcrumb" aria-label="Caminho da página" data-testid="product-breadcrumb">
          <ol>
            <li><Link href="/" data-testid="link-product-breadcrumb-home">Vitrine</Link></li>
            <li aria-hidden="true"><ChevronRight size={14} /></li>
            <li>
              {product.categoryId
                ? <Link href={`/?categoryId=${encodeURIComponent(product.categoryId)}`} data-testid="link-product-breadcrumb-category">{product.categoryName ?? 'Rádio 88 FM'}</Link>
                : <span>{product.categoryName ?? 'Rádio 88 FM'}</span>}
            </li>
            <li aria-hidden="true"><ChevronRight size={14} /></li>
            <li aria-current="page">{product.name}</li>
          </ol>
        </nav>
        {selectedImage ? <div className={`product-detail-image ${galleryLayout}`}>
          <img src={selectedImage} alt={activeImage?.alt || product.name} decoding="async" data-testid="img-product-main" />
          {images.length > 1 && <>
            <button type="button" className="product-gallery-arrow previous" aria-label="Ver foto anterior" onClick={() => moveImage(-1)}><ChevronLeft size={19} /></button>
            <button type="button" className="product-gallery-arrow next" aria-label="Ver próxima foto" onClick={() => moveImage(1)}><ChevronRight size={19} /></button>
            <span className="product-gallery-counter" aria-live="polite">{Math.max(activeImageIndex + 1, 1)} / {images.length}</span>
          </>}
          <button type="button" className="product-image-zoom" onClick={() => setLightboxOpen(true)} aria-label={`Ampliar foto: ${activeImage?.alt || product.name}`}>
            <Maximize2 size={15} /><span>Ampliar foto</span>
          </button>
        </div> : <ProductImage src={null} name={product.name} className={`product-detail-image ${galleryLayout}`} />}
        {images.length > 1 && <div className={`product-detail-thumbnails has-thumbnails ${galleryLayout}`} role="group" aria-label={`Fotos de ${product.name}`}>{images.map((image, index) => <button type="button" key={image.id} className={activeImage?.id === image.id ? 'selected' : ''} onClick={() => setImageUrl(image.url)} aria-label={`Ver foto ${index + 1} de ${images.length}: ${image.alt}`} aria-pressed={activeImage?.id === image.id} data-testid={`button-select-product-image-${index}`}><img src={image.url} alt="" loading="lazy" decoding="async" /></button>)}</div>}
      </div>
      <section className="product-detail-copy">
        <div className="product-detail-heading-row">
          <div className="eyebrow">{product.categoryName ?? 'RÁDIO 88 FM · OFICIAL'}</div>
          <div className="product-detail-actions"><ProductShareDialog product={product} /><FavoriteToggle product={product} className="product-detail-favorite" /></div>
        </div>
        <h1 className="display">{product.name}</h1>
        {cleanDescription && <p className="product-description">{cleanDescription}</p>}
        <div className="product-detail-price-row">
          {selected
            ? <div className="selected-size-price">{selectedPrice < selected.price && <del>{money(selected.price)}</del>}<strong>{money(selectedPrice)}</strong></div>
            : <div className="selected-size-price">{lowestPriceCents !== null && <><span>{hasPriceRange ? 'A partir de ' : ''}</span><strong>{money(lowestPriceCents / 100)}</strong></>}</div>}
        </div>
        {sizeOptions
          ? <fieldset className="variant-list size-variant-list" ref={sizeGroupRef} tabIndex={-1} aria-describedby={selectionError ? 'product-option-error' : undefined}>
              <legend className="product-option-legend">ESCOLHA SEU TAMANHO</legend>
              <div className="size-variant-options">{product.variants.map(variant => <label key={variant.id} className={`variant-option size-variant-option ${selected?.id === variant.id ? 'selected' : ''}`} data-testid={`button-variant-${variant.id}`}>
                <input type="radio" name={`product-size-${product.id}`} value={variant.id} checked={selected?.id === variant.id} disabled={variant.stock <= 0} onChange={() => { setVariantId(variant.id); setSelectionError(false); }} />
                <strong>{variant.size || variant.name}</strong><small>{variant.stock > 0 ? 'Disponível' : 'Esgotado'}</small>
              </label>)}</div>
            </fieldset>
          : <>
              {requiresOption && <div className="product-option-legend">ESCOLHA UMA OPÇÃO</div>}
              {product.variants.length > 1 && <div className="variant-list">{product.variants.map(variant => {
          const price = effectiveVariantPrice(product, variant);
           return <button type="button" key={variant.id} aria-pressed={selected?.id === variant.id} aria-label={`${variant.name}, ${variant.stock > 0 ? 'disponível' : 'indisponível'}`} disabled={variant.stock <= 0} data-testid={`button-variant-${variant.id}`} className={`variant-option ${selected?.id === variant.id ? 'selected' : ''}`} onClick={() => { setVariantId(variant.id); setSelectionError(false); }}>
             <span><strong>{variant.name}</strong><small>{variant.stock > 0 ? `${variant.stock} disponíveis` : 'Indisponível'}</small></span>
             <strong>{price < variant.price && <del>{money(variant.price)}</del>}{money(price)}</strong>
          </button>;
        })}</div>}
            </>}
        {selectionError && <p id="product-option-error" className="product-option-error" role="alert">Escolha uma opção disponível antes de adicionar à sacola.</p>}
        <button type="button" className="button w-full mt-5" data-testid="button-add-to-cart" disabled={!product.variants.length || allVariantsUnavailable || (selected !== undefined && selected.stock <= 0) || (isSignedIn && add.isPending)} onClick={addToBag}>{isSignedIn && add.isPending ? 'Adicionando…' : selected ? 'Adicionar à sacola' : allVariantsUnavailable ? 'Indisponível' : requiresOption ? sizeOptions ? 'Selecione um tamanho' : 'Selecione uma opção' : 'Indisponível'}</button>
        <p className="product-assurance"><ShieldCheck size={16} />Pedido confirmado antes do pagamento. Instruções oficiais via PIX após a compra.</p>
      </section>
    </div>
    <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
      <DialogContent className="product-lightbox-dialog" aria-describedby="product-lightbox-description">
        <DialogTitle className="sr-only">Foto ampliada de {product.name}</DialogTitle>
        <DialogDescription id="product-lightbox-description" className="sr-only">Use as setas para navegar pelas fotos deste produto.</DialogDescription>
        <div className="product-lightbox-content">
          {images.length > 1 && <button type="button" className="product-lightbox-arrow" aria-label="Foto anterior" onClick={() => moveImage(-1)}><ChevronLeft size={22} /></button>}
          {selectedImage && <img src={selectedImage} alt={activeImage?.alt || product.name} decoding="async" />}
          {images.length > 1 && <button type="button" className="product-lightbox-arrow" aria-label="Próxima foto" onClick={() => moveImage(1)}><ChevronRight size={22} /></button>}
        </div>
        {images.length > 1 && <p className="product-lightbox-count">{Math.max(activeImageIndex + 1, 1)} de {images.length}</p>}
      </DialogContent>
    </Dialog>
  </main>;
}

const fiscalFields = [
  'fiscalTaxNumber', 'fiscalLegalName', 'fiscalPostalCode', 'fiscalStreet', 'fiscalNumber',
  'fiscalComplement', 'fiscalNeighborhood', 'fiscalCity', 'fiscalState', 'fiscalMunicipalityCode',
] as const;

const hasFiscalData = (values: Pick<GuestFields, typeof fiscalFields[number]>) =>
  fiscalFields.some(key => values[key].trim().length > 0);

const makeFiscalRecipient = (values: GuestFields) => hasFiscalData(values) ? ({
  taxNumber: onlyNumbers(values.fiscalTaxNumber),
  legalName: values.fiscalLegalName.trim(),
  address: {
    postalCode: digits(values.fiscalPostalCode),
    street: values.fiscalStreet.trim(),
    number: values.fiscalNumber.trim(),
    complement: values.fiscalComplement.trim() || null,
    neighborhood: values.fiscalNeighborhood.trim(),
    city: values.fiscalCity.trim(),
    state: values.fiscalState.trim().toUpperCase(),
    municipalityCode: onlyNumbers(values.fiscalMunicipalityCode),
  },
}) : undefined;

const guestCheckoutSchema = (pickup: boolean, guestCheckout: boolean) => {
  const deliveryField = (label: string) => !guestCheckout || pickup
    ? z.string()
    : z.string().refine(value => value.trim().length > 0, `Informe ${label}.`);

  return z.object({
    fullName: guestCheckout ? z.string().refine(value => value.trim().length >= 2, 'Informe seu nome completo.') : z.string(),
    email: guestCheckout ? z.string().email('Informe um e-mail válido.') : z.string(),
    phone: guestCheckout ? z.string().refine(value => {
      const length = onlyNumbers(value).length;
      return length >= 10 && length <= 13;
    }, 'Informe um telefone válido com DDD.') : z.string(),
    postalCode: !guestCheckout || pickup
      ? z.string()
      : z.string().refine(value => onlyNumbers(value).length === 8, 'Informe um CEP válido.'),
    street: deliveryField('a rua ou avenida'),
    number: deliveryField('o número'),
    complement: z.string(),
    neighborhood: deliveryField('o bairro'),
    city: deliveryField('a cidade'),
    state: !guestCheckout || pickup
      ? z.string()
      : z.string().refine(value => value.trim().length === 2, 'Informe a UF com duas letras.'),
    fiscalTaxNumber: z.string(),
    fiscalLegalName: z.string(),
    fiscalPostalCode: z.string(),
    fiscalStreet: z.string(),
    fiscalNumber: z.string(),
    fiscalComplement: z.string(),
    fiscalNeighborhood: z.string(),
    fiscalCity: z.string(),
    fiscalState: z.string(),
    fiscalMunicipalityCode: z.string(),
  }).superRefine((values, context) => {
    if (!hasFiscalData(values)) return;
    const requiredFiscalValues = [
      ['fiscalTaxNumber', [11, 14].includes(onlyNumbers(values.fiscalTaxNumber).length), 'Informe um CPF ou CNPJ válido.'],
      ['fiscalLegalName', values.fiscalLegalName.trim().length >= 2, 'Informe o nome ou razão social.'],
      ['fiscalPostalCode', onlyNumbers(values.fiscalPostalCode).length === 8, 'Informe um CEP fiscal válido.'],
      ['fiscalStreet', values.fiscalStreet.trim().length > 0, 'Informe a rua ou avenida fiscal.'],
      ['fiscalNumber', values.fiscalNumber.trim().length > 0, 'Informe o número fiscal.'],
      ['fiscalNeighborhood', values.fiscalNeighborhood.trim().length > 0, 'Informe o bairro fiscal.'],
      ['fiscalCity', values.fiscalCity.trim().length > 0, 'Informe a cidade fiscal.'],
      ['fiscalState', values.fiscalState.trim().length === 2, 'Informe a UF fiscal.'],
      ['fiscalMunicipalityCode', /^\d{7}$/.test(values.fiscalMunicipalityCode), 'Informe o código IBGE do município (7 dígitos).'],
    ] as const;
    for (const [path, valid, message] of requiredFiscalValues) {
      if (!valid) context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    }
  });
};
type GuestFields = z.infer<ReturnType<typeof guestCheckoutSchema>>;
const initialGuest: GuestFields = {
  fullName: '', email: '', phone: '', postalCode: '', street: '', number: '', complement: '', neighborhood: '', city: '', state: '',
  fiscalTaxNumber: '', fiscalLegalName: '', fiscalPostalCode: '', fiscalStreet: '', fiscalNumber: '', fiscalComplement: '',
  fiscalNeighborhood: '', fiscalCity: '', fiscalState: '', fiscalMunicipalityCode: '',
};

function Confirmation({ order, guest }: { order: Order; guest: boolean }) {
  const orderStatus = order.status === 'awaiting_payment' ? 'Aguardando pagamento' : order.status === 'paid' ? 'Pagamento confirmado' : order.status === 'packing' ? 'Em separação' : order.status === 'shipped' ? 'Enviado' : order.status === 'delivered' ? 'Entregue' : order.status === 'picked_up' ? 'Retirado' : order.status === 'cancelled' ? 'Cancelado' : 'Devolvido';
  return <main className="shell store-page"><section className="confirmation-card" data-testid="guest-order-confirmation">
    <div className="confirmation-stamp">88 / PEDIDO REGISTRADO</div><p className="eyebrow mt-8">NÚMERO DO PEDIDO</p>
    <h1 className="display" data-testid="text-confirmation-order-number">{order.orderNumber}</h1>
    <p className="confirmation-status" data-testid="status-order">{orderStatus}</p>
    <div className="confirmation-shipping" data-testid="text-confirmation-shipping"><span className="eyebrow">ENVIO</span><strong>{order.shippingLabel}</strong></div>
     {order.shippingMethod === 'pickup' && <div className="pickup-confirmation"><MapPin size={17} /><span>{order.shippingAddress || pickupAddressText}</span><a href={pickupMapUrl} target="_blank" rel="noreferrer">Ver no mapa</a></div>}
    <div className="confirmation-lines" data-testid="list-confirmation-lines">{order.lines.map((line, index) => <div key={`${line.sku}-${index}`}><span>{line.quantity} × {line.productName}<small>{line.variantName}</small></span><strong>{money(line.lineTotal)}</strong></div>)}</div>
    <div className="payment-instructions"><div className="eyebrow">INSTRUÇÕES DE PAGAMENTO</div><p data-testid="text-payment-instructions">{order.paymentInstructions || 'A equipe da Rádio 88 FM enviará as instruções oficiais. Aguarde o contato antes de realizar qualquer transferência.'}</p></div>
    <div className="summary-row confirmation-total"><span>Total do pedido</span><strong>{money(order.total)}</strong></div>
    <p className="confirmation-caution">Nenhuma cobrança foi realizada agora. Confirme os dados de pagamento apenas pelos canais oficiais da Rádio 88 FM.</p>
    {guest ? <p className="guest-confirmation-note">Guarde o número do pedido. Este checkout não cria uma conta nem acompanhamento de pedidos na área de cliente.</p> : <Link href="/orders" className="button mt-5" data-testid="link-account-orders">Ver meus pedidos</Link>}
    <Link href="/" className="button button-outline mt-3" data-testid="link-confirmation-shop">Voltar à loja</Link>
  </section></main>;
}

export function StoreCheckoutPage() {
  const { isSignedIn } = useAuth();
  const qc = useQueryClient();
  const accountCart = useGetCart({ query: { enabled: !!isSignedIn, queryKey: getGetCartQueryKey() } });
  const guestCart = useGuestCart();
  const cart = isSignedIn ? accountCart.data : guestCart;
  const profile = useGetProfile({ query: { enabled: !!isSignedIn, queryKey: getGetProfileQueryKey() } });
  const addresses = useListAddresses({ query: { enabled: !!isSignedIn, queryKey: getListAddressesQueryKey() } });
  const [postal, setPostal] = useState('');
  const [addressId, setAddressId] = useState('');
  const [chosen, setChosen] = useState<ShippingOption | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [guestOptions, setGuestOptions] = useState<ShippingOption[]>([]);
  const [order, setOrder] = useState<Order | null>(null);
  const quoteGuest = useQuoteGuestShipping();
  const guestResolver = useMemo(() => zodResolver(guestCheckoutSchema(chosen?.method === 'pickup', !isSignedIn)), [chosen?.method, isSignedIn]);
  const guestForm = useForm<GuestFields>({ resolver: guestResolver, defaultValues: initialGuest, mode: 'onBlur', reValidateMode: 'onChange' });
  const guest = guestForm.watch();
  const fiscalDetailsRef = useRef<HTMLDetailsElement>(null);
  const addressSnapshot = useRef<GuestFields>(initialGuest);
  const fiscalAddressSnapshot = useRef<GuestFields>(initialGuest);
  const guestPostalLookup = usePostalAddress(guest.postalCode, address => {
    for (const key of ['street', 'neighborhood', 'city', 'state'] as const) {
      if (guestForm.getValues(key) === addressSnapshot.current[key]) {
        guestForm.setValue(key, address[key], { shouldValidate: true });
      }
    }
  }, !isSignedIn && chosen?.method !== 'pickup');
  const fiscalPostalLookup = usePostalAddress(guest.fiscalPostalCode, address => {
    const values: Partial<Record<keyof GuestFields, string>> = {
      fiscalStreet: address.street,
      fiscalNeighborhood: address.neighborhood,
      fiscalCity: address.city,
      fiscalState: address.state,
      ...(address.municipalityCode ? { fiscalMunicipalityCode: address.municipalityCode } : {}),
    };
    for (const [key, value] of Object.entries(values) as [keyof GuestFields, string][]) {
      if (guestForm.getValues(key) === fiscalAddressSnapshot.current[key]) {
        guestForm.setValue(key, value, { shouldValidate: true });
      }
    }
  });
  const accountPostalLookup = usePostalAddress(postal, undefined, !!isSignedIn && chosen?.method !== 'pickup');
  const quoteAccountParams = { postalCode: digits(postal) };
  const quoteAccount = useQuoteShipping(quoteAccountParams, { query: { enabled: !!isSignedIn && digits(postal).length === 8, queryKey: getQuoteShippingQueryKey(quoteAccountParams) } });
  const createAccount = useCreateCheckout();
  const createGuest = useCreateGuestCheckout();
  useEffect(() => {
    if (!addressId && addresses.data?.length) {
      const address = addresses.data.find(item => item.isDefault) ?? addresses.data[0];
      setAddressId(address.id);
      setPostal(address.postalCode);
    }
  }, [addressId, addresses.data]);
  if (order) return <Confirmation order={order} guest={!isSignedIn} />;
  const busy = isSignedIn ? accountCart.isLoading || addresses.isLoading || profile.isLoading : false;
  if (busy) return <main className="shell store-page"><Loading label="Preparando seu checkout" /></main>;
  if (isSignedIn && (accountCart.isError || addresses.isError || profile.isError)) return <main className="shell store-page"><ErrorState retry={() => { void accountCart.refetch(); void addresses.refetch(); void profile.refetch(); }} /></main>;
  if (!cart?.lines.length) return <main className="shell store-page"><div className="store-empty"><span className="store-empty-mark"><ShoppingBag size={22} /></span><h1 className="display">Sua sacola está vazia.</h1><Link href="/" className="button mt-4">Explorar a loja</Link></div></main>;

  const quotedOptions = isSignedIn ? quoteAccount.data ?? [] : guestOptions;
  const options = [...quotedOptions.filter(option => option.method !== 'pickup'), pickupOption];
  const selectedAddress = addresses.data?.find(address => address.id === addressId);
  const pickupSelected = chosen?.method === 'pickup';
  const currentPostal = isSignedIn ? postal : guest.postalCode;
  const quote = () => {
    const cep = digits(currentPostal);
    if (cep.length !== 8) return;
    setChosen(null);
    if (isSignedIn) { setPostal(cep); void quoteAccount.refetch(); return; }
    quoteGuest.mutate({ data: { postalCode: cep, items: cart.lines.map(line => ({ variantId: line.variantId, quantity: line.quantity })) } }, {
      onSuccess: result => setGuestOptions(result),
    });
  };
  const selectOption = (option: ShippingOption) => setChosen(option);
  const makeOrder = (guestValues: GuestFields) => {
    if (!chosen || !accepted) return;
    const isPickup = chosen.method === 'pickup';
    const fiscalRecipient = makeFiscalRecipient(guestValues);
    if (isSignedIn) {
      createAccount.mutate({ data: {
        addressId: isPickup ? null : selectedAddress?.id ?? null,
        postalCode: isPickup ? '27283350' : digits(selectedAddress?.postalCode ?? postal),
        shippingOptionId: chosen.id,
        acceptTerms: true,
        ...(fiscalRecipient ? { fiscalRecipient } : {}),
      } }, {
        onSuccess: result => { setOrder(result); void qc.invalidateQueries({ queryKey: getListMyOrdersQueryKey() }); void qc.invalidateQueries({ queryKey: getGetCartQueryKey() }); },
        onError: error => toast.error(userFacingError(error)),
      });
      return;
    }
    const payload: GuestCheckoutInput = {
      fullName: guestValues.fullName.trim(), email: guestValues.email.trim(), phone: phoneDigits(guestValues.phone),
      postalCode: isPickup ? '27283350' : digits(guestValues.postalCode),
      shippingOptionId: chosen.id, items: cart.lines.map(line => ({ variantId: line.variantId, quantity: line.quantity })), acceptTerms: true,
      ...(fiscalRecipient ? { fiscalRecipient } : {}),
      ...(!isPickup ? { shippingAddress: {
        recipientName: guestValues.fullName.trim(), phone: phoneDigits(guestValues.phone), postalCode: digits(guestValues.postalCode), street: guestValues.street.trim(),
        number: guestValues.number.trim(), complement: guestValues.complement.trim() || null, neighborhood: guestValues.neighborhood.trim(),
        city: guestValues.city.trim(), state: guestValues.state.trim().toUpperCase(),
      } } : {}),
    };
    createGuest.mutate({ data: payload }, {
      onSuccess: result => { setOrder(result); clearGuestCart(); },
      onError: error => toast.error(userFacingError(error)),
    });
  };
  const submitCheckout = (event: FormEvent<HTMLFormElement>) => {
    void guestForm.handleSubmit(
      values => makeOrder(values),
      errors => {
        if (fiscalFields.some(field => errors[field])) fiscalDetailsRef.current?.setAttribute('open', '');
        toast.error('Revise os campos destacados e tente novamente.');
      },
    )(event);
  };
  const input = (key: keyof GuestFields, label: string, required = true) => <FormField key={key} control={guestForm.control} name={key} render={({ field }) => (
    <FormItem className="checkout-field space-y-0">
      <FormLabel>{label}</FormLabel>
      <FormControl><input
        {...field}
        type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}
        data-testid={`input-guest-${key}`}
        aria-required={required}
        inputMode={key === 'email' ? 'email' : ['postalCode', 'phone', 'fiscalPostalCode'].includes(key) ? 'tel' : ['fiscalTaxNumber', 'fiscalMunicipalityCode'].includes(key) ? 'numeric' : undefined}
        maxLength={key === 'phone' ? 20 : key === 'state' || key === 'fiscalState' ? 2 : key === 'postalCode' || key === 'fiscalPostalCode' ? 9 : key === 'fiscalTaxNumber' ? 18 : key === 'fiscalMunicipalityCode' ? 7 : undefined}
        autoComplete={key === 'postalCode' ? 'postal-code' : key === 'fullName' ? 'name' : key === 'phone' ? 'tel' : key === 'street' ? 'address-line1' : key === 'email' ? 'email' : key}
        placeholder={key === 'phone' ? '(00) 00000-0000' : undefined}
        onChange={event => {
          const value = key === 'state' || key === 'fiscalState' ? event.target.value.toUpperCase().slice(0, 2) : event.target.value;
          field.onChange(key === 'phone' ? formatBrazilPhone(value) : value);
          if (key === 'postalCode') { addressSnapshot.current = guestForm.getValues(); setChosen(null); setGuestOptions([]); }
          if (key === 'fiscalPostalCode') fiscalAddressSnapshot.current = guestForm.getValues();
        }}
      /></FormControl>
      <FormMessage className="field-validation-error" />
    </FormItem>
  )} />;

  return <main className="shell store-page">
    <div className="store-page-head"><div><div className="eyebrow">FINALIZAR PEDIDO</div><h1 className="display">Entrega e pagamento</h1><p>{isSignedIn ? 'Revise seus dados e escolha como receber.' : 'Sem criar conta. Vamos enviar a confirmação para seu e-mail.'}</p></div><span className="store-step">02 / 03</span></div>
    <Form {...guestForm}><form noValidate className="checkout-layout" onSubmit={submitCheckout}>
      <div className="checkout-sections">
        <section className="checkout-panel"><div className="checkout-panel-title"><span>01</span><div><h2>Onde receber?</h2><p>Escolha entrega ou retirada nas opções disponíveis.</p></div></div>
          <div className="pickup-highlight" data-testid="pickup-highlight">
            <MapPin size={18} aria-hidden="true" />
            <div><strong>RETIRADA NO LOCAL — RÁDIO 88 FM</strong><p>Economize no frete e aproveite para visitar a Rádio.</p></div>
            <span>GRÁTIS</span>
          </div>
          <div className="shipping-options" role="radiogroup" aria-label="Modalidade de recebimento">{options.map(option => <button type="button" role="radio" aria-checked={chosen?.id === option.id} key={option.id} data-testid={`button-shipping-${option.id}`} className={`shipping-choice ${chosen?.id === option.id ? 'selected' : ''}`} onClick={() => selectOption(option)}><span><b>{option.label}</b><small>{option.description}{option.method === 'delivery' ? ` · ${option.estimatedDays} dias úteis` : ''}</small></span><strong>{option.fee ? money(option.fee) : 'Grátis'}</strong></button>)}</div>
          {pickupSelected ? <div className="pickup-location-card">
            <MapPin size={18} />
            <div><strong>RETIRADA NO LOCAL — RÁDIO 88 FM</strong><p>{pickupAddressText}</p><a href={pickupMapUrl} target="_blank" rel="noreferrer">Abrir endereço no Google Maps</a></div>
            <button type="button" className="pickup-switch" onClick={() => setChosen(null)}>Escolher entrega</button>
          </div> : isSignedIn ? <>
            {addresses.data?.length ? <div className="address-choices">{addresses.data.map((address: Address) => <button type="button" key={address.id} data-testid={`button-address-${address.id}`} aria-pressed={addressId === address.id} className={`address-choice ${addressId === address.id ? 'selected' : ''}`} onClick={() => { setAddressId(address.id); setPostal(address.postalCode); setChosen(null); }}>
              <MapPin size={17} /><span><strong>{address.label || 'Endereço'} · {address.recipientName}</strong><small>{address.street}, {address.number}{address.complement ? ` · ${address.complement}` : ''} · {address.neighborhood}, {address.city} - {address.state} · {address.postalCode}</small></span>
            </button>)}</div> : <div className="checkout-hint">Você ainda não tem endereço salvo. <Link href="/account/addresses">Cadastre um endereço</Link> ou selecione retirada no local.</div>}
            <label className="checkout-field postal-field">CEP para cotação<input data-testid="input-checkout-postal" value={postal} onChange={event => { setPostal(event.target.value); setChosen(null); }} inputMode="numeric" maxLength={9} placeholder="00000-000" /></label>
             <PostalLookupStatus lookup={accountPostalLookup} />
          </> : <>
            <div className="guest-fields">
              {input('fullName', 'Nome completo')}{input('email', 'E-mail')}{input('phone', 'Telefone')}
              {!pickupSelected && <>{input('postalCode', 'CEP')}{input('street', 'Rua / avenida')}{input('number', 'Número')}{input('complement', 'Complemento', false)}{input('neighborhood', 'Bairro')}{input('city', 'Cidade')}{input('state', 'UF')}</>}
            </div>
             <PostalLookupStatus lookup={guestPostalLookup} />
            <p className="checkout-hint">{pickupSelected ? 'Para retirada, informe apenas nome e contato. Não é necessário informar CEP residencial.' : 'Para entrega, informe CEP e endereço completo. A retirada no local não exige endereço residencial.'}</p>
          </>}
          {!pickupSelected && <button type="button" className="button button-outline mt-4" disabled={digits(currentPostal).length !== 8 || quoteGuest.isPending || quoteAccount.isFetching} onClick={quote} data-testid="button-quote-checkout">{quoteGuest.isPending || quoteAccount.isFetching ? 'Calculando…' : 'Calcular frete para entrega'}</button>}
          {quoteGuest.isError && !isSignedIn && <Notice text={errorMessage(quoteGuest.error)} />}
          {isSignedIn && quoteAccount.isError && <Notice text={errorMessage(quoteAccount.error)} />}
        </section>
        <section className="checkout-panel fiscal-checkout-panel">
          <details ref={fiscalDetailsRef} className="fiscal-checkout-disclosure" data-testid="details-fiscal-recipient">
            <summary>
              <span className="fiscal-disclosure-indicator" aria-hidden="true">+</span>
              <span className="fiscal-disclosure-copy"><strong>Dados para nota fiscal</strong><small>Opcional para concluir a compra; agiliza a emissão da nota.</small></span>
              <span className="fiscal-optional-badge">Opcional</span>
            </summary>
            <div className="fiscal-disclosure-content">
              {isSignedIn && <p className="checkout-identity">{profile.data?.fullName} <span>·</span> {profile.data?.email}</p>}
              <p className="checkout-hint">Você pode concluir a compra sem esses dados. Para emitir a nota automaticamente, informe os dados fiscais completos; se deixar em branco, a equipe precisará completar o destinatário antes da emissão.</p>
              <div className="guest-fields">
                {input('fiscalTaxNumber', 'CPF ou CNPJ', hasFiscalData(guest))}
                {input('fiscalLegalName', 'Nome / razão social', hasFiscalData(guest))}
                {input('fiscalPostalCode', 'CEP fiscal', hasFiscalData(guest))}
                {input('fiscalStreet', 'Rua / avenida fiscal', hasFiscalData(guest))}
                {input('fiscalNumber', 'Número fiscal', hasFiscalData(guest))}
                {input('fiscalComplement', 'Complemento fiscal', false)}
                {input('fiscalNeighborhood', 'Bairro fiscal', hasFiscalData(guest))}
                {input('fiscalCity', 'Cidade fiscal', hasFiscalData(guest))}
                {input('fiscalState', 'UF fiscal', hasFiscalData(guest))}
                {input('fiscalMunicipalityCode', 'Código IBGE do município', hasFiscalData(guest))}
              </div>
              <PostalLookupStatus lookup={fiscalPostalLookup} />
            </div>
          </details>
        </section>
        <section className="checkout-panel"><div className="checkout-panel-title"><span>02</span><div><h2>Confirme seu pedido</h2><p>Pagamento manual; nenhuma cobrança agora.</p></div></div>
          <TermsAcceptance
            checked={accepted}
            onCheckedChange={setAccepted}
            checkboxTestId="checkbox-checkout-terms"
            termsTestId="link-checkout-terms"
            privacyTestId="link-checkout-privacy"
          />
        </section>
      </div>
      <aside className="checkout-summary"><div className="eyebrow">RESUMO DA COMPRA</div>
        {cart.lines.map((line: CartLine) => <div className="checkout-item" key={line.variantId}><span>{line.quantity} × {line.productName}<small>{line.variantName}</small></span><strong>{money(line.lineTotal)}</strong></div>)}
        <div className="summary-row"><span>Subtotal</span><strong>{money(cart.subtotal)}</strong></div><div className="summary-row"><span>{pickupSelected ? 'Retirada na Rádio 88 FM' : 'Envio'}</span><strong>{chosen ? chosen.fee ? money(chosen.fee) : 'Grátis' : 'A escolher'}</strong></div>
        <div className="summary-row total-row"><span>Total</span><strong>{money(cart.subtotal + (chosen?.fee ?? 0))}</strong></div>
        <p className="safe-payment"><ShieldCheck size={17} />Instruções oficiais de pagamento aparecem somente após registrar o pedido. Não informe dados de cartão.</p>
         <button type="submit" className="button w-full" data-testid="button-submit-checkout" disabled={!accepted || !chosen || (isSignedIn ? createAccount.isPending : createGuest.isPending) || (isSignedIn && chosen.method === 'delivery' && !selectedAddress)}>
          {(createAccount.isPending || createGuest.isPending) ? 'Registrando pedido…' : 'Confirmar pedido'}
        </button>
      </aside>
    </form></Form>
  </main>;
}

