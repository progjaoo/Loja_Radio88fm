import { Backpack, Coffee, Disc3, Gift, Headphones, ShoppingBag, Shirt, Tag, type LucideIcon } from 'lucide-react';
import type { CategoryIcon } from '@workspace/api-client-react';

export const categoryIconOptions: { value: CategoryIcon; label: string; icon: LucideIcon }[] = [
  { value: 'shopping-bag', label: 'Sacola', icon: ShoppingBag },
  { value: 'shirt', label: 'Vestuário', icon: Shirt },
  { value: 'coffee', label: 'Canecas', icon: Coffee },
  { value: 'headphones', label: 'Áudio', icon: Headphones },
  { value: 'backpack', label: 'Mochilas', icon: Backpack },
  { value: 'gift', label: 'Brindes', icon: Gift },
  { value: 'disc', label: 'Discos', icon: Disc3 },
  { value: 'tag', label: 'Etiqueta', icon: Tag },
];

function guess(name: string) {
  const n = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/camis|roupa|bone|vestu|moletom/.test(n)) return 'shirt';
  if (/canec|copo|xicara|garrafa|cafe/.test(n)) return 'coffee';
  if (/fone|audio|som|radio/.test(n)) return 'headphones';
  if (/mochila|bolsa|ecobag/.test(n)) return 'backpack';
  if (/brinde|presente|kit/.test(n)) return 'gift';
  if (/disco|vinil|cd|musica/.test(n)) return 'disc';
  if (/adesivo|etiqueta|papelaria/.test(n)) return 'tag';
  return 'shopping-bag';
}

export function categoryIconFor(c: { name: string; iconName?: string | null }): LucideIcon {
  const key = c.iconName || guess(c.name);
  return (categoryIconOptions.find(o => o.value === key) ?? categoryIconOptions[0]).icon;
}

export function CategoryIconView({ category, size = 18 }: { category: { name: string; iconName?: string | null }; size?: number }) {
  const Icon = categoryIconFor(category);
  return <Icon size={size} strokeWidth={1.6} aria-hidden="true" />;
}
