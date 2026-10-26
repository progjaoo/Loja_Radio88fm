import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/react';
import { useLocation } from 'wouter';
import { Heart } from 'lucide-react';
import { toast } from 'sonner';
import {
  getListFavoritesQueryKey,
  useAddFavorite,
  useListFavorites,
  useRemoveFavorite,
} from '@workspace/api-client-react';
import type { Product } from '@workspace/api-client-react';
import { userFacingError } from '@/lib/user-facing-errors';

export function FavoriteToggle({ product, className = '' }: { product: Product; className?: string }) {
  const { isSignedIn } = useAuth();
  const [, navigate] = useLocation();
  const favorites = useListFavorites({ query: { enabled: !!isSignedIn, queryKey: getListFavoritesQueryKey() } });
  const add = useAddFavorite();
  const remove = useRemoveFavorite();
  const queryClient = useQueryClient();
  const active = !!favorites.data?.some(item => item.id === product.id);

  const toggle = () => {
    if (!isSignedIn) {
      navigate('/sign-in');
      return;
    }
    const mutation = active ? remove : add;
    mutation.mutate({ productId: product.id }, {
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: getListFavoritesQueryKey() }),
      onError: error => toast.error(userFacingError(error)),
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className={`favorite-toggle ${active ? 'is-active' : ''} ${className}`}
      aria-label={active ? `Remover ${product.name} dos favoritos` : `Salvar ${product.name} nos favoritos`}
      aria-pressed={active}
      data-testid={`button-favorite-${product.id}`}
    >
      <Heart size={16} strokeWidth={1.9} fill={active ? 'currentColor' : 'none'} aria-hidden="true" />
    </button>
  );
}
