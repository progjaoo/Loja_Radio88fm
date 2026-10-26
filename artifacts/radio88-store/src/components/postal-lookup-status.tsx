import type { usePostalAddress } from '@/lib/postal-address';

export function PostalLookupStatus({ lookup }: { lookup: ReturnType<typeof usePostalAddress> }) {
  return <div className="mt-2 text-xs leading-5 text-muted-foreground" role="status" aria-live="polite" data-testid="postal-lookup-status">
    {lookup.status === 'loading' && 'Buscando endereço pelo CEP…'}
    {lookup.status === 'error' && <>{lookup.message} <button type="button" className="underline" onClick={lookup.retry}>Tentar novamente</button></>}
    {lookup.status === 'success' && lookup.address && <>
      {[lookup.address.street, lookup.address.neighborhood, `${lookup.address.city} - ${lookup.address.state}`].filter(Boolean).join(' · ')}
      {!lookup.address.street && <span className="block">Este CEP não informa uma rua. Preencha rua, bairro e número manualmente.</span>}
    </>}
  </div>;
}
