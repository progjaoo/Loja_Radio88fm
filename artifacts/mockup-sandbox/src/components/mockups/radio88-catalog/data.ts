export type CatalogVariant = {
  id: string;
  name: string;
  sku: string;
  price: number;
  stock: number;
  lowStockThreshold: number;
  size?: string;
  color?: string;
  active: boolean;
};

export type CatalogProduct = {
  id: string;
  name: string;
  description: string;
  baseSku: string;
  internalCode: string;
  categoryId: string;
  categoryName: string;
  lineId: string;
  lineName: string;
  brand: string;
  material: string;
  tags: string[];
  featured: boolean;
  active: boolean;
  status: "active" | "hidden" | "inactive";
  variants: CatalogVariant[];
  mark: string;
};

export type CatalogCategory = {
  id: string;
  name: string;
  slug: string;
  description: string;
  active: boolean;
};

export type CatalogLine = {
  id: string;
  name: string;
  active: boolean;
};

export const initialProducts: CatalogProduct[] = [
  {
    id: "p-01", name: "Camiseta Rádio 88 — Frequência", description: "Camiseta oficial em algodão, edição Rádio 88 FM.",
    baseSku: "R88-CAM-FREQ", internalCode: "CAM-0088", categoryId: "cat-vestuario", categoryName: "Vestuário", lineId: "line-basicos", lineName: "Essenciais 88",
    brand: "Rádio 88 FM", material: "Algodão", tags: ["rádio 88", "clássicos"], featured: true, active: true, status: "active", mark: "88",
    variants: [
      { id: "v-01", name: "Preta / M", sku: "R88-CAM-FREQ-PRE-M", price: 8990, stock: 18, lowStockThreshold: 4, size: "M", color: "Preta", active: true },
      { id: "v-02", name: "Preta / G", sku: "R88-CAM-FREQ-PRE-G", price: 8990, stock: 3, lowStockThreshold: 4, size: "G", color: "Preta", active: true },
    ],
  },
  {
    id: "p-02", name: "Caneca Sintonia", description: "Caneca cerâmica esmaltada com a marca Rádio 88.",
    baseSku: "R88-CAN-SINT", internalCode: "CAN-0012", categoryId: "cat-acessorios", categoryName: "Acessórios", lineId: "line-basicos", lineName: "Essenciais 88",
    brand: "Rádio 88 FM", material: "Cerâmica", tags: ["casa", "presente"], featured: false, active: true, status: "active", mark: "88",
    variants: [{ id: "v-03", name: "Branca", sku: "R88-CAN-SINT-BRC", price: 5490, stock: 27, lowStockThreshold: 5, color: "Branca", active: true }],
  },
  {
    id: "p-03", name: "Moletom Frequência", description: "Moletom de algodão com estampa bordada no peito.",
    baseSku: "R88-MOL-FREQ", internalCode: "MOL-0004", categoryId: "cat-vestuario", categoryName: "Vestuário", lineId: "line-ao-vivo", lineName: "Ao Vivo",
    brand: "Rádio 88 FM", material: "Moletom", tags: ["inverno", "rádio 88"], featured: true, active: true, status: "active", mark: "88",
    variants: [{ id: "v-04", name: "Cinza / G", sku: "R88-MOL-FREQ-CZ-G", price: 17990, stock: 2, lowStockThreshold: 3, size: "G", color: "Cinza", active: true }],
  },
  {
    id: "p-04", name: "Boné Ao Vivo", description: "Boné de sarja ajustável, bordado frontal.",
    baseSku: "R88-BON-AOV", internalCode: "BON-0021", categoryId: "cat-acessorios", categoryName: "Acessórios", lineId: "line-ao-vivo", lineName: "Ao Vivo",
    brand: "Rádio 88 FM", material: "Sarja", tags: ["ao vivo"], featured: false, active: true, status: "hidden", mark: "88",
    variants: [{ id: "v-05", name: "Vinho", sku: "R88-BON-AOV-VIN", price: 7490, stock: 14, lowStockThreshold: 3, color: "Vinho", active: true }],
  },
  {
    id: "p-05", name: "Ecobag Frequência", description: "Sacola de algodão cru com estampa exclusiva.",
    baseSku: "R88-ECO-FREQ", internalCode: "ECO-0088", categoryId: "cat-casa", categoryName: "Casa & som", lineId: "line-basicos", lineName: "Essenciais 88",
    brand: "Rádio 88 FM", material: "Algodão cru", tags: ["sustentável", "presente"], featured: false, active: true, status: "active", mark: "88",
    variants: [{ id: "v-06", name: "Natural", sku: "R88-ECO-FREQ-NAT", price: 3990, stock: 31, lowStockThreshold: 5, color: "Natural", active: true }],
  },
  {
    id: "p-06", name: "Patch Frequência FM", description: "Patch bordado termocolante da Rádio 88 FM.",
    baseSku: "R88-PAT-FM", internalCode: "PAT-0088", categoryId: "cat-acessorios", categoryName: "Acessórios", lineId: "line-ao-vivo", lineName: "Ao Vivo",
    brand: "Rádio 88 FM", material: "Bordado", tags: ["coleção"], featured: false, active: true, status: "active", mark: "FM",
    variants: [{ id: "v-07", name: "Padrão", sku: "R88-PAT-FM-01", price: 2490, stock: 0, lowStockThreshold: 4, active: true }],
  },
];

export const initialCategories: CatalogCategory[] = [
  { id: "cat-vestuario", name: "Vestuário", slug: "vestuario", description: "Camisetas, moletons e peças para vestir a frequência.", active: true },
  { id: "cat-acessorios", name: "Acessórios", slug: "acessorios", description: "Pequenos detalhes para levar a Rádio 88 por aí.", active: true },
  { id: "cat-casa", name: "Casa & som", slug: "casa-som", description: "Objetos para ouvir, colecionar e ficar por perto.", active: true },
  { id: "cat-edicoes", name: "Edições especiais", slug: "edicoes-especiais", description: "Lançamentos limitados e itens de temporada.", active: false },
];

export const initialLines: CatalogLine[] = [
  { id: "line-basicos", name: "Essenciais 88", active: true },
  { id: "line-ao-vivo", name: "Ao Vivo", active: true },
  { id: "line-arquivo", name: "Arquivo 88", active: false },
];

export const formatBRL = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

export const statusLabel = (product: CatalogProduct) =>
  !product.active ? "Arquivado" : product.status === "active" ? "Ativo" : product.status === "hidden" ? "Oculto" : "Inativo";

export const isLowStock = (product: CatalogProduct) =>
  product.variants.reduce((sum, variant) => sum + variant.stock, 0) <=
  product.variants.reduce((sum, variant) => sum + variant.lowStockThreshold, 0);
