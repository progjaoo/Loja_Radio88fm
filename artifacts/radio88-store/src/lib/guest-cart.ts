import { useEffect, useState } from 'react';
import type { Cart, CartLine, Product, ProductVariant } from '@workspace/api-client-react';
import { effectiveVariantPrice } from '@/components/product-ui';

const STORAGE_KEY = 'radio88.guest-cart.v1';
const EVENT_NAME = 'radio88:guest-cart-change';

export function readGuestCart(): Cart {
  if (typeof window === 'undefined') return { lines: [], subtotal: 0 };
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return { lines: [], subtotal: 0 };
    const parsed = JSON.parse(saved) as Cart;
    const lines = Array.isArray(parsed.lines) ? parsed.lines : [];
    return { lines, subtotal: lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0) };
  } catch {
    return { lines: [], subtotal: 0 };
  }
}

function save(cart: Cart) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function addGuestProduct(product: Product, variant: ProductVariant, quantity = 1) {
  const cart = readGuestCart();
  const price = effectiveVariantPrice(product, variant);
  const existing = cart.lines.find(line => line.variantId === variant.id);
  let lines: CartLine[];
  if (existing) {
    lines = cart.lines.map(line => line.variantId === variant.id
      ? { ...line, quantity: Math.min(line.stockAvailable, 20, line.quantity + quantity), lineTotal: line.unitPrice * Math.min(line.stockAvailable, 20, line.quantity + quantity) }
      : line);
  } else {
    const imageUrl = product.images?.find(image => image.isPrimary)?.url ?? product.imageUrl;
    lines = [...cart.lines, {
      id: `guest-${variant.id}`, variantId: variant.id, productName: product.name, variantName: variant.name,
      sku: variant.sku, imageUrl, unitPrice: price, quantity: Math.min(quantity, variant.stock, 20),
      stockAvailable: variant.stock, lineTotal: price * Math.min(quantity, variant.stock, 20),
    }];
  }
  save({ lines, subtotal: lines.reduce((sum, line) => sum + line.lineTotal, 0) });
}

export function updateGuestQuantity(variantId: string, quantity: number) {
  const cart = readGuestCart();
  const lines = cart.lines.map(line => line.variantId === variantId
    ? { ...line, quantity, lineTotal: line.unitPrice * quantity }
    : line);
  save({ lines, subtotal: lines.reduce((sum, line) => sum + line.lineTotal, 0) });
}

export function removeGuestLine(variantId: string) {
  const lines = readGuestCart().lines.filter(line => line.variantId !== variantId);
  save({ lines, subtotal: lines.reduce((sum, line) => sum + line.lineTotal, 0) });
}

export function clearGuestCart() {
  save({ lines: [], subtotal: 0 });
}

export function useGuestCart() {
  const [cart, setCart] = useState(readGuestCart);
  useEffect(() => {
    const refresh = () => setCart(readGuestCart());
    window.addEventListener(EVENT_NAME, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(EVENT_NAME, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return cart;
}

