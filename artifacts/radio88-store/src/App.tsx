import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useClerk, useAuth } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/shared/keys';
import { shadcn } from '@clerk/themes';
import { ptBR } from '@clerk/localizations';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useRoute } from 'wouter';
import {
  useHealthCheck, useListCategories, useListProducts, useGetProduct, useGetCart,
  useAddCartLine, useUpdateCartLine, useRemoveCartLine,
  useListMyOrders, useGetMyOrder, useCancelMyOrder, useGetProfile, useUpdateProfile,
  useListAddresses, useCreateAddress, useUpdateAddress, useDeleteAddress, useExportMyData,
  useDeleteMyProfile, useGetAdminSummary, useListAdminProducts, useCreateProduct,
  useUpdateProduct, useArchiveProduct, useCreateCategory, useAdjustStock,
  useCreateProductVariant, useUpdateProductVariant,
  useListAdminOrders, useUpdateOrderStatus, useListAuditEvents, useListAdminUsers,
  useUpdateUserRole, getHealthCheckQueryKey, getGetProductQueryKey, getQuoteShippingQueryKey,
  getListCategoriesQueryKey, getListProductsQueryKey, getGetCartQueryKey,
  getListMyOrdersQueryKey, getGetMyOrderQueryKey, getGetProfileQueryKey, getListAddressesQueryKey,
  getGetAdminSummaryQueryKey, getGetAdminCapabilitiesQueryKey, useGetAdminCapabilities,
  getListAdminProductsQueryKey, getListAdminOrdersQueryKey,
  getListAdminStockQueryKey, getListAdminStockMovementsQueryKey,
  getListAuditEventsQueryKey, getListAdminUsersQueryKey, getExportMyDataQueryKey,
} from '@workspace/api-client-react';
import { ImageUploadField } from '@/components/image-upload';
import { CurrencyInput } from '@/components/currency-input';
import { money } from '@/lib/format';
import { formatBrazilPhone, phoneDigits } from '@/lib/phone-format';
import { fromCents, toCents } from '@/lib/currency';
import { Notice, Loading, ErrorState } from '@/components/feedback';
import { useConfirmation } from '@/components/ui/confirmation-provider';
import { Logo, Shell } from '@/components/layout';
import { effectiveVariantPrice, ProductImage } from '@/components/product-ui';
import { Catalog } from '@/components/catalog-home';
import { AdminContent } from '@/components/admin-content';
import { AdminProductsCatalog } from '@/components/admin-products-catalog';
import { AdminStockPage } from '@/components/admin-stock';
import { ShippingQuote } from '@/components/shipping-quote';
import { usePostalAddress } from '@/lib/postal-address';
import { PostalLookupStatus } from '@/components/postal-lookup-status';
import { AdminShippingConfig } from '@/components/admin-shipping-config';
import { AdminFiscalPage } from '@/components/admin-fiscal';
import { AdminAccessPage, AdminActivityPage } from '@/components/admin-access-page';
import { AdminPermissionsProvider, useAdminPermissions } from '@/components/admin-permissions';
import { useCan } from '@/components/admin-permissions';
import { Toaster } from '@/components/ui/sonner';
import { StoreCartPage, StoreCheckoutPage, StoreProductPage } from '@/components/store-commerce';
import { TermsAcceptance } from '@/components/legal-document-dialog';
import { ContactPage, LegalPage } from '@/components/legal-pages';
import { StoreHelpPage } from '@/components/store-help';
import { CookiePolicyPage, FavoriteToggle, FavoritesPage } from '@/components/shop-support';
import { addGuestProduct } from '@/lib/guest-cart';
import { userFacingError } from '@/lib/user-facing-errors';
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import type { Address, AddressInput, AdminOrder, Category, ListAdminOrdersParams, Order, OrderStatus, PaymentStatus, Product, ProductVariant, ProductVariantInput, ShippingOption } from '@workspace/api-client-react';
import { Activity, ArrowLeft, ArrowRight, Box, CalendarDays, Check, ChevronDown, ClipboardList, Clock3, CreditCard, Download, FileText, GripVertical, Info, LogOut, Package, PackageCheck, Search, ShieldCheck, ShoppingBag, ShoppingCart, Truck, Users, Warehouse, X } from 'lucide-react';

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }
const shortDate = (v: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(v));
const errText = userFacingError;
const statusText: Record<string, string> = { awaiting_payment: 'Aguardando pagamento', paid: 'Pagamento confirmado', packing: 'Em separação', shipped: 'Enviado', delivered: 'Entregue', picked_up: 'Retirado', cancelled: 'Cancelado', returned: 'Devolvido', pending: 'Pendente', failed: 'Falhou', refunded: 'Reembolsado' };


function ProductGallery({ product }: { product: Product }) {
  const images = [...(product.images ?? [])].sort((left, right) => left.sortOrder - right.sortOrder);
  const cover = images.find(image => image.isPrimary) ??
    images.find(image => image.url === product.imageUrl) ??
    images[0] ??
    (product.imageUrl ? { id: 'legacy-cover', url: product.imageUrl, alt: product.name, sortOrder: 0, isPrimary: true } : undefined);
  const gallery = cover
    ? [cover, ...images.filter(image => image.id !== cover.id && image.url !== cover.url)].slice(0, 5)
    : [];
  const [selectedUrl, setSelectedUrl] = useState(cover?.url ?? '');
  useEffect(() => { setSelectedUrl(cover?.url ?? ''); }, [product.id, cover?.url]);
  const selected = gallery.find(image => image.url === selectedUrl) ?? cover;
  if (!selected) return <ProductImage src={product.imageUrl} name={product.name} className="product-gallery-placeholder" />;
  const selectedIndex = gallery.findIndex(image => image.url === selected.url);
  return <div className="product-gallery" data-testid={`gallery-product-${product.id}`}>
    <div className="product-gallery-stage">
      <img src={selected.url} alt={selected.alt || product.name} data-testid="img-product-gallery-main" />
      {gallery.length > 1 && <span className="product-gallery-count" aria-live="polite">{selectedIndex + 1} / {gallery.length}</span>}
    </div>
    {gallery.length > 1 && <div className="product-gallery-thumbnails" role="group" aria-label={`Fotos de ${product.name}`}>
      {gallery.map((image, index) => <button
        type="button"
        key={image.id}
        className={selected.url === image.url ? 'is-selected' : ''}
        aria-label={`Ver foto ${index + 1} de ${gallery.length}`}
        aria-pressed={selected.url === image.url}
        onClick={() => setSelectedUrl(image.url)}
        data-testid={`button-select-product-image-${index}`}
      ><img src={image.url} alt="" loading="lazy" /></button>)}
    </div>}
  </div>;
}

function ProductPage() {
  const [, params] = useRoute('/product/:productId');
  const id = params?.productId ?? '';
  const { isSignedIn } = useAuth();
  const q = useGetProduct(id, { query: { enabled: !!id, queryKey: getGetProductQueryKey(id) } });
  const add = useAddCartLine();
  const qc = useQueryClient();
  const [, go] = useLocation();
  const [variant, setVariant] = useState('');

  useEffect(() => {
    if (q.data?.variants?.length && !variant) setVariant(q.data.variants[0].id);
  }, [q.data, variant]);

  if (q.isLoading) return <main className="shell py-12"><Loading /></main>;
  if (q.isError || !q.data) {
    return <main className="shell py-12"><ErrorState retry={() => q.refetch()} message="Este produto pode ter sido removido ou estar indisponível." /></main>;
  }

  const product = q.data;
  const chosen = product.variants.find((item: ProductVariant) => item.id === variant);
  const addChosen = () => {
    if (!chosen) return;
    if (!isSignedIn) {
      addGuestProduct(product, chosen);
      go('/cart');
      return;
    }
    add.mutate(
      { data: { variantId: chosen.id, quantity: 1 } },
      { onSuccess: () => { void qc.invalidateQueries({ queryKey: getGetCartQueryKey() }); go('/cart'); } },
    );
  };

  return (
    <main className="shell py-8 md:py-14">
      <Link href="/" className="mb-7 inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft size={16} />Voltar à loja</Link>
      <div className="grid gap-9 md:grid-cols-2 md:gap-14">
        <div className="product-detail-media">
          {product.images?.length
            ? <ProductGallery product={product} />
            : <ProductImage src={product.imageUrl} name={product.name} />}
          <FavoriteToggle product={product} />
        </div>
        <div className="py-2">
          <div className="eyebrow text-muted-foreground">{product.categoryName ?? 'Rádio 88 FM'}</div>
          <h1 className="display mt-3 text-5xl">{product.name}</h1>
          <p className="mt-5 whitespace-pre-line leading-7 text-muted-foreground">{product.description}</p>
          <div className="mt-8">
            <div className="eyebrow mb-3">ESCOLHA UMA OPÇÃO</div>
            <div className="grid gap-2">
              {product.variants.map((item: ProductVariant) => {
                const price = effectiveVariantPrice(product, item);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setVariant(item.id)}
                    aria-pressed={variant === item.id}
                    data-testid={`button-variant-${item.id}`}
                    className={`flex items-center justify-between rounded-[20px] border px-4 py-3 text-left ${variant === item.id ? 'border-foreground bg-muted' : 'bg-card shadow-soft'}`}
                  >
                    <span><b className="block text-sm">{item.name}</b><small className="text-muted-foreground">{item.stock > 0 ? `${item.stock} disponíveis` : 'Indisponível'}</small></span>
                    <span className="text-right">{price < item.price ? <><del className="mr-2 text-xs text-muted-foreground">{money(item.price)}</del><b>{money(price)}</b></> : <b>{money(price)}</b>}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            disabled={!chosen || chosen.stock <= 0 || (isSignedIn && add.isPending)}
            onClick={addChosen}
            className="button mt-6 w-full py-4"
            data-testid="button-add-to-cart"
          >
            {isSignedIn && add.isPending ? 'Adicionando…' : <><ShoppingCart size={18} />Adicionar à sacola</>}
          </button>
          {isSignedIn && add.isError && <div className="mt-3"><Notice text={errText(add.error)} /></div>}
          <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck size={15} />Pagamento manual via PIX; nenhuma cobrança é feita agora.</p>
        </div>
      </div>
    </main>
  );
}

function AuthGate({ children }: { children: ReactNode }) { const { isLoaded, isSignedIn } = useAuth(); if (!isLoaded) return <main className="shell py-12"><Loading label="Verificando acesso" /></main>; if (!isSignedIn) return <Redirect to="/sign-in" />; return <>{children}</>; }
function CartPage() {
  const { isSignedIn } = useAuth(); const [cartCep, setCartCep] = useState(''); const [cartShip, setCartShip] = useState<ShippingOption | null>(null); const cart = useGetCart({ query: { enabled: !!isSignedIn, queryKey: getGetCartQueryKey() } }); const qc = useQueryClient();
  const update = useUpdateCartLine(); const remove = useRemoveCartLine();
  return <AuthGate><main className="shell py-10"><div className="eyebrow text-foreground">SUA ESCOLHA, SUA SINTONIA</div><h1 className="display mt-2 text-4xl">Sua sacola</h1>{cart.isLoading ? <Loading /> : cart.isError ? <div className="mt-7"><ErrorState retry={() => cart.refetch()} /></div> : !cart.data?.lines.length ? <div className="mt-7 rounded-[28px] bg-card shadow-soft p-12 text-center"><ShoppingBag className="mx-auto text-foreground" /><h2 className="display mt-4 text-2xl">Sua sacola está vazia</h2><p className="mt-2 text-sm text-muted-foreground">Quando encontrar algo na vitrine, ele aparece aqui.</p><Link href="/" className="button mt-5">Voltar à loja</Link></div> :
    <div className="mt-7 grid gap-8 lg:grid-cols-[1fr_340px]"><div className="grid gap-3">{cart.data.lines.map(line => <article key={line.id} className="flex gap-4 rounded-[28px] bg-card shadow-soft p-4"><div className="w-24 shrink-0"><ProductImage src={line.imageUrl} name={line.productName} /></div><div className="flex flex-1 flex-col justify-between sm:flex-row sm:items-center"><div><h2 className="display text-xl">{line.productName}</h2><p className="text-xs text-muted-foreground">{line.variantName} · SKU {line.sku}</p><b className="mt-2 block">{money(line.unitPrice)}</b></div><div className="mt-4 flex items-center gap-2 sm:mt-0"><button aria-label="Diminuir quantidade" className="rounded-full border px-3 py-1" disabled={line.quantity <= 1 || update.isPending} onClick={() => update.mutate({ lineId: line.id, data: { quantity: line.quantity - 1 } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetCartQueryKey() }) })}>−</button><span>{line.quantity}</span><button aria-label="Aumentar quantidade" className="rounded-full border px-3 py-1" disabled={line.quantity >= Math.min(20, line.stockAvailable) || update.isPending} onClick={() => update.mutate({ lineId: line.id, data: { quantity: line.quantity + 1 } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetCartQueryKey() }) })}>+</button><button className="ml-3 text-xs underline" onClick={() => remove.mutate({ lineId: line.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getGetCartQueryKey() }) })}>Remover</button></div></div></article>)}</div><aside className="h-fit rounded-[28px] bg-card shadow-soft p-5"><div className="eyebrow text-muted-foreground">RESUMO</div><div className="mt-5 flex justify-between text-sm"><span>Subtotal</span><b>{money(cart.data.subtotal)}</b></div><div className="mt-5"><ShippingQuote testPrefix="cart-shipping" lines={cart.data.lines} cep={cartCep} onCepChange={setCartCep} selected={cartShip} onSelect={setCartShip} subtotal={cart.data.subtotal} /></div><p className="mt-2 text-xs text-muted-foreground">Estimativa. O checkout recalcula o frete antes de criar o pedido.</p><Link href="/checkout" className="button mt-6 w-full">Continuar para entrega <ArrowRight size={16} /></Link></aside></div>}{(update.isError || remove.isError) && <div className="mt-4"><Notice text={errText(update.error || remove.error)} /></div>}</main></AuthGate>;
}

function OrdersPage() {
  const { isSignedIn } = useAuth(); const q = useListMyOrders({ query: { enabled: !!isSignedIn, queryKey: getListMyOrdersQueryKey() } });
  return <AuthGate><main className="shell py-10"><div className="eyebrow text-foreground">SUA HISTÓRIA DE COMPRAS</div><h1 className="display mt-2 text-4xl">Meus pedidos</h1>{q.isLoading ? <Loading /> : q.isError ? <div className="mt-7"><ErrorState retry={() => q.refetch()} /></div> : !q.data?.length ? <div className="mt-7 rounded-[28px] bg-card shadow-soft p-12 text-center"><ClipboardList className="mx-auto text-foreground" /><h2 className="display mt-4 text-2xl">Ainda não há pedidos</h2><p className="mt-2 text-sm text-muted-foreground">Quando seu primeiro pedido for criado, ele estará nesta lista.</p><Link className="button mt-5" href="/">Conhecer a loja</Link></div> : <div className="mt-6 grid gap-3">{q.data.map((o: Order) => <Link href={`/orders/${o.id}`} key={o.id} className="flex flex-wrap items-center justify-between gap-4 rounded-[28px] bg-card shadow-soft p-5 hover:border-foreground" data-testid={`order-${o.id}`}><div><div className="eyebrow text-muted-foreground">{o.orderNumber} · {shortDate(o.createdAt)}</div><h2 className="display mt-1 text-xl">{o.lines.length} {o.lines.length === 1 ? 'item' : 'itens'} · {o.shippingLabel}</h2></div><div className="text-right"><span className="inline-block rounded-full bg-muted px-3 py-1 text-xs font-bold text-foreground">{statusText[o.status] ?? o.status}</span><b className="mt-2 block">{money(o.total)}</b></div></Link>)}</div>}</main></AuthGate>;
}
function OrderPage() {
  const [, params] = useRoute('/orders/:orderId'); const id = params?.orderId ?? ''; const { isSignedIn } = useAuth(); const qc = useQueryClient();
  const q = useGetMyOrder(id, { query: { enabled: !!id && !!isSignedIn, queryKey: getGetMyOrderQueryKey(id) } }); const cancel = useCancelMyOrder();
  return <AuthGate><main className="shell py-10">{q.isLoading ? <Loading /> : q.isError || !q.data ? <ErrorState retry={() => q.refetch()} message="Este pedido não está disponível." /> : <OrderDetails order={q.data} onCancel={() => cancel.mutate({ orderId: id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetMyOrderQueryKey(id) }); qc.invalidateQueries({ queryKey: getListMyOrdersQueryKey() }); } })} pending={cancel.isPending} error={cancel.isError ? errText(cancel.error) : ''} />}</main></AuthGate>;
}
function OrderDetails({ order, onCancel, pending, error }: { order: Order; onCancel: () => void; pending: boolean; error: string }) {
  return <div className="mx-auto max-w-3xl"><Link href="/orders" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft size={16} />Meus pedidos</Link><div className="mt-5 rounded-[28px] bg-card shadow-soft p-6 md:p-9"><div className="flex flex-wrap justify-between gap-4"><div><div className="eyebrow text-foreground">PEDIDO {order.orderNumber}</div><h1 className="display mt-2 text-4xl">{statusText[order.status] ?? order.status}</h1><p className="mt-2 text-sm text-muted-foreground">Criado em {shortDate(order.createdAt)}</p></div><div className="rounded-[20px] bg-muted p-4"><small className="eyebrow">PAGAMENTO</small><p className="mt-1 font-bold">{statusText[order.paymentStatus] ?? order.paymentStatus}</p></div></div>{order.paymentStatus === 'pending' && <div className="mt-6 rounded-[20px] border border-foreground/30 bg-muted p-4"><b className="flex items-center gap-2 text-sm"><Info size={16} aria-hidden="true" />Aguardando pagamento manual via PIX</b><p className="mt-2 whitespace-pre-line text-sm leading-6">{order.paymentInstructions || 'Aguarde as instruções oficiais da Rádio 88 FM. Nenhuma cobrança foi concluída.'}</p><p className="mt-2 text-xs font-bold">Não faça transferência sem receber as instruções oficiais. Não há confirmação de pagamento neste momento.</p></div>}<div className="mt-7 grid gap-3">{order.lines.map((l,i) => <div key={`${l.sku}-${i}`} className="flex justify-between rounded-[20px] bg-muted/70 p-4 text-sm"><span><b>{l.productName}</b><small className="mt-1 block text-muted-foreground">{l.variantName} · {l.quantity} un.</small></span><b>{money(l.lineTotal)}</b></div>)}</div><div className="mt-5 grid gap-2 border-t border-border pt-4 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{money(order.subtotal)}</span></div><div className="flex justify-between"><span>{order.shippingLabel}</span><span>{money(order.shippingFee)}</span></div><div className="flex justify-between pt-2 text-lg font-bold"><span>Total</span><span>{money(order.total)}</span></div></div>{order.shippingAddress && <div className="mt-6 rounded-[20px] bg-muted p-4 text-sm"><b>Endereço de entrega</b><p className="mt-1 text-muted-foreground">{order.shippingAddress}</p>{order.trackingCode && <p className="mt-2 font-bold">Rastreio: {order.trackingCode}</p>}</div>}{order.status === 'awaiting_payment' && <button onClick={onCancel} disabled={pending} className="mt-6 rounded-full border border-destructive px-5 py-2.5 text-sm font-bold text-destructive" data-testid="button-cancel-order">{pending ? 'Cancelando…' : 'Cancelar pedido'}</button>}{error && <div className="mt-3"><Notice text={error} /></div>}</div></div>;
}

function AccountPage() {
  const confirmAction = useConfirmation();
  const { isSignedIn } = useAuth(); const profile = useGetProfile({ query: { enabled: !!isSignedIn, queryKey: getGetProfileQueryKey() } }); const save = useUpdateProfile(); const exportQ = useExportMyData({ query: { enabled: false, queryKey: getExportMyDataQueryKey() } }); const remove = useDeleteMyProfile(); const { signOut } = useClerk(); const qc = useQueryClient(); const [form, setForm] = useState({ fullName: '', phone: '', communicationOptIn: false }); const [feedback, setFeedback] = useState('');
  useEffect(() => { if (profile.data) setForm({ fullName: profile.data.fullName, phone: formatBrazilPhone(profile.data.phone ?? ''), communicationOptIn: profile.data.communicationOptIn }); }, [profile.data]);
  const doExport = async () => { setFeedback(''); try { const result = await exportQ.refetch(); if (result.error) throw result.error; if (result.data) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' })); a.download = 'meus-dados-radio-88.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); setFeedback('Arquivo com seus dados preparado para download.'); } } catch { setFeedback('Não foi possível exportar seus dados. Tente novamente.'); } };
  return <AuthGate><main className="shell py-10"><div className="eyebrow text-foreground">SEU ESPAÇO NA 88</div><h1 className="display mt-2 text-4xl">Minha conta</h1>{profile.isLoading ? <Loading /> : profile.isError ? <div className="mt-6"><ErrorState retry={() => profile.refetch()} /></div> : <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_340px]"><section className="rounded-[28px] bg-card shadow-soft p-6"><h2 className="display text-2xl">Seus dados</h2><form className="mt-5 grid gap-4" onSubmit={e => { e.preventDefault(); save.mutate({ data: { ...form, phone: phoneDigits(form.phone) || null } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetProfileQueryKey() }); setFeedback('Seus dados foram atualizados.'); }, onError: err => setFeedback(errText(err)) }); }}><label className="text-xs font-bold">Nome completo<input className="field mt-2" value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} required /></label><label className="text-xs font-bold">E-mail<input className="field mt-2 bg-muted" type="email" autoComplete="email" value={profile.data?.email ?? ''} disabled /></label><label className="text-xs font-bold">Telefone<input className="field mt-2" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} placeholder="(00) 00000-0000" data-testid="input-account-phone" value={form.phone} onChange={e => setForm({ ...form, phone: formatBrazilPhone(e.target.value) })} /></label><p className="text-xs text-muted-foreground">CPF cadastrado: {profile.data?.cpfLastFour ? `•••.•••.•••-${profile.data.cpfLastFour}` : 'não informado'}</p><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={form.communicationOptIn} onChange={e => setForm({ ...form, communicationOptIn: e.target.checked })} className="accent-black" />Quero receber novidades e comunicações da Rádio 88 FM.</label><button disabled={save.isPending} className="button justify-self-start">{save.isPending ? 'Salvando…' : 'Salvar alterações'}</button></form>{feedback && <div className="mt-4"><Notice text={feedback} kind={feedback.includes('atualizados') || feedback.includes('download') ? 'success' : 'error'} /></div>}</section><aside className="grid content-start gap-4"><div className="rounded-[28px] bg-card shadow-soft p-5"><h3 className="display text-xl">Seus endereços</h3><p className="mt-2 text-sm text-muted-foreground">Gerencie onde seus pedidos chegam.</p><Link href="/account/addresses" className="button button-outline mt-4 w-full">Gerenciar endereços</Link></div><div className="rounded-[28px] bg-card shadow-soft p-5"><h3 className="display text-xl">Seus dados, suas escolhas</h3><button onClick={doExport} disabled={exportQ.isFetching} className="button button-outline mt-4 w-full"><Download size={16} />{exportQ.isFetching ? 'Preparando arquivo…' : 'Baixar meus dados'}</button><button onClick={async () => { const confirmed = await confirmAction({ title: 'Excluir sua conta?', description: 'Excluir sua conta e solicitar a remoção dos dados associados? Esta ação não pode ser desfeita.', confirmLabel: 'Excluir minha conta', destructive: true }); if (confirmed) remove.mutate(undefined, { onSuccess: () => { qc.clear(); signOut({ redirectUrl: basePath || '/' }); }, onError: e => setFeedback(errText(e)) }); }} disabled={remove.isPending} className="mt-4 w-full rounded-full border border-destructive px-4 py-2.5 text-xs font-bold text-destructive">{remove.isPending ? 'Solicitando exclusão…' : 'Excluir minha conta'}</button>{remove.isError && <p className="mt-2 text-xs text-destructive">{errText(remove.error)}</p>}</div><button onClick={() => signOut({ redirectUrl: basePath || '/' })} className="flex items-center justify-center gap-2 rounded-full border border-border px-4 py-3 text-sm"><LogOut size={16} />Sair da conta</button></aside></div>}</main></AuthGate>;
}

function AddressPage() {
  const confirmAction = useConfirmation();
  const { isSignedIn } = useAuth(); const q = useListAddresses({ query: { enabled: !!isSignedIn, queryKey: getListAddressesQueryKey() } }); const qc = useQueryClient();
  const create = useCreateAddress(); const update = useUpdateAddress(); const del = useDeleteAddress();
  const blank: AddressInput = { label: '', recipientName: '', phone: '', postalCode: '', street: '', number: '', complement: '', neighborhood: '', city: '', state: '', isDefault: false };
  const [form, setForm] = useState<AddressInput>(blank); const [editing, setEditing] = useState(''); const [feedback, setFeedback] = useState('');
  const postalSnapshot = useRef(form);
  const [addressLookupEnabled, setAddressLookupEnabled] = useState(true);
  useEffect(() => { postalSnapshot.current = form; }, [form.postalCode, editing]);
  const postalLookup = usePostalAddress(form.postalCode, address => {
    setForm(current => {
      const next = { ...current };
      for (const key of ['street', 'neighborhood', 'city', 'state'] as const) {
        if (current[key] === postalSnapshot.current[key]) next[key] = address[key];
      }
      return next;
    });
  }, !!isSignedIn && addressLookupEnabled);
  const save = (e: FormEvent) => { e.preventDefault(); setFeedback(''); const data = { ...form, phone: phoneDigits(form.phone) }; const done = () => { qc.invalidateQueries({ queryKey: getListAddressesQueryKey() }); setForm(blank); setEditing(''); setFeedback('Endereço salvo.'); }; if (editing) update.mutate({ addressId: editing, data }, { onSuccess: done, onError: e => setFeedback(errText(e)) }); else create.mutate({ data }, { onSuccess: done, onError: e => setFeedback(errText(e)) }); };
  const startEdit = (a: Address) => { setAddressLookupEnabled(false); setEditing(a.id); setForm({ label: a.label, recipientName: a.recipientName, phone: formatBrazilPhone(a.phone), postalCode: a.postalCode, street: a.street, number: a.number, complement: a.complement ?? '', neighborhood: a.neighborhood, city: a.city, state: a.state, isDefault: a.isDefault }); };
  return <AuthGate><main className="shell py-10">
    <div className="eyebrow text-foreground">ENTREGA SEM COMPLICAÇÃO</div><h1 className="display mt-2 text-4xl">Endereços salvos</h1>
    {q.isLoading ? <Loading /> : q.isError ? <div className="mt-6"><ErrorState retry={() => q.refetch()} /></div> :
      <div className="mt-7 grid gap-7 lg:grid-cols-[1fr_420px]">
        <section className="grid content-start gap-3">
          {!q.data?.length && <div className="rounded-[28px] border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nenhum endereço salvo. Adicione seu primeiro endereço ao lado.</div>}
          {q.data?.map((a: Address) => <article key={a.id} className="rounded-[28px] bg-card shadow-soft p-5">
            <div className="flex justify-between"><b>{a.label || 'Endereço'} {a.isDefault && <span className="ml-2 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">Padrão</span>}</b>
              <div className="flex gap-3 text-xs"><button className="underline" onClick={() => startEdit(a)}>Editar</button>
                <button className="underline" onClick={async () => { const confirmed = await confirmAction({ title: 'Remover endereço?', description: 'Este endereço será removido da sua conta e deixará de estar disponível no checkout.', confirmLabel: 'Remover endereço', destructive: true }); if (confirmed) del.mutate({ addressId: a.id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListAddressesQueryKey() }); toast.success('Endereço removido.'); }, onError: e => toast.error(errText(e)) }); }}>Remover</button></div>
            </div><p className="mt-2 text-sm text-muted-foreground">{a.recipientName} · {a.street}, {a.number}{a.complement ? `, ${a.complement}` : ''}<br />{a.neighborhood}, {a.city} - {a.state} · {a.postalCode}<br />{formatBrazilPhone(a.phone)}</p>
          </article>)}
        </section>
        <form onSubmit={save} className="rounded-[28px] bg-card shadow-soft p-5">
          <h2 className="display text-2xl">{editing ? 'Editar endereço' : 'Adicionar endereço'}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {([['label','Identificação'],['recipientName','Nome de quem recebe'],['phone','Telefone'],['postalCode','CEP'],['street','Rua / avenida'],['number','Número'],['complement','Complemento'],['neighborhood','Bairro'],['city','Cidade'],['state','UF']] as [Exclude<keyof AddressInput, 'isDefault'>, string][]).map(([key,label]) =>
              <label key={key} className={`text-xs font-bold ${key === 'street' ? 'sm:col-span-2' : ''}`}>{label}
                <input required={!['label','complement'].includes(key)} type={key === 'phone' ? 'tel' : 'text'} maxLength={key === 'phone' ? 20 : key === 'state' ? 2 : key === 'postalCode' ? 9 : undefined}
                  inputMode={key === 'phone' ? 'tel' : key === 'postalCode' ? 'numeric' : undefined} autoComplete={key === 'phone' ? 'tel' : undefined} placeholder={key === 'phone' ? '(00) 00000-0000' : undefined} data-testid={`input-address-${key}`}
                  className="field mt-1.5" value={form[key] ?? ''} onChange={e => {
                    if (key === 'postalCode') setAddressLookupEnabled(true);
                    setForm(current => ({ ...current, [key]: key === 'state' ? e.target.value.toUpperCase() : key === 'phone' ? formatBrazilPhone(e.target.value) : e.target.value }));
                  }} />
              </label>)}
          </div>
          <PostalLookupStatus lookup={postalLookup} />
          <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })} className="accent-black" />Definir como endereço padrão</label>
          <div className="mt-5 flex gap-2"><button disabled={create.isPending || update.isPending} className="button">{create.isPending || update.isPending ? 'Salvando…' : 'Salvar endereço'}</button>
            {editing && <button type="button" className="button button-outline" onClick={() => { setEditing(''); setForm(blank); }}>Cancelar edição</button>}
          </div>{feedback && <div className="mt-4"><Notice text={feedback} kind={feedback === 'Endereço salvo.' ? 'success' : 'error'} /></div>}
        </form>
      </div>}
  </main></AuthGate>;
}

function AdminGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const access = useGetAdminCapabilities({ query: { enabled: !!isSignedIn, queryKey: getGetAdminCapabilitiesQueryKey(), retry: false } });
  if (!isLoaded) return <main className="shell py-10"><Loading label="Verificando sessão" /></main>;
  if (!isSignedIn) return <Redirect to="/sign-in" />;
  if (access.isLoading) return <main className="shell py-10"><Loading label="Verificando permissões no servidor" /></main>;
  if (access.isError || !access.data?.permissions.length) return <main className="shell py-16"><div className="mx-auto max-w-xl"><Notice text="Esta conta não tem permissões de operação da loja." /><Link href="/" className="button button-outline mt-5">Voltar à loja</Link></div></main>;
  return <AdminPermissionsProvider permissions={access.data.permissions}>{children}</AdminPermissionsProvider>;
}
function canOpenSection(section: string, permissions: ReadonlySet<string>) {
  const requirements: Record<string, { all?: string[]; any?: string[] }> = {
    "/admin": { all: ["orders:read", "payments:read", "inventory:read"] },
    "/admin/products": { all: ["products:read", "categories:read", "product_lines:read"] },
    "/admin/orders": { all: ["orders:read", "payments:read"] },
    "/admin/stock": { all: ["inventory:read"] },
    "/admin/content": { all: ["content:read"] },
    "/admin/users": { any: ["users:read", "roles:read"] },
    "/admin/activity": { all: ["audit:read"] },
    "/admin/config": { all: ["shipping:read"] },
    "/admin/fiscal": { any: ["fiscal:read", "fiscal:manage"] },
  };
  const required = requirements[section];
  if (!required) return false;
  if (required.all) return required.all.every((permission) => permissions.has(permission));
  return required.any?.some((permission) => permissions.has(permission)) ?? false;
}
function AdminLayoutFrame({ children, title, section }: { children: ReactNode; title: string; section: string }) {
  const permissions = useAdminPermissions();
  const items = [['/admin','Visão geral',Activity], ['/admin/products','Produtos e categorias',Package], ['/admin/orders','Pedidos e pagamentos',ClipboardList], ['/admin/stock','Estoque',Warehouse], ['/admin/content','Conteúdo da vitrine',Info], ['/admin/users','Pessoas e acessos',Users], ['/admin/activity','Atividade',Clock3], ['/admin/config','Frete e envios',Truck], ['/admin/fiscal','Notas fiscais',FileText]] as const;
  const allowed = canOpenSection(section, permissions);
  return <main className="shell admin-layout py-8">
    <div className="eyebrow text-foreground">PAINEL DA RÁDIO 88 FM</div>
    <div className="admin-page-heading mt-2">
      <div><h1 className="display">{title}</h1><p>Operação da loja, com dados vindos do sistema.</p></div>
      <span className="admin-access-validation">Acesso validado pelo servidor</span>
    </div>
    <div className="admin-workspace-grid mt-7 grid gap-7 lg:grid-cols-[215px_minmax(0,1fr)]">
      <aside className="admin-sidebar flex gap-2 overflow-x-auto lg:flex-col" aria-label="Seções administrativas">
        {items.filter(([url]) => canOpenSection(url, permissions)).map(([url,label,Icon]) => <Link href={url} key={url} aria-current={section === url ? "page" : undefined} className={`flex shrink-0 items-center gap-3 rounded-[20px] px-4 py-3 text-sm font-semibold ${section === url ? 'bg-[#332f2d] text-white' : 'bg-card shadow-soft hover:border-foreground'}`}><Icon size={17} />{label}</Link>)}
      </aside>
      <section className="admin-workspace-content min-w-0">{allowed ? children : <div className="rounded-[24px] border border-dashed p-7 text-sm text-muted-foreground">Seu perfil não tem acesso a esta seção.</div>}</section>
    </div>
  </main>;
}
function AdminLayout({ children, title, section }: { children: ReactNode; title: string; section: string }) {
  return <AdminGate><AdminLayoutFrame title={title} section={section}>{children}</AdminLayoutFrame></AdminGate>;
}
function AdminHome() {
  const q = useGetAdminSummary({ query: { queryKey: getGetAdminSummaryQueryKey(), retry: false } });
  useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
  return <AdminLayout title="Bom dia, equipe." section="/admin">{q.isLoading ? <Loading /> : q.isError || !q.data ? <ErrorState retry={() => q.refetch()} message="O resumo da operação não está disponível." /> : <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[['Pedidos hoje',q.data.ordersToday,ClipboardList],['Aguardando pagamento',q.data.pendingPayment,Activity],['Pedidos em aberto',q.data.openOrders,Box],['Variantes com estoque baixo',q.data.lowStockVariants,Warehouse]].map(([label,value,Icon]: any) => <div key={label} className="rounded-[28px] bg-card shadow-soft p-5"><Icon size={19} className="text-foreground" /><div className="display mt-4 text-3xl">{value}</div><p className="mt-1 text-xs text-muted-foreground">{label}</p></div>)}</div><div className="mt-5 rounded-[28px] bg-[#332f2d] p-6 text-white"><div className="eyebrow text-white/70">VENDAS CONFIRMADAS</div><div className="display mt-2 text-4xl">{money(q.data.grossSales)}</div><p className="mt-2 text-xs text-white/65">Total registrado pelo sistema. Pedidos pendentes não são contabilizados como pagos.</p></div><div className="mt-7"><div className="flex items-end justify-between"><h2 className="display text-2xl">Movimento recente</h2><Link href="/admin/orders" className="text-xs font-bold underline">Ver pedidos</Link></div>{!q.data.recentOrders.length ? <p className="mt-3 rounded-[20px] border border-dashed p-6 text-sm text-muted-foreground">Nenhum pedido recente.</p> : <div className="mt-3 grid gap-2">{q.data.recentOrders.map((o: Order) => <Link href="/admin/orders" key={o.id} className="flex justify-between rounded-[20px] bg-card shadow-soft p-4 text-sm"><span><b>{o.orderNumber}</b><small className="ml-3 text-muted-foreground">{shortDate(o.createdAt)}</small></span><span className="text-right"><b>{money(o.total)}</b><small className="ml-2 text-muted-foreground">{statusText[o.status] ?? o.status}</small></span></Link>)}</div>}</div></>}</AdminLayout>;
}

function ProductForm({ categories, onDone }: { categories: Category[]; onDone: () => void }) {
  const qc = useQueryClient(); const create = useCreateProduct();
  const [name, setName] = useState(''); const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState(''); const [categoryId, setCategoryId] = useState('');
  const [featured, setFeatured] = useState(false); const [imageUploading, setImageUploading] = useState(false);
  const [variant, setVariant] = useState<ProductVariantInput>({ name: 'Padrão', sku: '', price: 0, stock: 0, lowStockThreshold: 2 });
  const [error, setError] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (imageUploading) { setError('Aguarde o envio da imagem antes de criar o produto.'); return; }
    create.mutate({ data: { name, description, imageUrl: imageUrl || null, categoryId: categoryId || null, featured, variants: [variant] } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListAdminProductsQueryKey() });
        qc.invalidateQueries({ queryKey: getListProductsQueryKey() });
        onDone();
      },
      onError: e => setError(errText(e)),
    });
  };
  return (
    <form onSubmit={submit} className="rounded-[28px] bg-card p-5 shadow-soft">
      <h3 className="display text-2xl">Cadastrar produto</h3>
      <p className="mt-1 text-xs text-muted-foreground">Inclua ao menos uma variante com preço e estoque reais.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold">Nome<input className="field mt-1.5" required maxLength={160} value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="text-xs font-bold">Categoria<select className="field mt-1.5" value={categoryId} onChange={e => setCategoryId(e.target.value)}><option value="">Sem categoria</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="text-xs font-bold sm:col-span-2">Descrição<textarea className="field mt-1.5 min-h-24" maxLength={5000} value={description} onChange={e => setDescription(e.target.value)} /></label>
        <div className="sm:col-span-2"><span className="text-xs font-bold">Imagem do produto</span><ImageUploadField value={imageUrl} onChange={setImageUrl} onUploadingChange={setImageUploading} disabled={create.isPending} /></div>
        <label className="text-xs font-bold">Nome da variante<input className="field mt-1.5" required value={variant.name} onChange={e => setVariant({ ...variant, name: e.target.value })} /></label>
        <label className="text-xs font-bold">SKU<input className="field mt-1.5" required value={variant.sku} onChange={e => setVariant({ ...variant, sku: e.target.value })} /></label>
        <label className="text-xs font-bold">Preço<CurrencyInput className="field mt-1.5" required value={toCents(variant.price)} onChange={cents => setVariant({ ...variant, price: fromCents(cents) })} /></label>
        <label className="text-xs font-bold">Estoque inicial<input className="field mt-1.5" required min="0" type="number" value={variant.stock} onChange={e => setVariant({ ...variant, stock: Number(e.target.value) })} /></label>
        <label className="text-xs font-bold">Avisar quando estoque ≤<input className="field mt-1.5" required min="0" type="number" value={variant.lowStockThreshold} onChange={e => setVariant({ ...variant, lowStockThreshold: Number(e.target.value) })} /></label>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={featured} onChange={e => setFeatured(e.target.checked)} className="accent-black" />Destacar na vitrine</label>
      {error && <div className="mt-3"><Notice text={error} /></div>}
      <button className="button mt-5" disabled={create.isPending || imageUploading}>{create.isPending ? 'Publicando…' : imageUploading ? 'Aguarde o envio…' : 'Criar produto'}</button>
    </form>
  );
}
function AdminProducts({ stockMode = false }: { stockMode?: boolean }) {
  if (stockMode) return <AdminLayout title="Estoque" section="/admin/stock"><AdminStockPage /></AdminLayout>;
  return <AdminProductsLegacy />;
}
function AdminProductsLegacy() {
  const confirmAction = useConfirmation();
  const stockMode = false;
  const qc=useQueryClient(); const products=useListAdminProducts({query:{queryKey:getListAdminProductsQueryKey(),retry:false}}); const categories=useListCategories(); const newCategory=useCreateCategory(); const update=useUpdateProduct(); const archive=useArchiveProduct(); const adjust=useAdjustStock(); const addVariant=useCreateProductVariant(); const editVariant=useUpdateProductVariant();
  const [categoryName,setCategoryName]=useState('');const [categoryDesc,setCategoryDesc]=useState('');const [message,setMessage]=useState('');const [newVariants,setNewVariants]=useState<Record<string,ProductVariantInput>>({});
  const refresh=()=>{qc.invalidateQueries({queryKey:getListAdminProductsQueryKey()});qc.invalidateQueries({queryKey:getListProductsQueryKey()});qc.invalidateQueries({queryKey:getGetAdminSummaryQueryKey()});};
  const title='Produtos e categorias'; const section='/admin/products';
  return <AdminLayout title={title} section={section}>{products.isLoading?<Loading/>:products.isError?<ErrorState retry={()=>products.refetch()} message="Não foi possível acessar o catálogo administrativo. Permissão e dados são verificados no servidor."/>:<div className="grid gap-6">
    <><ProductForm categories={categories.data??[]} onDone={()=>{refresh();setMessage('Produto criado e disponível na administração.');}}/><form className="rounded-[28px] border border-border bg-card p-5" onSubmit={e=>{e.preventDefault();newCategory.mutate({data:{name:categoryName,description:categoryDesc||null}},{onSuccess:()=>{setCategoryName('');setCategoryDesc('');setMessage('Categoria criada.');qc.invalidateQueries({queryKey:getListCategoriesQueryKey()});},onError:e=>setMessage(errText(e))});}}><div className="eyebrow text-muted-foreground">ORGANIZE A VITRINE</div><h3 className="display mt-1 text-xl">Nova categoria</h3><div className="mt-3 flex flex-wrap gap-2"><input className="field max-w-xs" placeholder="Nome da categoria" required value={categoryName} onChange={e=>setCategoryName(e.target.value)} /><input className="field max-w-sm" placeholder="Descrição (opcional)" value={categoryDesc} onChange={e=>setCategoryDesc(e.target.value)} /><button disabled={newCategory.isPending} className="button">{newCategory.isPending?'Salvando…':'Criar categoria'}</button></div></form></>
    {message&&<Notice text={message} kind={message.includes('criad')||message.includes('disponível')?'success':'error'}/>}
    {!products.data?.length?<div className="rounded-[28px] border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum produto cadastrado. Use o formulário acima para incluir produtos reais na loja.</div>:products.data.map((p:Product)=><article key={p.id} className="rounded-[28px] bg-card shadow-soft p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="eyebrow text-muted-foreground">{p.categoryName??'Sem categoria'} · {p.active?'Ativo':'Arquivado'}</div><h3 className="display mt-1 text-2xl">{p.name}</h3><p className="mt-1 max-w-2xl text-xs text-muted-foreground">{p.description}</p></div>{!stockMode&&<div className="flex gap-2"><button disabled={update.isPending} className="button button-outline py-2 text-xs" onClick={()=>update.mutate({productId:p.id,data:{featured:!p.featured}},{onSuccess:refresh,onError:e=>setMessage(errText(e))})}>{p.featured?'Remover destaque':'Destacar'}</button><button disabled={archive.isPending||update.isPending} className="button button-outline py-2 text-xs text-destructive" onClick={async () => { const confirmed = await confirmAction({ title: p.active ? 'Arquivar produto?' : 'Reativar produto?', description: p.active ? `O produto ${p.name} deixará de aparecer na loja. O histórico de pedidos será preservado.` : `O produto ${p.name} voltará a aparecer na loja.`, confirmLabel: p.active ? 'Arquivar produto' : 'Reativar produto', destructive: p.active }); if (!confirmed) return; if (p.active) archive.mutate({ productId: p.id }, { onSuccess: () => { refresh(); toast.success('Produto arquivado.'); }, onError: e => toast.error(errText(e)) }); else update.mutate({ productId: p.id, data: { active: true } }, { onSuccess: () => { refresh(); toast.success('Produto reativado.'); }, onError: e => toast.error(errText(e)) }); }}>{p.active?'Arquivar':'Reativar'}</button></div>}</div>
      <ProductMetaEditor product={p} categories={categories.data??[]} onSave={data=>update.mutate({productId:p.id,data},{onSuccess:refresh,onError:e=>setMessage(errText(e))})}/>
      <div className="mt-4 grid gap-2">{p.variants.map(v=><VariantManager key={v.id} variant={v} stockMode={stockMode} onStock={(stock,reason)=>adjust.mutate({variantId:v.id,data:{stock,reason}},{onSuccess:refresh,onError:e=>setMessage(errText(e))})} onUpdate={(data)=>editVariant.mutate({variantId:v.id,data},{onSuccess:refresh,onError:e=>setMessage(errText(e))})}/>)}</div>
     {!stockMode&&<form className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4" onSubmit={e=>{e.preventDefault();const v=newVariants[p.id]??{name:'',sku:'',price:0,stock:0,lowStockThreshold:2};addVariant.mutate({productId:p.id,data:v},{onSuccess:()=>{refresh();setNewVariants({...newVariants,[p.id]:{name:'',sku:'',price:0,stock:0,lowStockThreshold:2}});},onError:e=>setMessage(errText(e))});}}><span className="eyebrow w-full">ADICIONAR VARIANTE</span>{(['name','sku','price','stock','lowStockThreshold'] as const).map(k=><label key={k} className="text-xs font-bold">{({name:'Nome',sku:'SKU',price:'Preço',stock:'Estoque',lowStockThreshold:'Alerta estoque'})[k]}{k==='price'?<CurrencyInput className="field mt-1 w-32 py-2" required value={toCents((newVariants[p.id]??{name:'',sku:'',price:0,stock:0,lowStockThreshold:2}).price)} onChange={cents=>{const current=newVariants[p.id]??{name:'',sku:'',price:0,stock:0,lowStockThreshold:2};setNewVariants({...newVariants,[p.id]:{...current,price:fromCents(cents)}});}}/>:<input className="field mt-1 w-28 py-2" required type={['stock','lowStockThreshold'].includes(k)?'number':'text'} min={['stock','lowStockThreshold'].includes(k)?0:undefined} value={(newVariants[p.id]??{name:'',sku:'',price:0,stock:0,lowStockThreshold:2})[k]} onChange={e=>{const current=newVariants[p.id]??{name:'',sku:'',price:0,stock:0,lowStockThreshold:2};setNewVariants({...newVariants,[p.id]:{...current,[k]:['stock','lowStockThreshold'].includes(k)?Number(e.target.value):e.target.value}});}}/>}</label>)}<button className="button py-2 text-xs" disabled={addVariant.isPending}>Adicionar variante</button></form>}
    </article>)}</div>}</AdminLayout>;
}
function ProductMetaEditor({product,categories,onSave}:{product:Product;categories:Category[];onSave:(data:{name:string;description:string;imageUrl:string|null;categoryId:string|null})=>void}) {
  const [name,setName]=useState(product.name);const [description,setDescription]=useState(product.description);const [imageUrl,setImageUrl]=useState(product.imageUrl??'');const [categoryId,setCategoryId]=useState(product.categoryId??'');const [imageUploading,setImageUploading]=useState(false);
  return <details className="mt-4 border-t border-border pt-3"><summary className="cursor-pointer text-xs font-bold text-foreground">Editar informações do produto</summary><form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();if(!imageUploading)onSave({name,description,imageUrl:imageUrl||null,categoryId:categoryId||null});}}><label className="text-xs font-bold">Nome<input className="field mt-1 py-2" required value={name} onChange={e=>setName(e.target.value)}/></label><label className="text-xs font-bold">Categoria<select className="field mt-1 py-2" value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="">Sem categoria</option>{categories.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label><label className="text-xs font-bold sm:col-span-2">Descrição<textarea className="field mt-1 min-h-20 py-2" value={description} onChange={e=>setDescription(e.target.value)}/></label><div className="sm:col-span-2"><span className="text-xs font-bold">Imagem do produto</span><ImageUploadField value={imageUrl} onChange={setImageUrl} onUploadingChange={setImageUploading} /></div><button className="button justify-self-start py-2 text-xs" disabled={imageUploading}>{imageUploading?'Aguarde o envio…':'Salvar informações'}</button></form></details>;
}
function VariantManager({variant,stockMode,onStock,onUpdate}:{variant:ProductVariant;stockMode:boolean;onStock:(stock:number,reason:string)=>void;onUpdate:(data:{name?:string;sku?:string;price?:number;lowStockThreshold?:number})=>void}) {
  const [stock,setStock]=useState(String(variant.stock));const [reason,setReason]=useState('');const [name,setName]=useState(variant.name);const [sku,setSku]=useState(variant.sku);const [priceCents,setPriceCents]=useState(toCents(variant.price));const [threshold,setThreshold]=useState(String(variant.lowStockThreshold));
  return <div className="rounded-[20px] bg-muted/60 p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-x-4 gap-y-1 text-sm"><b>{variant.name}</b><span className="text-muted-foreground">SKU {variant.sku}</span><span>{money(variant.price)}</span><span className={variant.stock<=variant.lowStockThreshold?'font-bold text-destructive':'text-muted-foreground'}>{variant.stock} em estoque</span></div>{!stockMode&&<details className="text-xs"><summary className="cursor-pointer font-bold text-foreground">Editar variante</summary><form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();onUpdate({name,sku,price:fromCents(priceCents),lowStockThreshold:Number(threshold)});}}><label className="text-xs">Nome<input className="field mt-1 w-28 py-2" value={name} onChange={e=>setName(e.target.value)}/></label><label className="text-xs">SKU<input className="field mt-1 w-28 py-2" value={sku} onChange={e=>setSku(e.target.value)}/></label><label className="text-xs">Preço<CurrencyInput className="field mt-1 w-32 py-2" value={priceCents} onChange={setPriceCents}/></label><label className="text-xs">Limite baixo<input className="field mt-1 w-28 py-2" value={threshold} type="number" min="0" onChange={e=>setThreshold(e.target.value)}/></label><button className="button self-end py-2 text-xs">Salvar variante</button></form></details>}</div>
    {stockMode&&<form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();onStock(Number(stock),reason);setReason('');}}><label className="text-xs font-bold">Novo estoque<input className="field mt-1 w-28 py-2" min="0" type="number" value={stock} onChange={e=>setStock(e.target.value)} /></label><label className="flex-1 text-xs font-bold">Motivo do ajuste<input className="field mt-1 py-2" minLength={3} required value={reason} onChange={e=>setReason(e.target.value)} placeholder="Ex.: conferência de inventário" /></label><button className="button py-2 text-xs">Registrar ajuste</button></form>}</div>;
}

const orderStages: { key: OrderStatus; label: string; short: string }[] = [
  { key: 'awaiting_payment', label: 'Aguardando pagamento', short: 'Aguardando' },
  { key: 'paid', label: 'Pagamento confirmado', short: 'Pago' },
  { key: 'packing', label: 'Em separação', short: 'Separação' },
  { key: 'shipped', label: 'Enviado', short: 'Enviado' },
  { key: 'delivered', label: 'Entregue', short: 'Entregue' },
  { key: 'picked_up', label: 'Retirado', short: 'Retirado' },
  { key: 'cancelled', label: 'Cancelado', short: 'Cancelado' },
];

function AdminOrdersLegacy() {
  const qc=useQueryClient();const q=useListAdminOrders(undefined,{query:{queryKey:getListAdminOrdersQueryKey(),retry:false}});const update=useUpdateOrderStatus();const [filter,setFilter]=useState('');
  return <AdminLayout title="Pedidos e pagamentos" section="/admin/orders">{q.isLoading?<Loading/>:q.isError?<ErrorState retry={()=>q.refetch()} message="A lista não está disponível para este perfil."/>:<><div className="mb-4 flex gap-2"><select className="field max-w-xs" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Todos os status</option>{Object.entries(statusText).filter(([k])=>['awaiting_payment','paid','packing','shipped','delivered','cancelled'].includes(k)).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>{!q.data?.length?<p className="rounded-[20px] border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum pedido para exibir.</p>:<div className="grid gap-3">{q.data.filter((o:Order)=>!filter||o.status===filter).map((o:Order)=><div key={o.id} className="rounded-[28px] bg-card shadow-soft p-5"><div className="flex flex-wrap justify-between gap-3"><div><div className="eyebrow text-foreground">{o.orderNumber} · {shortDate(o.createdAt)}</div><h3 className="display mt-1 text-xl">{money(o.total)} · {o.lines.length} itens</h3><p className="mt-1 text-xs text-muted-foreground">{o.shippingAddress??o.shippingLabel}</p></div><div className="text-right text-sm"><b>{statusText[o.status]??o.status}</b><small className="mt-1 block text-muted-foreground">Pagamento: {statusText[o.paymentStatus]??o.paymentStatus}</small></div></div><div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4"><label className="text-xs font-bold">Atualizar status<select className="field mt-1 w-48 py-2" defaultValue={o.status} onChange={e=>update.mutate({orderId:o.id,data:{status:e.target.value as any}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListAdminOrdersQueryKey()});qc.invalidateQueries({queryKey:getGetAdminSummaryQueryKey()});},onError:()=>q.refetch()})}>{['awaiting_payment','paid','packing','shipped','delivered','cancelled','returned'].map(k=><option key={k} value={k}>{statusText[k]}</option>)}</select></label><label className="text-xs font-bold">Código de rastreio<input className="field mt-1 w-48 py-2" key={`${o.id}-${o.trackingCode}`} defaultValue={o.trackingCode??''} placeholder="Rastreio (opcional)" onBlur={e=>{if(e.target.value!== (o.trackingCode??'')) update.mutate({orderId:o.id,data:{trackingCode:e.target.value||null}},{onSuccess:()=>qc.invalidateQueries({queryKey:getListAdminOrdersQueryKey()})});}} /></label><button className="button button-outline py-2 text-xs" onClick={()=>update.mutate({orderId:o.id,data:{paymentStatus:o.paymentStatus==='pending'?'paid':'pending'}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListAdminOrdersQueryKey()});qc.invalidateQueries({queryKey:getGetAdminSummaryQueryKey()});}})}>{o.paymentStatus==='pending'?'Registrar pagamento confirmado':'Marcar pagamento pendente'}</button></div></div>)}</div>}</>}</AdminLayout>;
}
function AdminOrders() {
  const qc = useQueryClient();
  const canUpdateOrders = useCan("orders:update");
  const canConfirmPayments = useCan("payments:confirm");
  const canRefundPayments = useCan("payments:refund");
  const update = useUpdateOrderStatus();
  const [search, setSearch] = useState('');
  const [paymentFilter, setPaymentFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ order: AdminOrder; status: OrderStatus; paymentStatus?: PaymentStatus } | null>(null);
  const [confirmationAcknowledged, setConfirmationAcknowledged] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [trackingDraft, setTrackingDraft] = useState('');
  const params = useMemo<ListAdminOrdersParams>(() => ({
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(paymentFilter ? { paymentStatus: paymentFilter as PaymentStatus } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  }), [search, paymentFilter, dateFrom, dateTo]);
  const q = useListAdminOrders(params, { query: { queryKey: getListAdminOrdersQueryKey(params), retry: false } });
  const orders = (q.data ?? []) as AdminOrder[];
  const selectedOrder = orders.find(order => order.id === selectedId) ?? null;
  const permittedMoves = (order: AdminOrder): OrderStatus[] => {
    if (!canUpdateOrders) return [];
    return allowedOrderMoves[order.status].filter(next => {
      if (next === 'picked_up') return order.shippingMethod === 'pickup' && order.paymentStatus === 'paid';
      if (next === 'paid') return canConfirmPayments;
      if (order.paymentStatus === 'paid' && (next === 'cancelled' || next === 'returned')) return canRefundPayments;
      return true;
    });
  };

  const commitUpdate = (orderId: string, data: { status?: OrderStatus; paymentStatus?: PaymentStatus; trackingCode?: string | null }) => {
    if (!canUpdateOrders || (data.paymentStatus === 'paid' && !canConfirmPayments) || (data.paymentStatus === 'refunded' && !canRefundPayments)) {
      setFeedback('Seu perfil não tem permissão para esta alteração.');
      return;
    }
    setFeedback('');
    update.mutate({ orderId, data }, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getListAdminOrdersQueryKey() });
        void qc.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() });
        setFeedback('Pedido atualizado.');
        setConfirmation(null);
        setConfirmationAcknowledged(false);
      },
      onError: error => {
        setFeedback(`Não foi possível atualizar o pedido. ${errText(error)}`);
        setConfirmation(null);
        setConfirmationAcknowledged(false);
        setDraggingId(null);
      },
    });
  };
  const requestStatus = (order: AdminOrder, next: OrderStatus) => {
    if (order.status === next || order.status === 'returned' || update.isPending) return;
    if (!permittedMoves(order).includes(next)) {
      setFeedback(`Esta mudança de etapa não está disponível para o pedido ${order.orderNumber} ou para o seu perfil.`);
      return;
    }
    setFeedback('');
    const needsRefund = order.paymentStatus === 'paid' && (next === 'cancelled' || next === 'returned');
    if (next === 'paid' || next === 'cancelled' || next === 'returned') {
      setConfirmationAcknowledged(false);
      setConfirmation({
        order,
        status: next,
        ...(next === 'paid' ? { paymentStatus: 'paid' as const } : needsRefund ? { paymentStatus: 'refunded' as const } : {}),
      });
    } else {
      commitUpdate(order.id, { status: next });
    }
  };
  const saveTracking = (order: AdminOrder) => {
    const value = trackingDraft.trim();
    if (!canUpdateOrders || value === (order.trackingCode ?? '') || update.isPending) return;
    commitUpdate(order.id, { trackingCode: value || null });
  };
  const beginDrag = (event: DragEvent<HTMLElement>, order: AdminOrder) => {
    if (update.isPending || permittedMoves(order).length === 0) { event.preventDefault(); return; }
    event.dataTransfer.setData('text/order-id', order.id);
    event.dataTransfer.effectAllowed = 'move';
    setDraggingId(order.id);
  };
  const dropOnStage = (event: DragEvent<HTMLElement>, status: OrderStatus) => {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/order-id');
    const order = orders.find(item => item.id === id);
    setDraggingId(null);
    if (order) requestStatus(order, status);
  };
  const filteredOrderCount = orders.length;

  return <AdminLayout title="Pedidos e pagamentos" section="/admin/orders">
    <div className="orders-console">
      <header className="orders-heading">
        <div><div className="orders-kicker">RÁDIO 88 FM · OPERAÇÃO</div><h2>Fila de pedidos</h2><p>Do pagamento à entrega, cada pedido em seu próximo passo.</p></div>
        <div className="orders-live-count" data-testid="text-orders-count"><span>Pedidos no recorte</span><strong>{filteredOrderCount}</strong></div>
      </header>
      <section className="orders-toolbar" aria-label="Filtros de pedidos">
        <label className="orders-search"><Search size={16} aria-hidden="true" /><span className="sr-only">Buscar pedidos</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Pedido, cliente ou item" data-testid="input-orders-search" /></label>
        <label className="orders-filter"><span>Pagamento</span><span className="select-wrap"><select value={paymentFilter} onChange={event => setPaymentFilter(event.target.value)} data-testid="select-payment-filter"><option value="">Todos</option><option value="pending">Pendente</option><option value="paid">Pago</option><option value="failed">Falhou</option><option value="refunded">Reembolsado</option></select><ChevronDown size={14} aria-hidden="true" /></span></label>
        <label className="orders-filter"><span><CalendarDays size={13} /> De</span><input type="date" max={dateTo || undefined} value={dateFrom} onChange={event => setDateFrom(event.target.value)} data-testid="input-orders-date-from" /></label>
        <label className="orders-filter"><span><CalendarDays size={13} /> Até</span><input type="date" min={dateFrom || undefined} value={dateTo} onChange={event => setDateTo(event.target.value)} data-testid="input-orders-date-to" /></label>
        {(search || paymentFilter || dateFrom || dateTo) && <button type="button" className="orders-clear" onClick={() => { setSearch(''); setPaymentFilter(''); setDateFrom(''); setDateTo(''); }} data-testid="button-clear-order-filters">Limpar filtros</button>}
      </section>
      {feedback && <div className={`orders-feedback ${feedback.startsWith('Não') ? 'is-error' : ''}`} role={feedback.startsWith('Não') ? 'alert' : 'status'} data-testid="status-orders-feedback">{feedback}<button aria-label="Fechar aviso" onClick={() => setFeedback('')} data-testid="button-dismiss-order-feedback"><X size={15} /></button></div>}
      {q.isLoading ? <div className="orders-skeleton" aria-label="Carregando pedidos" data-testid="loading-admin-orders">{[0, 1, 2].map(i => <div key={i} className="orders-skeleton-column"><i /><i /><i /><i /></div>)}</div>
        : q.isError ? <div className="orders-load-error"><ErrorState retry={() => q.refetch()} message="A fila de pedidos não está disponível para este perfil." /></div>
        : !orders.length ? <div className="orders-empty" data-testid="empty-admin-orders"><div className="orders-empty-mark"><ClipboardList size={20} /></div><h3>{search || paymentFilter || dateFrom || dateTo ? 'Nenhum pedido neste recorte' : 'A fila está vazia'}</h3><p>{search || paymentFilter || dateFrom || dateTo ? 'Altere os filtros para procurar outros pedidos.' : 'Novos pedidos aparecerão aqui assim que forem registrados.'}</p>{(search || paymentFilter || dateFrom || dateTo) && <button onClick={() => { setSearch(''); setPaymentFilter(''); setDateFrom(''); setDateTo(''); }} data-testid="button-reset-empty-filters">Remover filtros</button>}</div>
        : <div className="orders-board" role="region" aria-label="Etapas dos pedidos; deslize horizontalmente para percorrer as colunas" tabIndex={0} data-testid="board-admin-orders">
          {orderStages.map((stage, index) => {
            const stageOrders = orders.filter(order => stage.key === 'cancelled' ? order.status === 'cancelled' || order.status === 'returned' : order.status === stage.key);
            const columnTotal = stageOrders.reduce((sum, order) => sum + order.total, 0);
            return <section key={stage.key} className={`orders-column stage-${stage.key}`} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }} onDrop={event => dropOnStage(event, stage.key)} data-testid={`column-orders-${stage.key}`} aria-label={`${stage.label}, ${stageOrders.length} pedidos`}>
              <div className="orders-column-head"><div className="orders-stage-title"><span className="orders-stage-index">0{index + 1}</span><h3>{stage.label}</h3><span className="orders-stage-count" data-testid={`count-orders-${stage.key}`}>{stageOrders.length}</span></div><strong data-testid={`total-orders-${stage.key}`}>{money(columnTotal)}</strong></div>
              {stageOrders.length === 0 ? <div className="orders-column-empty">Solte pedidos aqui</div> : <div className="orders-card-list">
                {stageOrders.map(order => <article key={order.id} draggable={!update.isPending && permittedMoves(order).length > 0} onDragStart={event => beginDrag(event, order)} onDragEnd={() => setDraggingId(null)} className={`order-card ${draggingId === order.id ? 'is-dragging' : ''} ${order.status === 'returned' ? 'is-returned' : ''}`} data-testid={`card-admin-order-${order.id}`}>
                  <div className="order-card-top"><span className="order-number" data-testid={`text-order-number-${order.id}`}>{order.orderNumber}</span><button className="order-grip" aria-label={`Mover pedido ${order.orderNumber}`} title="Arraste para mover" tabIndex={-1} data-testid={`drag-handle-order-${order.id}`}><GripVertical size={16} /></button></div>
                  <button className="order-card-open" onClick={() => { setSelectedId(order.id); setTrackingDraft(order.trackingCode ?? ''); }} data-testid={`button-open-order-${order.id}`} aria-label={`Abrir detalhes do pedido ${order.orderNumber}`}>
                    <span className="order-customer" data-testid={`text-customer-${order.id}`}>{order.customerName}</span>
                    <span className="order-customer-email" data-testid={`text-customer-email-${order.id}`}>{order.customerEmail}</span>
                    <span className="order-date"><Clock3 size={12} />{shortDate(order.createdAt)}</span>
                    <span className="order-items">{order.lines.reduce((total, line) => total + line.quantity, 0)} {order.lines.reduce((total, line) => total + line.quantity, 0) === 1 ? 'item' : 'itens'} <i>·</i> {order.lines.slice(0, 2).map(line => line.productName).join(', ')}{order.lines.length > 2 ? ` +${order.lines.length - 2}` : ''}</span>
                    <span className="order-card-bottom"><b data-testid={`text-order-total-${order.id}`}>{money(order.total)}</b><span><CreditCard size={12} />{paymentMethodText(order.paymentMethod)}</span></span>
                  </button>
                  <div className="order-card-status-row"><span className={`order-payment payment-${order.paymentStatus}`} data-testid={`status-payment-${order.id}`}>{statusText[order.paymentStatus]}</span>{order.status === 'returned' && <span className="order-returned-label" data-testid={`status-order-${order.id}`}>Devolvido</span>}</div>
                  {permittedMoves(order).length > 0 && <label className="orders-quick-change"><span className="sr-only">Solicitar mudança de status de {order.orderNumber}</span><select value="" disabled={update.isPending} onChange={event => { const value = event.target.value as OrderStatus; if (value) requestStatus(order, value); }} data-testid={`select-order-status-${order.id}`}><option value="">Mover para…</option>{orderStages.filter(item => permittedMoves(order).includes(item.key)).map(item => <option value={item.key} key={item.key}>{item.label}</option>)}</select><ChevronDown size={13} aria-hidden="true" /></label>}
                  {update.isPending && update.variables?.orderId === order.id && <span className="order-pending" data-testid={`status-order-pending-${order.id}`}>Salvando alteração…</span>}
                </article>)}
              </div>}
              <div className="orders-column-foot"><span>{stageOrders.length} {stageOrders.length === 1 ? 'pedido' : 'pedidos'}</span><b>{money(columnTotal)}</b></div>
            </section>;
          })}
        </div>}
      <p className="orders-board-hint"><GripVertical size={14} /> Arraste um cartão para mover. Também é possível usar “Mover para…” no cartão.</p>
    </div>
    {confirmation && <div className="orders-modal-backdrop" role="presentation">
      <section className="orders-modal orders-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="orders-confirm-title" data-testid="dialog-confirm-order-change">
        <button className="orders-modal-close" onClick={() => { setConfirmation(null); setConfirmationAcknowledged(false); }} aria-label="Fechar confirmação" data-testid="button-close-order-confirm"><X size={18} /></button>
        <div className="orders-modal-kicker">CONFIRMAÇÃO NECESSÁRIA</div><h2 id="orders-confirm-title">{confirmation.status === 'paid' ? 'Confirmar pagamento?' : confirmation.status === 'returned' ? 'Registrar devolução?' : 'Cancelar este pedido?'}</h2>
        <p>{confirmation.status === 'paid' ? <>O pagamento de <b>{confirmation.order.orderNumber}</b> será registrado como confirmado. Faça isso somente depois de verificar o recebimento do PIX.</> : confirmation.paymentStatus === 'refunded' ? <>O pedido <b>{confirmation.order.orderNumber}</b> será {confirmation.status === 'returned' ? 'marcado como devolvido' : 'cancelado'}. O pagamento só deve ser marcado como reembolsado depois de concluir o estorno manual.</> : confirmation.status === 'returned' ? <>O pedido <b>{confirmation.order.orderNumber}</b> será marcado como devolvido.</> : <>O pedido <b>{confirmation.order.orderNumber}</b> será movido para cancelados.</>}</p>
        {confirmation.status === 'paid' && <label className="orders-confirm-check"><input type="checkbox" checked={confirmationAcknowledged} onChange={event => setConfirmationAcknowledged(event.target.checked)} data-testid="checkbox-confirm-payment-received" />Confirmo que verifiquei o recebimento do pagamento.</label>}
        {confirmation.paymentStatus === 'refunded' && <label className="orders-confirm-check"><input type="checkbox" checked={confirmationAcknowledged} onChange={event => setConfirmationAcknowledged(event.target.checked)} data-testid="checkbox-confirm-refund-completed" />Confirmo que o reembolso manual já foi realizado.</label>}
        <div className="orders-confirm-actions"><button className="orders-button-quiet" onClick={() => { setConfirmation(null); setConfirmationAcknowledged(false); }} disabled={update.isPending} data-testid="button-cancel-order-change">Voltar</button><button className={`orders-button ${confirmation.status === 'paid' ? '' : 'danger'}`} onClick={() => commitUpdate(confirmation.order.id, { status: confirmation.status, ...(confirmation.paymentStatus ? { paymentStatus: confirmation.paymentStatus } : {}) })} disabled={update.isPending || ((confirmation.status === 'paid' || confirmation.paymentStatus === 'refunded') && !confirmationAcknowledged)} data-testid="button-confirm-order-change">{update.isPending ? 'Salvando…' : confirmation.status === 'paid' ? 'Confirmar pagamento' : confirmation.paymentStatus === 'refunded' ? confirmation.status === 'returned' ? 'Registrar devolução e reembolso' : 'Cancelar pedido' : confirmation.status === 'returned' ? 'Confirmar devolução' : 'Confirmar cancelamento'}</button></div>
      </section>
    </div>}
    {selectedOrder && <div className="orders-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelectedId(null); }}>
      <section className="orders-modal orders-detail-modal" role="dialog" aria-modal="true" aria-labelledby="orders-detail-title" data-testid={`dialog-order-details-${selectedOrder.id}`}>
        <header className="orders-detail-head"><div><div className="orders-modal-kicker">PEDIDO · {selectedOrder.orderNumber}</div><h2 id="orders-detail-title">{selectedOrder.customerName}</h2><p>{selectedOrder.customerEmail}</p></div><button className="orders-modal-close" onClick={() => setSelectedId(null)} aria-label="Fechar detalhes" data-testid="button-close-order-details"><X size={18} /></button></header>
        <div className="orders-detail-scroll">
          <div className="orders-detail-summary"><div><span>Status</span><b data-testid={`detail-status-${selectedOrder.id}`}>{selectedOrder.status === 'returned' ? 'Devolvido' : statusText[selectedOrder.status]}</b></div><div><span>Pagamento</span><b>{statusText[selectedOrder.paymentStatus]}</b></div><div><span>Criado em</span><b>{orderDateTime(selectedOrder.createdAt)}</b></div></div>
          <section className="orders-detail-section"><h3>Itens do pedido <span>{selectedOrder.lines.length}</span></h3>{selectedOrder.lines.map((line, index) => <div className="orders-line" key={`${line.sku}-${index}`} data-testid={`row-order-line-${selectedOrder.id}-${index}`}><div><b>{line.productName}</b><span>{line.variantName} · SKU {line.sku}</span><small>{line.quantity} × {money(line.unitPrice)}</small></div><strong>{money(line.lineTotal)}</strong></div>)}
            <div className="orders-money-row"><span>Subtotal</span><b>{money(selectedOrder.subtotal)}</b></div><div className="orders-money-row"><span>Frete · {selectedOrder.shippingLabel}</span><b>{money(selectedOrder.shippingFee)}</b></div><div className="orders-money-row is-total"><span>Total</span><b>{money(selectedOrder.total)}</b></div>
          </section>
          <section className="orders-detail-section"><h3>Entrega e pagamento</h3><div className="orders-context-row"><Truck size={15} /><div><b>{selectedOrder.shippingMethod === 'pickup' ? 'Retirada' : 'Entrega'} · {selectedOrder.shippingLabel}</b><span>{selectedOrder.shippingAddress || 'Sem endereço de entrega informado.'}</span></div></div>
            <div className="orders-context-row"><CreditCard size={15} /><div><b>{paymentMethodText(selectedOrder.paymentMethod)} · {statusText[selectedOrder.paymentStatus]}</b><span>{selectedOrder.paymentInstructions || 'Sem instruções adicionais de pagamento.'}</span></div></div>
            <div className="orders-tracking-edit"><label htmlFor={`tracking-${selectedOrder.id}`}>Código de rastreio</label><div><input id={`tracking-${selectedOrder.id}`} value={trackingDraft} onChange={event => setTrackingDraft(event.target.value)} placeholder="Ainda não informado" maxLength={120} disabled={!canUpdateOrders} data-testid={`input-tracking-code-${selectedOrder.id}`} />{canUpdateOrders && <button onClick={() => saveTracking(selectedOrder)} disabled={update.isPending || trackingDraft.trim() === (selectedOrder.trackingCode ?? '')} data-testid={`button-save-tracking-${selectedOrder.id}`}>{update.isPending ? 'Salvando…' : 'Salvar rastreio'}</button>}</div></div>
          </section>
          <section className="orders-detail-section"><h3>Histórico de status</h3><ol className="orders-history" data-testid={`list-order-history-${selectedOrder.id}`}>
            {[{ id: `created-${selectedOrder.id}`, fromStatus: null, toStatus: 'awaiting_payment', fromPaymentStatus: null, toPaymentStatus: 'pending', actorName: 'Sistema', createdAt: selectedOrder.createdAt }, ...selectedOrder.statusHistory].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).map((event, index) => <li key={event.id} data-testid={`history-event-${selectedOrder.id}-${event.id}`}><span className="orders-history-dot">{index === 0 ? <PackageCheck size={12} /> : <Check size={12} />}</span><div><b>{event.fromStatus ? `${statusText[event.fromStatus] ?? event.fromStatus} → ${statusText[event.toStatus] ?? event.toStatus}` : `Pedido criado · ${statusText[event.toStatus] ?? event.toStatus}`}</b>{event.toPaymentStatus && event.toPaymentStatus !== event.fromPaymentStatus && <span>Pagamento: {event.fromPaymentStatus ? `${statusText[event.fromPaymentStatus] ?? event.fromPaymentStatus} → ` : ''}{statusText[event.toPaymentStatus] ?? event.toPaymentStatus}</span>}<small>{orderDateTime(event.createdAt)} · {event.actorName || 'Sistema'}</small></div></li>)}
          </ol></section>
        </div>
        {update.isError && <div className="orders-detail-error" role="alert" data-testid="status-order-update-error">{errText(update.error)}</div>}
      </section>
    </div>}
  </AdminLayout>;
}
function AdminPeopleLegacy() {
 const qc=useQueryClient();const users=useListAdminUsers({query:{queryKey:getListAdminUsersQueryKey(),retry:false}});const audit=useListAuditEvents({query:{queryKey:getListAuditEventsQueryKey(),retry:false}});const role=useUpdateUserRole();const [error,setError]=useState('');
 return <AdminLayout title="Pessoas e acessos" section="/admin/users">{users.isLoading?<Loading/>:users.isError?<ErrorState retry={()=>users.refetch()} message="A gestão de pessoas não está autorizada para esta conta."/>:<><h2 className="display text-2xl">Contas da loja</h2>{!users.data?.length?<p className="mt-3 rounded-[20px] border border-dashed p-6 text-sm text-muted-foreground">Nenhuma conta encontrada.</p>:<div className="mt-3 grid gap-2">{users.data.map((u:any)=><div key={u.userId} className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] bg-card shadow-soft p-4"><div><b className="text-sm">{u.fullName||'Sem nome'}</b><p className="text-xs text-muted-foreground">{u.email} · desde {shortDate(u.createdAt)}</p></div><label className="text-xs font-bold">Papel<select className="field mt-1 w-40 py-2" value={u.role} onChange={e=>role.mutate({userId:u.userId,data:{role:e.target.value as any}},{onSuccess:()=>{qc.invalidateQueries({queryKey:getListAdminUsersQueryKey()});qc.invalidateQueries({queryKey:getListAuditEventsQueryKey()});},onError:e=>setError(errText(e))})}><option value="customer">Cliente</option><option value="operations">Operações</option><option value="admin">Administrador</option></select></label></div>)}</div>}{error&&<div className="mt-3"><Notice text={error}/></div>}<div className="mt-9 flex items-center gap-2"><Activity className="text-foreground"/><h2 className="display text-2xl">Atividade administrativa</h2></div>{audit.isLoading?<Loading/>:audit.isError?<ErrorState retry={()=>audit.refetch()} message="O registro de atividade não está disponível para este perfil."/>:!audit.data?.length?<p className="mt-3 rounded-[20px] border border-dashed p-6 text-sm text-muted-foreground">Nenhuma atividade registrada.</p>:<div className="mt-3 grid gap-2">{audit.data.map((a:any)=><div key={a.id} className="rounded-[20px] bg-card shadow-soft p-4"><div className="flex justify-between gap-3 text-xs"><b>{a.actorName} · {a.action}</b><span className="text-muted-foreground">{shortDate(a.createdAt)}</span></div><p className="mt-1 text-sm">{a.details}</p><small className="text-muted-foreground">{a.entityType} · {a.entityId}</small></div>)}</div>}</>}</AdminLayout>;
}

function AdminPeople() {
  return <AdminLayout title="Pessoas e acessos" section="/admin/users"><AdminAccessPage /></AdminLayout>;
}

function Home() { return <Catalog />; }
function SignInPage() { return <div className="grid min-h-[100dvh] content-center bg-muted px-4 py-8"><div className="mx-auto mb-4 w-full max-w-[440px]"><Logo /></div><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>; }
function SignUpPage() { return <div className="grid min-h-[100dvh] content-center bg-muted px-4 py-8"><div className="mx-auto mb-4 w-full max-w-[440px]"><Logo /></div><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>; }

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
function Routes() {
  return <Switch>
    <Route path="/" component={()=><Shell><Home/></Shell>} />
    <Route path="/sign-in/*?" component={SignInPage} />
    <Route path="/sign-up/*?" component={SignUpPage} />
    <Route path="/product/:productId" component={()=><Shell><StoreProductPage/></Shell>} />
    <Route path="/favorites" component={()=><Shell><FavoritesPage/></Shell>} />
    <Route path="/cart" component={()=><Shell><StoreCartPage/></Shell>} />
    <Route path="/checkout" component={()=><Shell><StoreCheckoutPage/></Shell>} />
    <Route path="/orders" component={()=><Shell><OrdersPage/></Shell>} />
    <Route path="/orders/:orderId" component={()=><Shell><OrderPage/></Shell>} />
    <Route path="/account/addresses" component={()=><Shell><AddressPage/></Shell>} />
    <Route path="/account" component={()=><Shell><AccountPage/></Shell>} />
    <Route path="/terms" component={()=><Shell><LegalPage type="terms"/></Shell>} />
    <Route path="/privacy" component={()=><Shell><LegalPage type="privacy"/></Shell>} />
    <Route path="/returns" component={()=><Shell><LegalPage type="returns"/></Shell>} />
    <Route path="/cookies" component={()=><Shell><CookiePolicyPage/></Shell>} />
    <Route path="/help" component={()=><Shell><StoreHelpPage/></Shell>} />
    <Route path="/contact" component={()=><Shell><ContactPage/></Shell>} />
    <Route path="/admin" component={()=><Shell><AdminHome/></Shell>} />
    <Route path="/admin/products" component={()=><Shell><AdminLayout title="Produtos e categorias" section="/admin/products"><AdminProductsCatalog/></AdminLayout></Shell>} />
    <Route path="/admin/stock" component={()=><Shell><AdminLayout title="Estoque" section="/admin/stock"><AdminStockPage /></AdminLayout></Shell>} />
    <Route path="/admin/orders" component={()=><Shell><AdminOrders/></Shell>} />
    <Route path="/admin/content" component={()=><Shell><AdminLayout title="Conteúdo da vitrine" section="/admin/content"><AdminContent/></AdminLayout></Shell>} />
    <Route path="/admin/config" component={()=><Shell><AdminLayout title="Frete e envios" section="/admin/config"><AdminShippingConfig/></AdminLayout></Shell>} />
    <Route path="/admin/fiscal" component={()=><Shell><AdminLayout title="Notas fiscais" section="/admin/fiscal"><AdminFiscalPage/></AdminLayout></Shell>} />
    <Route path="/admin/users" component={()=><Shell><AdminPeople/></Shell>} />
    <Route path="/admin/activity" component={()=><Shell><AdminLayout title="Atividade administrativa" section="/admin/activity"><AdminActivityPage/></AdminLayout></Shell>} />
    <Route component={()=><Shell><main className="shell py-24 text-center"><div className="eyebrow">Página não encontrada</div><h1 className="display mt-3 text-5xl">Essa página saiu do ar.</h1><Link href="/" className="button mt-6">Voltar para a loja</Link></main></Shell>} />
  </Switch>;
}

function ClerkCacheInvalidator() {
  const { addListener } = useClerk(); const qc = useQueryClient(); const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({user}) => { const id = user?.id ?? null; if (previous.current !== undefined && previous.current !== id) qc.clear(); previous.current = id; }), [addListener, qc]);
  return null;
}
function RealtimeBridge() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const qc = useQueryClient();
  useEffect(() => {
    if (import.meta.env.VITE_REALTIME_ENABLED === 'false' || !isLoaded || !isSignedIn) return;

    let disposed = false;
    const socket = io(window.location.origin, {
      path: '/api/socket.io',
      autoConnect: false,
      auth: callback => {
        void getToken()
          .then(token => { if (!disposed) callback({ token }); })
          .catch(() => { if (!disposed) callback({}); });
      },
    });
    const refreshOrders = () => {
      void qc.invalidateQueries({ queryKey: getListAdminOrdersQueryKey() });
      void qc.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() });
      void qc.invalidateQueries({ queryKey: getListMyOrdersQueryKey() });
    };
    const refreshStock = (productId?: string) => {
      void qc.invalidateQueries({ queryKey: getListAdminStockQueryKey() });
      void qc.invalidateQueries({ queryKey: getListAdminStockMovementsQueryKey() });
      void qc.invalidateQueries({ queryKey: getListAdminProductsQueryKey() });
      void qc.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() });
      void qc.invalidateQueries({ queryKey: getListProductsQueryKey() });
      if (productId) void qc.invalidateQueries({ queryKey: getGetProductQueryKey(productId) });
    };
    const refreshProducts = (productId?: string) => {
      void qc.invalidateQueries({ queryKey: getListProductsQueryKey() });
      void qc.invalidateQueries({ queryKey: getListAdminProductsQueryKey() });
      if (productId) void qc.invalidateQueries({ queryKey: getGetProductQueryKey(productId) });
    };

    socket.on('connect', () => {
      refreshOrders();
      refreshStock();
      refreshProducts();
    });
    socket.on('order:created', ({ orderNumber }: { orderId: string; orderNumber: string }) => {
      refreshOrders();
      toast.success(`Novo pedido ${orderNumber}`);
    });
    socket.on('order:updated', ({ orderId }: { orderId: string }) => {
      refreshOrders();
      void qc.invalidateQueries({ queryKey: getGetMyOrderQueryKey(orderId) });
    });
    socket.on('stock:changed', ({ productId }: { variantId: string; productId: string; availableStock: number }) => {
      refreshStock(productId);
    });
    socket.on('stock:low', ({ productId }: { variantId: string; productId: string; availableStock: number; minimumStock: number }) => {
      refreshStock(productId);
    });
    socket.on('product:updated', ({ productId }: { productId: string }) => refreshProducts(productId));

    socket.connect();
    return () => {
      disposed = true;
      socket.disconnect();
    };
  }, [getToken, isLoaded, isSignedIn, qc]);
  return null;
}
function ClerkRoutes() {
  const [, setLocation] = useLocation();
  const appearance = {
    theme: shadcn, cssLayerName: 'clerk',
    options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
    variables: { colorPrimary: '#202522', colorForeground: '#202522', colorMutedForeground: '#626a62', colorDanger: '#b3261e', colorBackground: '#ffffff', colorInput: '#ffffff', colorInputForeground: '#202522', colorNeutral: '#767676', fontFamily: 'Helvetica, Arial, sans-serif', borderRadius: '8px' },
    elements: {
      rootBox: 'w-full flex justify-center',
      cardBox: 'w-[440px] max-w-full overflow-hidden rounded-[24px] border border-[#dedede] bg-white shadow-[0_14px_45px_rgba(0,0,0,0.08)]',
      card: 'border-0 bg-white shadow-none',
      footer: 'border-0 bg-white shadow-none',
      headerTitle: 'font-medium tracking-tight text-[#202522]',
      headerSubtitle: 'text-[#626a62]',
      socialButtonsBlockButtonText: 'text-[#202522]',
      formFieldLabel: 'text-[#202522]',
      footerActionLink: 'text-[#202522] underline',
      footerActionText: 'text-[#626a62]',
      dividerText: 'text-[#626a62]',
      identityPreviewEditButton: 'text-[#202522] underline',
      formFieldSuccessText: 'text-[#24633f]',
      alertText: 'text-[#b3261e]',
      socialButtonsBlockButton: 'rounded-lg border-[#dedede] bg-white',
      formButtonPrimary: 'rounded-lg bg-[#202522] text-white hover:bg-[#3c423d]',
      formFieldInput: 'rounded-lg border-[#767676] bg-white text-[#202522]',
      dividerLine: 'bg-[#dedede]',
      otpCodeFieldInput: 'rounded-lg border-[#767676] text-[#202522]',
    },
  };
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{...ptBR,signIn:{...ptBR.signIn,start:{...ptBR.signIn?.start,title:'Que bom ter você de volta',subtitle:'Entre para acompanhar sua sintonia.'}},signUp:{...ptBR.signUp,start:{...ptBR.signUp?.start,title:'Chegue mais perto da 88',subtitle:'Crie sua conta para comprar e acompanhar pedidos.'}}}} routerPush={(to: string)=>setLocation(stripBase(to))} routerReplace={(to: string)=>setLocation(stripBase(to),{replace:true})}><QueryClientProvider client={client}><ClerkCacheInvalidator/><RealtimeBridge/><Toaster position="top-right"/><RoutedErrorBoundary><Routes/></RoutedErrorBoundary></QueryClientProvider></ClerkProvider>;
}
function App() {
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
  return <WouterRouter base={basePath}><ClerkRoutes/></WouterRouter>;
}
export default App;

const allowedOrderMoves: Record<OrderStatus, OrderStatus[]> = {
  awaiting_payment: ['paid', 'cancelled'],
  paid: ['packing', 'picked_up', 'cancelled'],
  packing: ['shipped', 'picked_up', 'cancelled'],
  shipped: ['delivered', 'returned'],
  delivered: ['returned'],
  picked_up: ['returned'],
  cancelled: [],
  returned: [],
};

const paymentMethodText = (method: string) => method === 'pix_manual' ? 'PIX manual' : method;

const orderDateTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
