import { useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAdminProducts, useListAdminCategories, useListAdminProductLines,
  useCreateProduct, useUpdateProduct, useArchiveProduct, useBulkUpdateProductStatus,
  useCreateCategory, useUpdateCategory, useDeleteCategory,
  useCreateProductLine, useUpdateProductLine, useArchiveProductLine,
  useCreateProductVariant, useUpdateProductVariant,
  getListAdminProductsQueryKey, getListAdminCategoriesQueryKey, getListAdminProductLinesQueryKey,
  getListProductsQueryKey, getListCategoriesQueryKey, getGetAdminSummaryQueryKey,
} from "@workspace/api-client-react";
import type { AdminCategory, Product, ProductInput, ProductLine, ProductLineInput, ProductStatus, ProductVariantInput, ProductUpdate, CategoryIcon } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { userFacingError } from "@/lib/user-facing-errors";
import { Archive, ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Copy, ImagePlus, Layers3, ListFilter, Pencil, Plus, Search, Tag, X } from "lucide-react";
import { ImageUploadField } from "@/components/image-upload";
import { CurrencyInput } from "@/components/currency-input";
import { Loading, ErrorState, Notice } from "@/components/feedback";
import { ProductImage } from "@/components/product-ui";
import { fromCents, toCents } from "@/lib/currency";
import { money } from "@/lib/format";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useCan } from "@/components/admin-permissions";

type Tab = "products" | "categories" | "lines";
type VariantDraft = {
  id?: string;
  name: string;
  sku: string;
  price: number;
  stock: number;
  lowStockThreshold: number;
  barcode: string;
  size: string;
  color: string;
  attributesText: string;
  costPrice: number | null;
  weightGrams: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  active: boolean;
};
type ProductDraft = {
  name: string; description: string; imageUrl: string; categoryId: string; lineId: string;
  baseSku: string; internalCode: string; pieceType: string; brand: string; material: string; ncmSuggestion: string;
  tags: string; promotionalPrice: number | null; promotionStartsAt: string; promotionEndsAt: string;
  featured: boolean; status: ProductStatus;
  variants: VariantDraft[];
};
type ProductImageDraft = Pick<Product["images"][number], "url" | "alt" | "sortOrder" | "isPrimary" | "isHover">;
const emptyVariant = (): VariantDraft => ({
  name: "Padrão", sku: "", price: 0, stock: 0, lowStockThreshold: 2,
  barcode: "", size: "", color: "", attributesText: "{}", costPrice: null,
  weightGrams: null, lengthCm: null, widthCm: null, heightCm: null, active: true,
});
const emptyDraft: ProductDraft = {
  name: "", description: "", imageUrl: "", categoryId: "", lineId: "", baseSku: "", internalCode: "",
  pieceType: "", brand: "", material: "", ncmSuggestion: "", tags: "", promotionalPrice: null, promotionStartsAt: "",
  promotionEndsAt: "", featured: false, status: "active",
  variants: [emptyVariant()],
};
const iconOptions: CategoryIcon[] = ["shopping-bag", "shirt", "coffee", "headphones", "backpack", "gift", "disc", "tag"];
const errorMessage = userFacingError;
const dateField = (value: string | null) => value ? value.slice(0, 10) : "";
const productFormSchema = z.object({
  name: z.string().trim().min(2, "Informe pelo menos 2 caracteres.").max(160, "Use até 160 caracteres."),
  description: z.string().max(5000, "Use até 5.000 caracteres."),
  images: z.array(z.object({
    url: z.string().min(1, "A foto precisa ter um endereço válido."),
    alt: z.string().max(240, "Use até 240 caracteres."),
    sortOrder: z.number().int().min(0),
    isPrimary: z.boolean(),
    isHover: z.boolean(),
  })).max(5, "O produto pode ter no máximo cinco fotos."),
  galleryLayout: z.enum(["square", "portrait"]),
  categoryId: z.string(),
  lineId: z.string(),
  baseSku: z.string().max(80, "Use até 80 caracteres."),
  internalCode: z.string().max(80, "Use até 80 caracteres."),
  pieceType: z.string().max(80, "Use até 80 caracteres."),
  brand: z.string().max(100, "Use até 100 caracteres."),
  material: z.string().max(160, "Use até 160 caracteres."),
  ncmSuggestion: z.string().refine(value => value === "" || /^[0-9]{8}$/.test(value), "Informe 8 dígitos ou deixe vazio."),
  tags: z.string(),
  promotionalPrice: z.number().min(0, "O preço promocional não pode ser negativo.").nullable(),
  promotionStartsAt: z.string().refine(value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), "Informe uma data válida."),
  promotionEndsAt: z.string().refine(value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), "Informe uma data válida."),
  featured: z.boolean(),
  status: z.enum(["active", "hidden", "inactive"]),
  variants: z.array(z.object({
    id: z.string().optional(),
    name: z.string().trim().min(1, "Informe o nome da variação.").max(100),
    sku: z.string().trim().min(1, "Informe o SKU.").max(80),
    price: z.number().min(0, "O preço não pode ser negativo."),
    stock: z.number().int().min(0, "O estoque deve ser zero ou maior."),
    lowStockThreshold: z.number().int().min(0, "O limite deve ser zero ou maior."),
    barcode: z.string().max(80, "Use até 80 caracteres."),
    size: z.string().max(40, "Use até 40 caracteres."),
    color: z.string().max(60, "Use até 60 caracteres."),
    attributesText: z.string().max(4000).refine(value => {
      try {
        const parsed = value.trim() ? JSON.parse(value) : {};
        return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) &&
          Object.values(parsed).every(item => typeof item === "string" && item.length <= 100);
      } catch {
        return false;
      }
    }, "Use um objeto JSON com valores de texto."),
    costPrice: z.number().min(0).nullable(),
    weightGrams: z.number().int().min(0).nullable(),
    lengthCm: z.number().min(0).nullable(),
    widthCm: z.number().min(0).nullable(),
    heightCm: z.number().min(0).nullable(),
    active: z.boolean(),
  })).min(1, "Adicione ao menos uma variação."),
}).superRefine((values, context) => {
  if (values.promotionStartsAt && values.promotionEndsAt && values.promotionEndsAt <= values.promotionStartsAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["promotionEndsAt"],
      message: "O fim da promoção precisa ser posterior ao início.",
    });
  }
  const seenSkus = new Set<string>();
  if (values.images.length && values.images.filter(image => image.isPrimary).length !== 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["images"],
      message: "Escolha exatamente uma foto de capa.",
    });
  }
  if (values.images.filter(image => image.isHover).length > 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["images"],
      message: "Escolha no máximo uma foto para o hover do card.",
    });
  }
  values.variants.forEach((variant, index) => {
    const sku = variant.sku.trim().toLocaleLowerCase("pt-BR");
    if (seenSkus.has(sku)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["variants", index, "sku"],
        message: "Cada variação precisa ter um SKU diferente.",
      });
    }
    seenSkus.add(sku);
    const dimensions = [variant.lengthCm, variant.widthCm, variant.heightCm];
    if (dimensions.some(value => value !== null) && dimensions.some(value => value === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["variants", index, "lengthCm"],
        message: "Preencha comprimento, largura e altura ou deixe os três campos vazios.",
      });
    }
  });
});
type ProductFormValues = z.infer<typeof productFormSchema>;
const emptyProductFormValues: ProductFormValues = {
  name: "", description: "", images: [], galleryLayout: "square", categoryId: "", lineId: "", baseSku: "", internalCode: "",
  pieceType: "", brand: "", material: "", ncmSuggestion: "", tags: "", promotionalPrice: null, promotionStartsAt: "",
  promotionEndsAt: "", featured: false, status: "active", variants: [emptyVariant()],
};

function productImages(product?: Product): ProductImageDraft[] {
  if (!product) return [];
  if (product.images?.length) {
    return [...product.images]
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map(({ url, alt, sortOrder, isPrimary, isHover }) => ({ url, alt, sortOrder, isPrimary, isHover }));
  }
  return product.imageUrl
    ? [{ url: product.imageUrl, alt: product.name, sortOrder: 0, isPrimary: true, isHover: false }]
    : [];
}

function primaryImageUrl(images: ProductImageDraft[]): string {
  return images.find(image => image.isPrimary)?.url ?? images[0]?.url ?? "";
}

function orderedProductImages(images: ProductImageDraft[], productName: string): ProductImageDraft[] {
  const primary = images.findIndex(image => image.isPrimary);
  return images.map((image, index) => ({
    ...image,
    alt: image.alt.trim() || productName,
    sortOrder: index,
    isPrimary: index === primary || (primary === -1 && index === 0),
    isHover: image.isHover ?? false,
  }));
}

function parseVariantAttributes(value: string): Record<string, string> {
  return value.trim() ? JSON.parse(value) as Record<string, string> : {};
}

function variantDimensions(variant: ProductFormValues["variants"][number]) {
  if (variant.lengthCm === null || variant.widthCm === null || variant.heightCm === null) return null;
  return { length: variant.lengthCm, width: variant.widthCm, height: variant.heightCm };
}

function variantFields(variant: ProductFormValues["variants"][number]) {
  return {
    name: variant.name.trim(),
    sku: variant.sku.trim(),
    price: fromCents(variant.price),
    lowStockThreshold: Number(variant.lowStockThreshold),
    barcode: variant.barcode.trim() || null,
    size: variant.size.trim() || null,
    color: variant.color.trim() || null,
    attributes: parseVariantAttributes(variant.attributesText),
    costPrice: variant.costPrice === null ? null : fromCents(variant.costPrice),
    weightGrams: variant.weightGrams,
    dimensionsCm: variantDimensions(variant),
    active: variant.active,
  };
}

function generatedSku(base: string, option: string, used: string[]): string {
  const normalize = (value: string) => value.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const root = normalize([base, option].filter(Boolean).join("-")) || "SKU";
  const collides = (value: string) => used.some(item => item.trim().toLocaleLowerCase("pt-BR") === value.toLocaleLowerCase("pt-BR"));
  let candidate = root.slice(0, 80);
  let suffix = 2;
  while (collides(candidate)) {
    const ending = `-${suffix++}`;
    candidate = `${root.slice(0, 80 - ending.length)}${ending}`;
  }
  return candidate;
}
const categoryFormSchema = z.object({
  name: z.string().trim().min(2, "Informe pelo menos 2 caracteres.").max(80, "Use até 80 caracteres."),
  description: z.string().max(400, "Use até 400 caracteres."),
  iconName: z.enum(["shopping-bag", "shirt", "coffee", "headphones", "backpack", "gift", "disc", "tag"]),
});
type CategoryFormValues = z.infer<typeof categoryFormSchema>;
const lineFormSchema = z.object({
  name: z.string().trim().min(2, "Informe pelo menos 2 caracteres.").max(100, "Use até 100 caracteres."),
  description: z.string().max(1000, "Use até 1.000 caracteres."),
});
type LineFormValues = z.infer<typeof lineFormSchema>;

function getProductFormValues(product?: Product): ProductFormValues {
  if (!product) return { ...emptyProductFormValues, variants: emptyProductFormValues.variants.map(v => ({ ...v })) };
  return {
    name: product.name, description: product.description, images: productImages(product), galleryLayout: product.galleryLayout, categoryId: product.categoryId ?? "",
    lineId: product.lineId ?? "", baseSku: product.baseSku ?? "", internalCode: product.internalCode ?? "", pieceType: product.pieceType ?? "",
    brand: product.brand ?? "", material: product.material ?? "", ncmSuggestion: product.ncmSuggestion ?? "", tags: product.tags.join(", "),
    promotionalPrice: product.promotionalPrice == null ? null : toCents(product.promotionalPrice),
    promotionStartsAt: dateField(product.promotionStartsAt), promotionEndsAt: dateField(product.promotionEndsAt),
    featured: product.featured, status: product.status,
    variants: product.variants.map(v => ({
      id: v.id, name: v.name, sku: v.sku, price: toCents(v.price), stock: v.stock,
      lowStockThreshold: v.lowStockThreshold, barcode: v.barcode ?? "", size: v.size ?? "",
      color: v.color ?? "", attributesText: JSON.stringify(v.attributes ?? {}, null, 2),
      costPrice: v.costPrice == null ? null : toCents(v.costPrice), weightGrams: v.weightGrams ?? null,
      lengthCm: v.dimensionsCm?.length ?? null, widthCm: v.dimensionsCm?.width ?? null,
      heightCm: v.dimensionsCm?.height ?? null, active: v.active,
    })),
  };
}

export function AdminProductsCatalog() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const canCreateProduct = useCan("products:create");
  const canUpdateProduct = useCan("products:update");
  const canArchiveProduct = useCan("products:archive");
  const canManageCategories = useCan("categories:manage");
  const canManageLines = useCan("product_lines:manage");
  const productsQ = useListAdminProducts({ query: { queryKey: getListAdminProductsQueryKey(), retry: false } });
  const categoriesQ = useListAdminCategories({ query: { queryKey: getListAdminCategoriesQueryKey(), retry: false } });
  const linesQ = useListAdminProductLines({ query: { queryKey: getListAdminProductLinesQueryKey(), retry: false } });
  const products = productsQ.data ?? [];
  const categories = categoriesQ.data ?? [];
  const lines = linesQ.data ?? [];
  const [tab, setTab] = useState<Tab>("products");
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("q") ?? "");
  const [categoryFilter, setCategoryFilter] = useState(() => new URLSearchParams(window.location.search).get("category") ?? "");
  const [lineFilter, setLineFilter] = useState(() => new URLSearchParams(window.location.search).get("line") ?? "");
  const [statusFilter, setStatusFilter] = useState(() => new URLSearchParams(window.location.search).get("status") ?? "all");
  const [sortBy, setSortBy] = useState(() => new URLSearchParams(window.location.search).get("sort") ?? "name");
  const [sortDir, setSortDir] = useState(() => new URLSearchParams(window.location.search).get("dir") ?? "asc");
  const [page, setPage] = useState(() => Math.max(1, Number(new URLSearchParams(window.location.search).get("page")) || 1));
  const [selected, setSelected] = useState<string[]>([]);
  const [productDialog, setProductDialog] = useState<{ mode: "create" | "edit" | "view"; product?: Product } | null>(null);
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);
  const [categoryDialog, setCategoryDialog] = useState<AdminCategory | "new" | null>(null);
  const [lineDialog, setLineDialog] = useState<ProductLine | "new" | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<{ kind: "category" | "line"; id: string; name: string } | null>(null);
  const [reassignId, setReassignId] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const [uploading, setUploading] = useState(false);
  const create = useCreateProduct(); const update = useUpdateProduct(); const archive = useArchiveProduct();
  const bulk = useBulkUpdateProductStatus(); const createCategory = useCreateCategory(); const updateCategory = useUpdateCategory(); const deleteCategory = useDeleteCategory();
  const createLine = useCreateProductLine(); const updateLine = useUpdateProductLine(); const archiveLine = useArchiveProductLine();
  const createVariant = useCreateProductVariant(); const updateVariant = useUpdateProductVariant();
  const refresh = () => {
    [getListAdminProductsQueryKey(), getListAdminCategoriesQueryKey(), getListAdminProductLinesQueryKey(), getListProductsQueryKey(), getListCategoriesQueryKey(), getGetAdminSummaryQueryKey()]
      .forEach(queryKey => { void qc.invalidateQueries({ queryKey }); });
  };
  const setFilter = (key: string, value: string) => {
    const params = new URLSearchParams(window.location.search);
    if (value && !(key === "status" && value === "all")) params.set(key, value); else params.delete(key);
    if (key !== "page") params.delete("page");
    const query = params.toString();
    setLocation(`/admin/products${query ? `?${query}` : ""}`, { replace: true });
    if (key === "q") { setSearch(value); setPage(1); }
    if (key === "category") { setCategoryFilter(value); setPage(1); }
    if (key === "line") { setLineFilter(value); setPage(1); }
    if (key === "status") { setStatusFilter(value); setPage(1); }
    if (key === "sort") setSortBy(value);
    if (key === "dir") setSortDir(value);
    if (key === "page") setPage(Number(value) || 1);
  };
  const resetFilters = () => {
    setLocation("/admin/products", { replace: true });
    setSearch("");
    setCategoryFilter("");
    setLineFilter("");
    setStatusFilter("all");
    setSortBy("name");
    setSortDir("asc");
    setPage(1);
    setSelected([]);
  };
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("pt-BR");
    const found = products.filter(p => {
      const lineName = lines.find(line => line.id === p.lineId)?.name;
      const variantSkus = p.variants.map(variant => variant.sku).join(" ");
      const text = [p.name, p.description, p.baseSku, p.internalCode, p.categoryName, lineName, p.brand, p.tags.join(" "), variantSkus]
        .filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
      return (!needle || text.includes(needle)) && (!categoryFilter || p.categoryId === categoryFilter) &&
        (!lineFilter || p.lineId === lineFilter) && (statusFilter === "all" || (statusFilter === "active" ? p.active && p.status === "active" : statusFilter === "archived" ? !p.active : p.status === statusFilter));
    });
    return found.sort((a, b) => {
      const av = sortBy === "category" ? a.categoryName ?? "" : sortBy === "status" ? a.status : a.name;
      const bv = sortBy === "category" ? b.categoryName ?? "" : sortBy === "status" ? b.status : b.name;
      return av.localeCompare(bv, "pt-BR") * (sortDir === "desc" ? -1 : 1);
    });
  }, [products, lines, search, categoryFilter, lineFilter, statusFilter, sortBy, sortDir]);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize);

  const openProduct = (mode: "create" | "edit" | "view", product?: Product) => {
    setFeedback(null);
    setProductDialog({ mode, product });
    if (!product) { setDraft({ ...emptyDraft, variants: [...emptyDraft.variants.map(v => ({ ...v }))] }); return; }
    setDraft({
      name: product.name, description: product.description, imageUrl: primaryImageUrl(productImages(product)), categoryId: product.categoryId ?? "",
      lineId: product.lineId ?? "", baseSku: product.baseSku ?? "", internalCode: product.internalCode ?? "", pieceType: product.pieceType ?? "",
      brand: product.brand ?? "", material: product.material ?? "", ncmSuggestion: product.ncmSuggestion ?? "", tags: product.tags.join(", "), promotionalPrice: product.promotionalPrice == null ? null : toCents(product.promotionalPrice),
      promotionStartsAt: dateField(product.promotionStartsAt), promotionEndsAt: dateField(product.promotionEndsAt), featured: product.featured, status: product.status,
      variants: product.variants.map(v => ({
        id: v.id, name: v.name, sku: v.sku, price: toCents(v.price), stock: v.stock,
        lowStockThreshold: v.lowStockThreshold, barcode: v.barcode ?? "", size: v.size ?? "",
        color: v.color ?? "", attributesText: JSON.stringify(v.attributes ?? {}, null, 2),
        costPrice: v.costPrice == null ? null : toCents(v.costPrice), weightGrams: v.weightGrams ?? null,
        lengthCm: v.dimensionsCm?.length ?? null, widthCm: v.dimensionsCm?.width ?? null,
        heightCm: v.dimensionsCm?.height ?? null, active: v.active,
      })),
    });
  };
  const saveProduct = (values: ProductFormValues) => {
    if (productDialog?.mode === "view") return;
    setFeedback(null);
    const base = {
      name: values.name.trim(), description: values.description, imageUrl: primaryImageUrl(values.images) || null, categoryId: values.categoryId || null,
      lineId: values.lineId || null, baseSku: values.baseSku || null, internalCode: values.internalCode || null, pieceType: values.pieceType || null,
      brand: values.brand || null, material: values.material || null, ncmSuggestion: values.ncmSuggestion.trim() || null, tags: values.tags.split(",").map(t => t.trim()).filter(Boolean),
      promotionalPrice: values.promotionalPrice == null ? null : fromCents(values.promotionalPrice),
      promotionStartsAt: values.promotionStartsAt ? new Date(`${values.promotionStartsAt}T00:00:00`).toISOString() : null,
      promotionEndsAt: values.promotionEndsAt ? new Date(`${values.promotionEndsAt}T23:59:59`).toISOString() : null,
      featured: values.featured, status: values.status, galleryLayout: values.galleryLayout,
    };
    const variants: ProductVariantInput[] = values.variants.map(v => ({
      ...variantFields(v),
      stock: Number(v.stock),
    }));
    const complete = () => { refresh(); setProductDialog(null); setFeedback({ text: "Produto salvo e listas atualizadas.", kind: "success" }); };
    const images = orderedProductImages(values.images, values.name.trim());
    if (productDialog?.mode === "edit" && productDialog.product) {
      const p = productDialog.product;
      const data: ProductUpdate = { ...base, active: p.active, images };
      update.mutate({ productId: p.id, data }, { onSuccess: async () => {
        try {
          for (const v of values.variants) {
            if (v.id) await updateVariant.mutateAsync({ variantId: v.id, data: variantFields(v) });
            else await createVariant.mutateAsync({ productId: p.id, data: { ...variantFields(v), stock: Number(v.stock) } });
          }
          complete();
        } catch (e) { refresh(); setFeedback({ text: errorMessage(e), kind: "error" }); }
      }, onError: e => setFeedback({ text: errorMessage(e), kind: "error" }) });
    } else {
      const data: ProductInput = { ...base, featured: values.featured, status: values.status, variants, images };
      create.mutate({ data }, { onSuccess: complete, onError: e => setFeedback({ text: errorMessage(e), kind: "error" }) });
    }
  };
  const duplicate = (p: Product) => {
    const suffix = `COPY-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const withUniqueSuffix = (value: string | null | undefined) =>
      value ? `${value.slice(0, 80 - suffix.length - 1)}-${suffix}` : null;
    const input: ProductInput = {
      name: `${p.name} — cópia`, description: p.description, imageUrl: p.imageUrl, galleryLayout: p.galleryLayout, images: p.images.map(({ url, alt, sortOrder, isPrimary, isHover }) => ({ url, alt, sortOrder, isPrimary, isHover })),
      categoryId: p.categoryId, lineId: p.lineId, baseSku: withUniqueSuffix(p.baseSku), internalCode: withUniqueSuffix(p.internalCode),
      pieceType: p.pieceType, brand: p.brand, material: p.material, ncmSuggestion: p.ncmSuggestion, tags: p.tags, promotionalPrice: p.promotionalPrice,
      promotionStartsAt: p.promotionStartsAt, promotionEndsAt: p.promotionEndsAt, featured: false, status: "inactive",
      variants: p.variants.map(v => ({
        name: v.name, sku: withUniqueSuffix(v.sku)!, price: v.price, stock: 0,
        lowStockThreshold: v.lowStockThreshold, barcode: v.barcode, size: v.size, color: v.color,
        attributes: v.attributes, costPrice: v.costPrice, weightGrams: v.weightGrams,
        dimensionsCm: v.dimensionsCm, active: v.active,
      })),
    };
    create.mutate({ data: input }, { onSuccess: () => { refresh(); setFeedback({ text: "Cópia criada como inativa, sem alterar o estoque.", kind: "success" }); }, onError: e => setFeedback({ text: errorMessage(e), kind: "error" }) });
  };
  const bulkStatus = (status: ProductStatus) => bulk.mutate({ data: { productIds: selected, status } }, { onSuccess: r => { refresh(); setSelected([]); setFeedback({ text: `${r.updatedCount} produtos atualizados.`, kind: "success" }); }, onError: e => setFeedback({ text: errorMessage(e), kind: "error" }) });
  const toggleProduct = (p: Product) => {
    if (!p.active) update.mutate({ productId: p.id, data: { active: true, status: "active" } }, { onSuccess: () => { refresh(); setFeedback({ text: "Produto reativado.", kind: "success" }); }, onError: e => setFeedback({ text: errorMessage(e), kind: "error" }) });
    else if (window.confirm(`Arquivar “${p.name}”? O histórico de pedidos será preservado.`)) archive.mutate({ productId: p.id }, { onSuccess: () => { refresh(); setFeedback({ text: "Produto arquivado.", kind: "success" }); }, onError: e => setFeedback({ text: errorMessage(e), kind: "error" }) });
  };
  const categorySave = (values: CategoryFormValues) => {
    const data = { name: values.name, description: values.description || null, iconName: values.iconName as CategoryIcon };
    const target = categoryDialog;
    const done = () => { refresh(); setCategoryDialog(null); setFeedback({ text: "Categoria salva.", kind: "success" }); };
    if (target && target !== "new") updateCategory.mutate({ categoryId: target.id, data: { ...data, active: target.active } }, { onSuccess: done, onError: e => setFeedback({ text: errorMessage(e), kind: "error" }) });
    else createCategory.mutate({ data }, { onSuccess: done, onError: e => setFeedback({ text: errorMessage(e), kind: "error" }) });
  };
  const lineSave = (values: LineFormValues) => {
    const data: ProductLineInput = { name: values.name, description: values.description };
    const target = lineDialog; const done = () => { refresh(); setLineDialog(null); setFeedback({ text: "Linha de produtos salva.", kind: "success" }); };
    if (target && target !== "new") updateLine.mutate({ lineId: target.id, data: { ...data, active: target.active } }, { onSuccess: done, onError: e => setFeedback({ text: errorMessage(e), kind: "error" }) });
    else createLine.mutate({ data }, { onSuccess: done, onError: e => setFeedback({ text: errorMessage(e), kind: "error" }) });
  };
  const categoryArchive = (id: string, reassign?: string) => deleteCategory.mutate({ categoryId: id, ...(reassign ? { data: { reassignToCategoryId: reassign } } : {}) }, {
    onSuccess: () => { refresh(); setArchiveTarget(null); setReassignId(""); setFeedback({ text: "Categoria arquivada.", kind: "success" }); },
    onError: e => setFeedback({ text: errorMessage(e), kind: "error" }),
  });
  const lineArchive = (id: string, reassign?: string) => archiveLine.mutate({ lineId: id, ...(reassign ? { data: { reassignToLineId: reassign } } : {}) }, {
    onSuccess: () => { refresh(); setArchiveTarget(null); setReassignId(""); setFeedback({ text: "Linha arquivada.", kind: "success" }); },
    onError: e => setFeedback({ text: errorMessage(e), kind: "error" }),
  });

  if (productsQ.isLoading || categoriesQ.isLoading || linesQ.isLoading) return <div data-testid="catalog-loading"><Loading label="Carregando catálogo" /></div>;
  if (productsQ.isError || categoriesQ.isError || linesQ.isError) return <div data-testid="catalog-load-error"><ErrorState retry={() => { void productsQ.refetch(); void categoriesQ.refetch(); void linesQ.refetch(); }} message="Não foi possível carregar os dados do catálogo." /></div>;
  const pending = create.isPending || update.isPending || archive.isPending || bulk.isPending || createCategory.isPending || updateCategory.isPending || deleteCategory.isPending || createLine.isPending || updateLine.isPending || archiveLine.isPending || createVariant.isPending || updateVariant.isPending;
  return <div className="catalog-admin enter" data-testid="admin-product-catalog">
    <header className="catalog-heading">
      <div><div className="catalog-kicker">CATÁLOGO · RÁDIO 88 FM</div><h2 className="catalog-title">Produtos e organização</h2><p>Uma visão confiável do que está na loja — da ficha ao estoque.</p></div>
      <div className="catalog-totals"><div><strong data-testid="metric-products">{products.length}</strong><span>produtos</span></div><i /><div><strong>{categories.filter(c => c.active).length}</strong><span>categorias ativas</span></div><i /><div><strong>{lines.filter(l => l.active).length}</strong><span>linhas ativas</span></div></div>
    </header>
    {feedback && <div className="my-4" data-testid="catalog-feedback"><Notice text={feedback.text} kind={feedback.kind} /></div>}
    <div className="catalog-tabs" role="tablist" aria-label="Seções do catálogo">
      {([["products", "Produtos", products.length, Tag], ["categories", "Categorias", categories.length, ListFilter], ["lines", "Linhas de produto", lines.length, Layers3]] as const).map(([key, label, count, Icon]) =>
        <button role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setFeedback(null); }} className={`catalog-tab ${tab === key ? "is-active" : ""}`} key={key} data-testid={`tab-catalog-${key}`}><Icon size={16} />{label}<span>{count}</span></button>)}
    </div>
    {tab === "products" && <>
      <div className="catalog-toolbar">
        <label className="catalog-search"><Search size={17} /><input aria-label="Buscar produtos" placeholder="Buscar nome, SKU, marca..." value={search} onChange={e => setFilter("q", e.target.value)} data-testid="input-product-search" />{search && <button aria-label="Limpar busca" onClick={() => setFilter("q", "")} data-testid="button-clear-search"><X size={15} /></button>}</label>
        <select aria-label="Filtrar por categoria" value={categoryFilter} onChange={e => setFilter("category", e.target.value)} data-testid="select-filter-category"><option value="">Todas as categorias</option>{categories.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select>
        <select aria-label="Filtrar por linha" value={lineFilter} onChange={e => setFilter("line", e.target.value)} data-testid="select-filter-line"><option value="">Todas as linhas</option>{lines.map(l => <option value={l.id} key={l.id}>{l.name}</option>)}</select>
        <select aria-label="Filtrar por situação" value={statusFilter} onChange={e => setFilter("status", e.target.value)} data-testid="select-filter-status"><option value="all">Todas as situações</option><option value="active">Ativos</option><option value="hidden">Ocultos</option><option value="inactive">Inativos</option><option value="archived">Arquivados</option></select>
        <select aria-label="Ordenar produtos" value={sortBy} onChange={e => setFilter("sort", e.target.value)} data-testid="select-sort-products"><option value="name">Ordenar: nome</option><option value="category">Ordenar: categoria</option><option value="status">Ordenar: situação</option></select>
        {canCreateProduct && <button className="button catalog-add" onClick={() => openProduct("create")} data-testid="button-create-product"><Plus size={16} />Novo produto</button>}
      </div>
      {canUpdateProduct && selected.length > 0 && <div className="bulk-bar" data-testid="bulk-actions"><span><b>{selected.length}</b> selecionados</span><button disabled={bulk.isPending} onClick={() => bulkStatus("active")} data-testid="button-bulk-activate">Ativar</button><button disabled={bulk.isPending} onClick={() => bulkStatus("hidden")} data-testid="button-bulk-hide">Ocultar</button><button disabled={bulk.isPending} onClick={() => bulkStatus("inactive")} data-testid="button-bulk-inactivate">Inativar</button><button className="ml-auto" onClick={() => setSelected([])} data-testid="button-clear-selection">Limpar seleção</button></div>}
      <div className="catalog-table-wrap">
        <table className="catalog-table">
          <thead><tr>
            <th>{canUpdateProduct && <input aria-label="Selecionar todos nesta página" type="checkbox" checked={visible.length > 0 && visible.every((p) => selected.includes(p.id))} onChange={(event) => setSelected(event.target.checked ? visible.map((p) => p.id) : [])} data-testid="checkbox-select-page" />}</th>
            <th><button onClick={() => setFilter("dir", sortDir === "asc" ? "desc" : "asc")} className="sort-control" data-testid="button-sort-products">Produto {sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}</button></th>
            <th>Categoria / linha</th><th>Preço</th><th>Estoque</th><th>Situação</th><th aria-label="Ações" />
          </tr></thead>
          {/* The original header below is kept out of the rendered table during the permission refactor.
          <thead><tr><th>{canUpdateProduct && <input aria-label="Selecionar todos nesta página" type="checkbox" checked={visible.length > 0 && visible.every(p => selected.includes(p.id))} onChange={e => setSelected(e.target.checked ? Array.from(new Set([...selected, ...visible.map(p => p.id)])) : selected.filter(id => !visible.some(p => p.id === id)))} data-testid="checkbox-select-page" />}</th><th><button onClick={() => setFilter("dir", sortDir === "asc" ? "desc" : "asc")} className="sort-control" data-testid="button-sort-products">Produto {sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} /></button></th><th>Categoria / linha</th><th>Preço</th><th>Estoque</th><th>Situação</th><th aria-label="Ações" /></tr></thead>
          */}<tbody>{visible.map(p => {
            const lowest = p.variants.reduce((acc, v) => Math.min(acc, v.price), Infinity);
            const stock = p.variants.reduce((acc, v) => acc + v.stock, 0);
            return <tr key={p.id} data-testid={`row-product-${p.id}`}>
              <td>{canUpdateProduct && <input aria-label={`Selecionar ${p.name}`} type="checkbox" checked={selected.includes(p.id)} onChange={e => setSelected(e.target.checked ? [...selected, p.id] : selected.filter(id => id !== p.id))} data-testid={`checkbox-product-${p.id}`} />}</td>
              <td><button className="catalog-product" onClick={() => openProduct("view", p)} data-testid={`button-view-product-${p.id}`}><ProductImage src={p.imageUrl ?? undefined} name={p.name} /><span><b>{p.name}</b><small>{p.baseSku || p.internalCode || "Sem código"}{p.featured ? " · Destaque" : ""}</small></span></button></td>
              <td><b className="cell-main">{p.categoryName || "Sem categoria"}</b><small className="cell-sub">{lines.find(l => l.id === p.lineId)?.name ?? "Sem linha"}</small></td>
              <td><b className="cell-main">{Number.isFinite(lowest) ? money(lowest) : "—"}</b><small className="cell-sub">{p.variants.length} {p.variants.length === 1 ? "variante" : "variantes"}</small></td>
              <td><span className={stock <= p.variants.reduce((a,v)=>a+v.lowStockThreshold,0) ? "stock-low" : "cell-main"}>{stock} un.</span></td>
              <td><span className={`status-pill status-${p.status}`}>{!p.active ? "Arquivado" : p.status === "active" ? "Ativo" : p.status === "hidden" ? "Oculto" : "Inativo"}</span></td>
              <td><div className="row-actions">{canUpdateProduct && <button title="Editar produto" aria-label={`Editar ${p.name}`} onClick={() => openProduct("edit", p)} data-testid={`button-edit-product-${p.id}`}><Pencil size={15} /></button>}{canCreateProduct && <button title="Duplicar produto" aria-label={`Duplicar ${p.name}`} onClick={() => duplicate(p)} disabled={create.isPending} data-testid={`button-duplicate-product-${p.id}`}><Copy size={15} /></button>}{((p.active && canArchiveProduct) || (!p.active && canUpdateProduct)) && <button title={!p.active ? "Reativar produto" : "Arquivar produto"} aria-label={!p.active ? `Reativar ${p.name}` : `Arquivar ${p.name}`} onClick={() => toggleProduct(p)} disabled={archive.isPending || update.isPending} data-testid={`button-toggle-product-${p.id}`}><Archive size={15} /></button>}</div></td>
            </tr>;
          })}</tbody>
        </table>
         <div className="catalog-mobile-list" data-testid="mobile-product-list">{visible.map(p => {
           const lowest = p.variants.reduce((acc, variant) => Math.min(acc, variant.price), Infinity);
           const stock = p.variants.reduce((acc, variant) => acc + variant.stock, 0);
           const lowStock = stock <= p.variants.reduce((acc, variant) => acc + variant.lowStockThreshold, 0);
           const statusLabel = !p.active ? "Arquivado" : p.status === "active" ? "Ativo" : p.status === "hidden" ? "Oculto" : "Inativo";
           return <article className="catalog-mobile-card" key={p.id} data-testid={`mobile-card-product-${p.id}`}>
             <div className="catalog-mobile-card-main">
               <ProductImage src={p.imageUrl ?? undefined} name={p.name} className="catalog-mobile-photo" />
               <div className="catalog-mobile-card-copy">
                 <div className="catalog-mobile-card-title"><b>{p.name}</b><span className={`status-pill status-${p.status}`}>{statusLabel}</span></div>
                 <small>{p.baseSku || p.internalCode || "Sem código"}{p.featured ? " · Destaque" : ""}</small>
                 <p>{p.categoryName || "Sem categoria"} · {lines.find(line => line.id === p.lineId)?.name ?? "Sem linha"}</p>
                 <div className="catalog-mobile-card-metrics"><b>{Number.isFinite(lowest) ? money(lowest) : "—"}</b><span className={lowStock ? "stock-low" : ""}>{stock} un.</span><small>{p.variants.length} {p.variants.length === 1 ? "variante" : "variantes"}</small></div>
               </div>
             </div>
             <div className="catalog-mobile-card-actions">
               {canUpdateProduct && <label className="catalog-mobile-select"><input type="checkbox" aria-label={`Selecionar ${p.name}`} checked={selected.includes(p.id)} onChange={e => setSelected(e.target.checked ? [...selected, p.id] : selected.filter(id => id !== p.id))} data-testid={`checkbox-product-mobile-${p.id}`} /><span>Selecionar</span></label>}
               <div className="row-actions">{canUpdateProduct && <button title="Editar produto" aria-label={`Editar ${p.name}`} onClick={() => openProduct("edit", p)} data-testid={`button-edit-product-mobile-${p.id}`}><Pencil size={15} /></button>}{canCreateProduct && <button title="Duplicar produto" aria-label={`Duplicar ${p.name}`} onClick={() => duplicate(p)} disabled={create.isPending} data-testid={`button-duplicate-product-mobile-${p.id}`}><Copy size={15} /></button>}{((p.active && canArchiveProduct) || (!p.active && canUpdateProduct)) && <button title={!p.active ? "Reativar produto" : "Arquivar produto"} aria-label={!p.active ? `Reativar ${p.name}` : `Arquivar ${p.name}`} onClick={() => toggleProduct(p)} disabled={archive.isPending || update.isPending} data-testid={`button-toggle-product-mobile-${p.id}`}><Archive size={15} /></button>}</div>
             </div>
           </article>;
         })}</div>
         {!filtered.length && <div className="catalog-empty" data-testid="empty-products"><div className="empty-mark"><Tag size={19} /></div><h3>{products.length ? "Nenhum resultado para esses filtros" : "O catálogo começa aqui"}</h3><p>{products.length ? "Ajuste ou limpe os filtros para encontrar produtos." : "Cadastre o primeiro produto da loja para começar a organizar a vitrine."}</p>{products.length ? <button onClick={resetFilters} data-testid="button-reset-filters">Limpar filtros</button> : canCreateProduct && <button className="button" onClick={() => openProduct("create")} data-testid="button-empty-create-product"><Plus size={15} />Cadastrar produto</button>}</div>}
      </div>
      <footer className="catalog-pagination"><span data-testid="text-pagination-count">{filtered.length ? `${(Math.min(page, pageCount) - 1) * pageSize + 1}–${Math.min(page, pageCount) * pageSize} de ${filtered.length} produtos` : "0 produtos"}</span><div><button aria-label="Página anterior" disabled={page <= 1} onClick={() => setFilter("page", String(page - 1))} data-testid="button-page-previous"><ChevronLeft size={16} /></button><span data-testid="text-page-number">{Math.min(page, pageCount)} / {pageCount}</span><button aria-label="Próxima página" disabled={page >= pageCount} onClick={() => setFilter("page", String(page + 1))} data-testid="button-page-next"><ChevronRight size={16} /></button></div></footer>
    </>}
     {tab === "categories" && <EntityList canManage={canManageCategories} title="Categorias" description="Organize os produtos por departamento da loja." onAdd={() => setCategoryDialog("new")} addLabel="Nova categoria" testId="categories" items={categories.map(c => ({ id: c.id, name: c.name, detail: c.slug, description: c.description || "", active: c.active }))} onEdit={id => setCategoryDialog(categories.find(c => c.id === id) ?? null)} onArchive={id => { const c = categories.find(x => x.id === id)!; setArchiveTarget({ kind: "category", id, name: c.name }); }} onToggle={c => updateCategory.mutate({ categoryId: c.id, data: { active: !c.active } }, { onSuccess: () => { refresh(); setFeedback({ text: c.active ? "Categoria desativada." : "Categoria reativada.", kind: "success" }); }, onError: e => setFeedback({ text: errorMessage(e), kind: "error" }) })} />}
     {tab === "lines" && <EntityList canManage={canManageLines} title="Linhas de produto" description="Agrupe coleções e identidades que atravessam categorias." onAdd={() => setLineDialog("new")} addLabel="Nova linha" testId="lines" items={lines.map(l => ({ id: l.id, name: l.name, detail: l.slug, description: l.description || "", active: l.active }))} onEdit={id => setLineDialog(lines.find(l => l.id === id) ?? null)} onArchive={id => { const l = lines.find(x => x.id === id)!; setArchiveTarget({ kind: "line", id, name: l.name }); }} onToggle={l => updateLine.mutate({ lineId: l.id, data: { active: !l.active } }, { onSuccess: () => { refresh(); setFeedback({ text: l.active ? "Linha desativada." : "Linha reativada.", kind: "success" }); }, onError: e => setFeedback({ text: errorMessage(e), kind: "error" }) })} />}

    {productDialog && <div className="catalog-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !pending) setProductDialog(null); }} data-testid="dialog-product-overlay"><section className="catalog-dialog catalog-product-dialog" role="dialog" aria-modal="true" aria-labelledby="product-dialog-title"><header><div><span className="catalog-kicker">{productDialog.mode === "create" ? "NOVO REGISTRO" : productDialog.mode === "view" ? "FICHA DO PRODUTO" : "EDIÇÃO DE CATÁLOGO"}</span><h2 id="product-dialog-title">{productDialog.mode === "create" ? "Adicionar produto" : productDialog.product?.name}</h2></div><button className="icon-button" aria-label="Fechar" onClick={() => setProductDialog(null)} data-testid="button-close-product-dialog"><X size={18} /></button></header>
       {productDialog.mode === "view" && <div className="product-view"><ProductImage src={draft.imageUrl || undefined} name={draft.name} /><div><h3>{draft.name}</h3><p>{draft.description || "Sem descrição."}</p><div className="view-meta"><span>{categories.find(c => c.id === draft.categoryId)?.name ?? "Sem categoria"}</span><span>{lines.find(l => l.id === draft.lineId)?.name ?? "Sem linha"}</span><span>{draft.status}</span></div></div><div className="variant-view">{draft.variants.map((v,i)=><div key={v.id || i}><span>{v.name}<small>{v.sku} · {v.active ? "Ativa" : "Inativa"}{v.size ? ` · ${v.size}` : ""}{v.color ? ` · ${v.color}` : ""}</small></span><b>{money(v.price)} · {v.stock} disponíveis</b></div>)}</div>{canUpdateProduct && <button className="button" onClick={() => productDialog.product && openProduct("edit", productDialog.product)} data-testid="button-view-edit-product"><Pencil size={15} />Editar ficha</button>}</div>}
      {productDialog.mode !== "view" && <ProductEditorForm
        key={`${productDialog.mode}-${productDialog.product?.id ?? "new"}`}
        product={productDialog.product}
        mode={productDialog.mode}
        canAddVariant={canCreateProduct}
        categories={categories}
        lines={lines}
        pending={pending}
        uploading={uploading}
        onUploadingChange={setUploading}
        onClose={() => setProductDialog(null)}
        onSave={saveProduct}
      />}
    </section></div>}

    {categoryDialog && <CategoryEditorForm key={categoryDialog === "new" ? "category-new" : `category-${categoryDialog.id}`} category={categoryDialog === "new" ? undefined : categoryDialog} pending={createCategory.isPending || updateCategory.isPending} onSave={categorySave} onClose={() => setCategoryDialog(null)} />}
    {lineDialog && <ProductLineEditorForm key={lineDialog === "new" ? "line-new" : `line-${lineDialog.id}`} line={lineDialog === "new" ? undefined : lineDialog} pending={createLine.isPending || updateLine.isPending} onSave={lineSave} onClose={() => setLineDialog(null)} />}
    {archiveTarget && <div className="catalog-overlay" role="presentation" data-testid="dialog-archive-entity"><section className="catalog-dialog entity-dialog"><header><div><span className="catalog-kicker">ARQUIVAR REGISTRO</span><h2>{archiveTarget.name}</h2></div><button className="icon-button" aria-label="Fechar" onClick={() => { setArchiveTarget(null); setReassignId(""); }} data-testid="button-close-archive-dialog"><X size={18} /></button></header><p className="text-sm text-muted-foreground">Se houver produtos vinculados, escolha um destino ativo para transferi-los antes de tentar arquivar novamente.</p><label>Reatribuir produtos para<select className="field" value={reassignId} onChange={e => setReassignId(e.target.value)} data-testid="select-reassignment-target"><option value="">Sem reatribuição</option>{(archiveTarget.kind === "category" ? categories.filter(c => c.active && c.id !== archiveTarget.id) : lines.filter(l => l.active && l.id !== archiveTarget.id)).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>{feedback?.kind === "error" && <Notice text={feedback.text} />}<footer className="dialog-actions"><button className="button button-outline" onClick={() => setArchiveTarget(null)} data-testid="button-cancel-archive">Cancelar</button><button className="button" disabled={deleteCategory.isPending || archiveLine.isPending} onClick={() => archiveTarget.kind === "category" ? categoryArchive(archiveTarget.id, reassignId || undefined) : lineArchive(archiveTarget.id, reassignId || undefined)} data-testid="button-confirm-archive-entity">{deleteCategory.isPending || archiveLine.isPending ? "Arquivando…" : "Arquivar"}</button></footer></section></div>}
    {pending && <div className="catalog-saving" role="status" data-testid="status-saving"><span /> Atualizando catálogo…</div>}
  </div>;
}

function ProductEditorForm({ product, mode, canAddVariant, categories, lines, pending, uploading, onUploadingChange, onClose, onSave }: {
  product?: Product;
  mode: "create" | "edit";
  canAddVariant: boolean;
  categories: AdminCategory[];
  lines: ProductLine[];
  pending: boolean;
  uploading: boolean;
  onUploadingChange: (value: boolean) => void;
  onClose: () => void;
  onSave: (values: ProductFormValues) => void;
}) {
  const form = useForm<ProductFormValues>({ resolver: zodResolver(productFormSchema), defaultValues: getProductFormValues(product) });
  const variants = useFieldArray({ control: form.control, name: "variants", keyName: "fieldKey" });
  const images = useFieldArray({ control: form.control, name: "images", keyName: "imageFieldKey" });
  const galleryLayout = form.watch("galleryLayout");
  const previewImages = form.watch("images");
  const previewCover = previewImages.find(image => image.isPrimary)?.url ?? previewImages[0]?.url;
  const previewHover = previewImages.find(image => image.isHover)?.url;
  const previewName = form.watch("name");
  useEffect(() => { form.reset(getProductFormValues(product)); }, [product?.id, mode, form.reset]);
  const addVariant = () => variants.append({ ...emptyVariant(), name: "", stock: 0 });
  const generateVariantSku = (index: number) => {
    const values = form.getValues();
    const variant = values.variants[index];
    if (!variant) return;
    const base = values.baseSku.trim() || values.name.trim() || variant.name.trim();
    const option = [variant.size, variant.color].map(value => value.trim()).filter(Boolean).join("-") || `OPCAO-${index + 1}`;
    const used = values.variants.filter((_, otherIndex) => otherIndex !== index).map(item => item.sku);
    form.setValue(`variants.${index}.sku`, generatedSku(base, option, used), { shouldDirty: true, shouldValidate: true });
  };
  return <Form {...form}>
    <form onSubmit={form.handleSubmit(onSave)} className="catalog-form">
      <div className="form-columns">
        <FormField control={form.control} name="name" render={({ field }) => <FormItem><FormLabel>Nome do produto</FormLabel><FormControl><input className="field" {...field} maxLength={160} data-testid="input-product-name" /></FormControl><FormMessage /></FormItem>} />
        <FormField control={form.control} name="categoryId" render={({ field }) => <FormItem><FormLabel>Categoria</FormLabel><FormControl><select className="field" {...field} data-testid="select-product-category"><option value="">Sem categoria</option>{categories.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></FormControl><FormMessage /></FormItem>} />
        <FormField control={form.control} name="lineId" render={({ field }) => <FormItem><FormLabel>Linha de produto</FormLabel><FormControl><select className="field" {...field} data-testid="select-product-line"><option value="">Sem linha</option>{lines.filter(l => l.active).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></FormControl><FormMessage /></FormItem>} />
        <FormField control={form.control} name="baseSku" render={({ field }) => <FormItem><FormLabel>SKU base</FormLabel><FormControl><input className="field" {...field} data-testid="input-product-base-sku" /></FormControl><FormMessage /></FormItem>} />
        <FormField control={form.control} name="internalCode" render={({ field }) => <FormItem><FormLabel>Código interno</FormLabel><FormControl><input className="field" {...field} data-testid="input-product-internal-code" /></FormControl><FormMessage /></FormItem>} />
        <FormField control={form.control} name="brand" render={({ field }) => <FormItem><FormLabel>Marca</FormLabel><FormControl><input className="field" {...field} data-testid="input-product-brand" /></FormControl><FormMessage /></FormItem>} />
        <FormField control={form.control} name="pieceType" render={({ field }) => <FormItem><FormLabel>Tipo de peça</FormLabel><FormControl><input className="field" {...field} data-testid="input-product-piece-type" /></FormControl><FormMessage /></FormItem>} />
        <FormField control={form.control} name="material" render={({ field }) => <FormItem><FormLabel>Material</FormLabel><FormControl><input className="field" {...field} data-testid="input-product-material" /></FormControl><FormMessage /></FormItem>} />
        <FormField control={form.control} name="ncmSuggestion" render={({ field }) => <FormItem><FormLabel>NCM preliminar (8 dígitos)</FormLabel><FormControl><input className="field" {...field} inputMode="numeric" maxLength={8} placeholder="Ex.: 61091000" data-testid="input-product-ncm-suggestion" /></FormControl><p className="text-xs text-muted-foreground">Referência de classificação; não completa o perfil fiscal nem autoriza emissão de nota.</p><FormMessage /></FormItem>} />
      </div>
      <FormField control={form.control} name="description" render={({ field }) => <FormItem><FormLabel>Descrição</FormLabel><FormControl><textarea className="field min-h-20" {...field} maxLength={5000} data-testid="input-product-description" /></FormControl><FormMessage /></FormItem>} />
      <FormField control={form.control} name="tags" render={({ field }) => <FormItem><FormLabel>Tags <span className="font-normal text-muted-foreground">separadas por vírgula</span></FormLabel><FormControl><input className="field" {...field} data-testid="input-product-tags" /></FormControl><FormMessage /></FormItem>} />
      <div className="form-columns">
        <FormField control={form.control} name="promotionalPrice" render={({ field }) => <FormItem><FormLabel>Preço promocional</FormLabel><FormControl><CurrencyInput value={field.value ?? 0} onChange={value => field.onChange(value || null)} data-testid="input-product-promo-price" /></FormControl><FormMessage /></FormItem>} />
        <FormField control={form.control} name="promotionStartsAt" render={({ field }) => <FormItem><FormLabel>Início da promoção</FormLabel><FormControl><input type="date" className="field" {...field} data-testid="input-promotion-start" /></FormControl><FormMessage /></FormItem>} />
        <FormField control={form.control} name="promotionEndsAt" render={({ field }) => <FormItem><FormLabel>Fim da promoção</FormLabel><FormControl><input type="date" className="field" {...field} data-testid="input-promotion-end" /></FormControl><FormMessage /></FormItem>} />
        <FormField control={form.control} name="status" render={({ field }) => <FormItem><FormLabel>Situação</FormLabel><FormControl><select className="field" {...field} data-testid="select-product-status"><option value="active">Ativo</option><option value="hidden">Oculto</option><option value="inactive">Inativo</option></select></FormControl><FormMessage /></FormItem>} />
      </div>
      <FormField control={form.control} name="featured" render={({ field }) => <FormItem className="flex items-center gap-2 text-sm"><FormControl><input type="checkbox" checked={field.value} onChange={field.onChange} ref={field.ref} name={field.name} onBlur={field.onBlur} data-testid="checkbox-product-featured" /></FormControl><FormLabel className="mb-0">Destacar na vitrine</FormLabel><FormMessage /></FormItem>} />
      <FormField control={form.control} name="galleryLayout" render={({ field }) => <FormItem><FormLabel>Formato da galeria do produto</FormLabel><FormControl><select className="field" {...field} data-testid="select-product-gallery-layout"><option value="square">Quadrado · 1:1</option><option value="portrait">Retrato · 3:4</option></select></FormControl><p className="text-xs text-muted-foreground">A vitrine continua quadrada. Este formato é usado na página do produto.</p><FormMessage /></FormItem>} />
      <FormField control={form.control} name="images" render={({ field }) => <FormItem className="product-gallery-field">
        <div className="product-gallery-heading"><div><FormLabel className="inline-flex items-center gap-1.5"><ImagePlus size={15} />Galeria de fotos</FormLabel><p>Inclua fotos do produto e do mostruário. Escolha uma capa e uma foto para o hover do card.</p></div><span data-testid="text-product-image-count">{field.value.length}/5 fotos</span></div>
        <FormControl><ImageUploadField
          value=""
          onChange={url => {
            if (field.value.length >= 5) return;
            images.append({ url, alt: form.getValues("name").trim(), sortOrder: field.value.length, isPrimary: field.value.length === 0, isHover: false });
          }}
          onUploadingChange={onUploadingChange}
          disabled={pending || uploading || field.value.length >= 5}
          label={field.value.length >= 5 ? "Limite de fotos atingido" : "Adicionar foto"}
        /></FormControl>
        {field.value.length > 0 && <div className="product-image-grid">{images.fields.map((item, index) => {
          const photo = field.value[index];
          if (!photo) return null;
          return <article className={`product-image-card ${photo.isPrimary ? "is-cover" : ""}`} key={item.imageFieldKey} data-testid={`card-product-image-${index}`}>
            <img src={photo.url} alt={photo.alt || `Foto ${index + 1} de ${form.getValues("name")}`} loading="lazy" />
            <div className="product-image-card-meta">
              <div className="product-image-badges">
                <span className={photo.isPrimary ? "product-cover-badge" : "product-extra-badge"}>
                  {photo.isPrimary ? <><Check size={12} />Capa</> : `Foto ${index + 1}`}
                </span>
                {photo.isHover && <span className="product-hover-badge"><Check size={12} />Hover do card</span>}
              </div>
              <div className="product-image-actions">
                {!photo.isPrimary && <button type="button" onClick={() => {
                  field.value.forEach((image, imageIndex) => images.update(imageIndex, { ...image, isPrimary: imageIndex === index }));
                }} aria-label={`Definir foto ${index + 1} como capa`} data-testid={`button-set-cover-${index}`}>Usar como capa</button>}
                {photo.isHover
                  ? <button type="button" onClick={() => images.update(index, { ...photo, isHover: false })} aria-label={`Remover foto ${index + 1} do hover`} data-testid={`button-clear-hover-${index}`}>Remover hover</button>
                  : <button type="button" onClick={() => field.value.forEach((image, imageIndex) => images.update(imageIndex, { ...image, isHover: imageIndex === index }))} aria-label={`Usar foto ${index + 1} no hover`} data-testid={`button-set-hover-${index}`}>Usar no hover</button>}
                <button type="button" disabled={index === 0} onClick={() => images.move(index, index - 1)} aria-label={`Mover foto ${index + 1} para cima`} data-testid={`button-move-image-up-${index}`}><ArrowUp size={14} /></button>
                <button type="button" disabled={index === field.value.length - 1} onClick={() => images.move(index, index + 1)} aria-label={`Mover foto ${index + 1} para baixo`} data-testid={`button-move-image-down-${index}`}><ArrowDown size={14} /></button>
                <button type="button" onClick={() => images.remove(index)} aria-label={`Remover foto ${index + 1}`} data-testid={`button-remove-image-${index}`}><X size={14} /></button>
              </div>
            </div>
            <label className="product-image-alt">Descrição da foto<input
              className="field"
              maxLength={240}
              value={photo.alt}
              onChange={event => images.update(index, { ...photo, alt: event.target.value })}
              aria-label={`Descrição da foto ${index + 1}`}
              data-testid={`input-image-alt-${index}`}
            /></label>
          </article>;
        })}</div>}
        <div className="product-gallery-preview" data-testid="preview-product-gallery">
          <div className="product-gallery-preview-copy"><b>Prévia de apresentação</b><span>A foto de hover aparece ao passar o cursor. Em toque, a capa abre o produto.</span></div>
          <div className="product-gallery-preview-grid">
            <div><small>Vitrine · 1:1</small><div className="product-gallery-preview-square">
              {previewCover ? <img src={previewCover} alt="" /> : <span>Escolha uma capa</span>}
              {previewHover && <img className="product-gallery-preview-hover" src={previewHover} alt="" />}
            </div><strong>{previewName || "Nome do produto"}</strong></div>
            <div><small>Detalhe · {galleryLayout === "portrait" ? "3:4" : "1:1"}</small><div className={`product-gallery-preview-detail ${galleryLayout}`}>
              {previewCover ? <img src={previewCover} alt="" /> : <span>Escolha uma capa</span>}
            </div></div>
          </div>
        </div>
        {field.value.length > 5 && <p className="product-gallery-warning" role="status" data-testid="text-legacy-image-warning">Este produto já tem {field.value.length} fotos. Remova as excedentes para salvar com o novo limite; nenhuma será removida automaticamente.</p>}
        <FormMessage />
      </FormItem>} />
       <div className="variant-editor"><div className="flex items-center justify-between"><div><b>Variações e preços</b><p>O estoque inicial só é definido ao criar; depois, os ajustes são feitos em Estoque. A promoção acima é do produto e vale para todas as opções sem elevar preços menores.</p></div>{canAddVariant && <button type="button" className="small-action" onClick={addVariant} data-testid="button-add-variant"><Plus size={14} />Adicionar</button>}</div>
        {variants.fields.map((variant, index) => <div className="variant-row" key={variant.fieldKey}>
          <div className="variant-fields">
          <FormField control={form.control} name={`variants.${index}.name`} render={({ field }) => <FormItem><FormLabel>Nome</FormLabel><FormControl><input className="field" {...field} data-testid={`input-variant-name-${index}`} /></FormControl><FormMessage /></FormItem>} />
          <FormField control={form.control} name={`variants.${index}.sku`} render={({ field }) => <FormItem><FormLabel>SKU</FormLabel><FormControl><div className="variant-sku-control"><input className="field" {...field} data-testid={`input-variant-sku-${index}`} /><button type="button" className="small-action" onClick={() => generateVariantSku(index)} data-testid={`button-generate-variant-sku-${index}`}>Gerar</button></div></FormControl><FormMessage /></FormItem>} />
          <FormField control={form.control} name={`variants.${index}.price`} render={({ field }) => <FormItem><FormLabel>Preço</FormLabel><FormControl><CurrencyInput value={field.value} onChange={field.onChange} data-testid={`input-variant-price-${index}`} /></FormControl><FormMessage /></FormItem>} />
          {!variant.id && <FormField control={form.control} name={`variants.${index}.stock`} render={({ field }) => <FormItem><FormLabel>Estoque inicial</FormLabel><FormControl><input type="number" min="0" className="field" value={field.value} onChange={e => field.onChange(Number(e.target.value))} onBlur={field.onBlur} name={field.name} ref={field.ref} data-testid={`input-variant-stock-${index}`} /></FormControl><FormMessage /></FormItem>} />}
          <FormField control={form.control} name={`variants.${index}.lowStockThreshold`} render={({ field }) => <FormItem><FormLabel>Limite baixo</FormLabel><FormControl><input type="number" min="0" className="field" value={field.value} onChange={e => field.onChange(Number(e.target.value))} onBlur={field.onBlur} name={field.name} ref={field.ref} data-testid={`input-variant-threshold-${index}`} /></FormControl><FormMessage /></FormItem>} />
          <FormField control={form.control} name={`variants.${index}.active`} render={({ field }) => <FormItem className="variant-active-field"><FormControl><input type="checkbox" checked={field.value} onChange={field.onChange} onBlur={field.onBlur} ref={field.ref} name={field.name} data-testid={`checkbox-variant-active-${index}`} /></FormControl><FormLabel>Ativa na vitrine</FormLabel><FormMessage /></FormItem>} />
          {variants.fields.length > 1 && !variant.id && <button type="button" className="variant-remove" aria-label={`Remover variação ${index + 1}`} onClick={() => variants.remove(index)} data-testid={`button-remove-variant-${index}`}><X size={14} /></button>}
          </div>
          <div className="variant-detail-fields">
            <FormField control={form.control} name={`variants.${index}.barcode`} render={({ field }) => <FormItem><FormLabel>Código de barras</FormLabel><FormControl><input className="field" {...field} maxLength={80} data-testid={`input-variant-barcode-${index}`} /></FormControl><FormMessage /></FormItem>} />
            <FormField control={form.control} name={`variants.${index}.size`} render={({ field }) => <FormItem><FormLabel>Tamanho</FormLabel><FormControl><input className="field" {...field} maxLength={40} data-testid={`input-variant-size-${index}`} /></FormControl><FormMessage /></FormItem>} />
            <FormField control={form.control} name={`variants.${index}.color`} render={({ field }) => <FormItem><FormLabel>Cor</FormLabel><FormControl><input className="field" {...field} maxLength={60} data-testid={`input-variant-color-${index}`} /></FormControl><FormMessage /></FormItem>} />
            <FormField control={form.control} name={`variants.${index}.costPrice`} render={({ field }) => <FormItem><FormLabel>Custo</FormLabel><FormControl><CurrencyInput value={field.value ?? 0} onChange={value => field.onChange(value || null)} data-testid={`input-variant-cost-${index}`} /></FormControl><FormMessage /></FormItem>} />
            <FormField control={form.control} name={`variants.${index}.weightGrams`} render={({ field }) => <FormItem><FormLabel>Peso (kg)</FormLabel><FormControl><input type="number" min="0" step="0.001" className="field" value={field.value == null ? "" : field.value / 1000} onChange={e => field.onChange(e.target.value === "" ? null : Math.round(Number(e.target.value) * 1000))} data-testid={`input-variant-weight-${index}`} /></FormControl><FormMessage /></FormItem>} />
            {(["lengthCm", "widthCm", "heightCm"] as const).map((dimension, dimensionIndex) => <FormField key={dimension} control={form.control} name={`variants.${index}.${dimension}`} render={({ field }) => <FormItem><FormLabel>{["Comprimento", "Largura", "Altura"][dimensionIndex]} (cm)</FormLabel><FormControl><input type="number" min="0" step="0.1" className="field" value={field.value ?? ""} onChange={e => field.onChange(e.target.value === "" ? null : Number(e.target.value))} data-testid={`input-variant-${dimension}-${index}`} /></FormControl><FormMessage /></FormItem>} />)}
            <FormField control={form.control} name={`variants.${index}.attributesText`} render={({ field }) => <FormItem className="variant-attributes-field"><FormLabel>Atributos adicionais (JSON)</FormLabel><FormControl><textarea className="field min-h-16" {...field} placeholder={'{"estampa":"logo 88"}'} data-testid={`input-variant-attributes-${index}`} /></FormControl><FormMessage /></FormItem>} />
          </div>
        </div>)}
        <FormField control={form.control} name="variants" render={() => <FormItem><FormMessage /></FormItem>} />
      </div>
      <footer className="dialog-actions"><button type="button" className="button button-outline" onClick={onClose} data-testid="button-cancel-product">Cancelar</button><button type="submit" className="button" disabled={pending || uploading} data-testid="button-save-product">{pending ? "Salvando…" : uploading ? "Aguarde o envio…" : mode === "create" ? "Criar produto" : "Salvar alterações"}</button></footer>
    </form>
  </Form>;
}

function CategoryEditorForm({ category, pending, onSave, onClose }: {
  category?: AdminCategory; pending: boolean; onSave: (values: CategoryFormValues) => void; onClose: () => void;
}) {
  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: { name: category?.name ?? "", description: category?.description ?? "", iconName: category?.iconName ?? "tag" },
  });
  useEffect(() => { form.reset({ name: category?.name ?? "", description: category?.description ?? "", iconName: category?.iconName ?? "tag" }); }, [category?.id, form.reset]);
  return <div className="catalog-overlay" role="presentation" data-testid="dialog-category-overlay"><Form {...form}><form className="catalog-dialog entity-dialog" onSubmit={form.handleSubmit(onSave)}><header><div><span className="catalog-kicker">ORGANIZAÇÃO</span><h2>{category ? `Editar ${category.name}` : "Nova categoria"}</h2></div><button type="button" className="icon-button" aria-label="Fechar" onClick={onClose} data-testid="button-close-category-dialog"><X size={18} /></button></header>
    <FormField control={form.control} name="name" render={({ field }) => <FormItem><FormLabel>Nome</FormLabel><FormControl><input className="field" {...field} maxLength={80} data-testid="input-category-name" /></FormControl><FormMessage /></FormItem>} />
    <FormField control={form.control} name="description" render={({ field }) => <FormItem><FormLabel>Descrição</FormLabel><FormControl><textarea className="field min-h-20" {...field} maxLength={400} data-testid="input-category-description" /></FormControl><FormMessage /></FormItem>} />
    <FormField control={form.control} name="iconName" render={({ field }) => <FormItem><FormLabel>Ícone</FormLabel><FormControl><select className="field" {...field} data-testid="select-category-icon">{iconOptions.map(icon => <option value={icon} key={icon}>{icon}</option>)}</select></FormControl><FormMessage /></FormItem>} />
    <footer className="dialog-actions"><button type="button" className="button button-outline" onClick={onClose} data-testid="button-cancel-category">Cancelar</button><button className="button" disabled={pending} data-testid="button-save-category">{pending ? "Salvando…" : "Salvar categoria"}</button></footer>
  </form></Form></div>;
}

function ProductLineEditorForm({ line, pending, onSave, onClose }: {
  line?: ProductLine; pending: boolean; onSave: (values: LineFormValues) => void; onClose: () => void;
}) {
  const form = useForm<LineFormValues>({
    resolver: zodResolver(lineFormSchema),
    defaultValues: { name: line?.name ?? "", description: line?.description ?? "" },
  });
  useEffect(() => { form.reset({ name: line?.name ?? "", description: line?.description ?? "" }); }, [line?.id, form.reset]);
  return <div className="catalog-overlay" role="presentation" data-testid="dialog-line-overlay"><Form {...form}><form className="catalog-dialog entity-dialog" onSubmit={form.handleSubmit(onSave)}><header><div><span className="catalog-kicker">IDENTIDADE DE PRODUTO</span><h2>{line ? `Editar ${line.name}` : "Nova linha"}</h2></div><button type="button" className="icon-button" aria-label="Fechar" onClick={onClose} data-testid="button-close-line-dialog"><X size={18} /></button></header>
    <FormField control={form.control} name="name" render={({ field }) => <FormItem><FormLabel>Nome</FormLabel><FormControl><input className="field" {...field} maxLength={100} data-testid="input-line-name" /></FormControl><FormMessage /></FormItem>} />
    <FormField control={form.control} name="description" render={({ field }) => <FormItem><FormLabel>Descrição</FormLabel><FormControl><textarea className="field min-h-24" {...field} maxLength={1000} data-testid="input-line-description" /></FormControl><FormMessage /></FormItem>} />
    <footer className="dialog-actions"><button type="button" className="button button-outline" onClick={onClose} data-testid="button-cancel-line">Cancelar</button><button className="button" disabled={pending} data-testid="button-save-line">{pending ? "Salvando…" : "Salvar linha"}</button></footer>
  </form></Form></div>;
}

function EntityList({ canManage, title, description, addLabel, testId, items, onAdd, onEdit, onArchive, onToggle }: {
  canManage: boolean; title: string; description: string; addLabel: string; testId: string;
  items: Array<{ id: string; name: string; detail: string; description: string; active: boolean }>;
  onAdd: () => void; onEdit: (id: string) => void; onArchive: (id: string) => void; onToggle: (item: { id: string; name: string; active: boolean }) => void;
}) {
  return <section className="entity-panel" data-testid={`panel-${testId}`}><fieldset disabled={!canManage} className="contents"><header className="entity-heading"><div><h3>{title}</h3><p>{description}</p></div><button className="button" onClick={onAdd} data-testid={`button-create-${testId}`}><Plus size={15} />{addLabel}</button></header>
    {!items.length ? <div className="catalog-empty compact" data-testid={`empty-${testId}`}><div className="empty-mark"><Layers3 size={18} /></div><h3>Nenhum registro ainda</h3><p>Adicione o primeiro item para manter o catálogo organizado.</p></div> :
      <div className="entity-list">{items.map(item => <article key={item.id} data-testid={`card-${testId}-${item.id}`}><div className="entity-symbol">{testId === "categories" ? <Tag size={17} /> : <Layers3 size={17} />}</div><div className="entity-copy"><div><b>{item.name}</b><span className={`status-pill ${item.active ? "status-active" : "status-inactive"}`}>{item.active ? "Ativa" : "Arquivada"}</span></div><small>{item.detail}</small><p>{item.description || "Sem descrição informada."}</p></div><div className="entity-actions"><button onClick={() => onEdit(item.id)} data-testid={`button-edit-${testId}-${item.id}`}><Pencil size={14} />Editar</button><button onClick={() => onToggle(item)} data-testid={`button-toggle-${testId}-${item.id}`}>{item.active ? "Desativar" : "Reativar"}</button>{item.active && <button onClick={() => onArchive(item.id)} data-testid={`button-archive-${testId}-${item.id}`}><Archive size={14} />Arquivar</button>}</div></article>)}</div>}
    </fieldset>{!canManage && <p className="mt-3 text-xs text-muted-foreground">Acesso somente para consulta.</p>}</section>;
}
