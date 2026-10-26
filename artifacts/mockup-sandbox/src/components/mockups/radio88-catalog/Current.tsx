import "./_group.css";
import { useMemo, useState } from "react";
import { Archive, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, Layers3, ListFilter, Pencil, Plus, Search, Shirt, Tag, X } from "lucide-react";
import { CatalogProduct, formatBRL, initialCategories, initialLines, initialProducts, isLowStock, statusLabel } from "./data";

type Tab = "products" | "categories" | "lines";
type Editor = { type: "product" | "category" | "line"; mode: "new" | "edit" | "view"; id?: string } | null;

export function Current() {
  const [tab, setTab] = useState<Tab>("products");
  const [products, setProducts] = useState(initialProducts);
  const [categories, setCategories] = useState(initialCategories);
  const [lines, setLines] = useState(initialLines);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [lineFilter, setLineFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<string[]>([]);
  const [editor, setEditor] = useState<Editor>(null);
  const [page, setPage] = useState(1);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("pt-BR");
    return products.filter((product) => {
      const text = [product.name, product.description, product.baseSku, product.internalCode, product.categoryName, product.lineName, product.brand, product.tags.join(" "), ...product.variants.map((variant) => variant.sku)]
        .join(" ").toLocaleLowerCase("pt-BR");
      const statusMatches = statusFilter === "all" ||
        (statusFilter === "active" ? product.active && product.status === "active" :
          statusFilter === "archived" ? !product.active : product.status === statusFilter);
      return (!needle || text.includes(needle)) && (!categoryFilter || product.categoryId === categoryFilter) &&
        (!lineFilter || product.lineId === lineFilter) && statusMatches;
    }).sort((a, b) => {
      const av = sortBy === "category" ? a.categoryName : sortBy === "status" ? a.status : a.name;
      const bv = sortBy === "category" ? b.categoryName : sortBy === "status" ? b.status : b.name;
      return av.localeCompare(bv, "pt-BR") * (sortDir === "desc" ? -1 : 1);
    });
  }, [products, search, categoryFilter, lineFilter, statusFilter, sortBy, sortDir]);

  const openEditor = (next: Editor) => {
    setEditor(next);
    const product = next?.type === "product" ? products.find((item) => item.id === next.id) : undefined;
    const category = next?.type === "category" ? categories.find((item) => item.id === next.id) : undefined;
    const line = next?.type === "line" ? lines.find((item) => item.id === next.id) : undefined;
    setDraftName(product?.name ?? category?.name ?? line?.name ?? "");
    setDraftDescription(product?.description ?? category?.description ?? "");
  };

  const saveEditor = () => {
    if (!editor || !draftName.trim()) return;
    if (editor.type === "category") {
      if (editor.mode === "edit" && editor.id) {
        setCategories((items) => items.map((item) => item.id === editor.id ? { ...item, name: draftName.trim(), description: draftDescription } : item));
      } else {
        const id = `cat-${Date.now()}`;
        setCategories((items) => [...items, { id, name: draftName.trim(), slug: draftName.trim().toLowerCase().replaceAll(" ", "-"), description: draftDescription, active: true }]);
      }
    } else if (editor.type === "line") {
      if (editor.mode === "edit" && editor.id) setLines((items) => items.map((item) => item.id === editor.id ? { ...item, name: draftName.trim() } : item));
      else setLines((items) => [...items, { id: `line-${Date.now()}`, name: draftName.trim(), active: true }]);
    } else if (editor.mode === "edit" && editor.id) {
      setProducts((items) => items.map((item) => item.id === editor.id ? { ...item, name: draftName.trim(), description: draftDescription } : item));
    } else {
      setProducts((items) => [...items, {
        ...initialProducts[0], id: `p-${Date.now()}`, name: draftName.trim(), description: draftDescription,
        baseSku: "R88-NOVO", internalCode: "NOVO-0088", featured: false, variants: [{ ...initialProducts[0].variants[0], id: `v-${Date.now()}`, sku: "R88-NOVO-01", stock: 0 }],
      }]);
    }
    setEditor(null);
  };

  const toggleProduct = (product: CatalogProduct) => setProducts((items) => items.map((item) => item.id === product.id
    ? item.active
      ? { ...item, active: false }
      : { ...item, active: true, status: "active" }
    : item));

  const bulkStatus = (status: CatalogProduct["status"]) => {
    setProducts((items) => items.map((item) => selected.includes(item.id) ? { ...item, status } : item));
    setSelected([]);
  };

  const duplicateProduct = (product: CatalogProduct) => setProducts((items) => [...items, {
    ...product, id: `p-copy-${Date.now()}`, name: `${product.name} — cópia`, baseSku: `${product.baseSku}-COPY`,
    internalCode: `${product.internalCode}-COPY`, featured: false, status: "inactive",
    variants: product.variants.map((variant) => ({ ...variant, id: `v-copy-${Date.now()}`, sku: `${variant.sku}-COPY`, stock: 0 })),
  }]);

  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize);
  const activeCategories = categories.filter((item) => item.active).length;
  const activeLines = lines.filter((item) => item.active).length;
  const selectedProduct = editor?.type === "product" ? products.find((item) => item.id === editor.id) : undefined;
  const selectedCategory = editor?.type === "category" ? categories.find((item) => item.id === editor.id) : undefined;
  const selectedLine = editor?.type === "line" ? lines.find((item) => item.id === editor.id) : undefined;

  return (
    <div className="radio88-current">
      <main className="catalog-admin">
        <header className="catalog-heading">
          <div>
            <div className="catalog-kicker">CATÁLOGO · RÁDIO 88 FM</div>
            <h1>Produtos e organização</h1>
            <p>Uma visão confiável do que está na loja — da ficha ao estoque.</p>
          </div>
          <div className="catalog-totals" aria-label="Resumo do catálogo">
            <div><strong>{products.length}</strong><span>produtos</span></div><i />
            <div><strong>{activeCategories}</strong><span>categorias ativas</span></div><i />
            <div><strong>{activeLines}</strong><span>linhas ativas</span></div>
          </div>
        </header>

        <div className="catalog-tabs" role="tablist" aria-label="Seções do catálogo">
          {([
            ["products", "Produtos", products.length, Tag],
            ["categories", "Categorias", categories.length, ListFilter],
            ["lines", "Linhas de produto", lines.length, Layers3],
          ] as const).map(([key, label, count, Icon]) => (
            <button key={key} className={`catalog-tab ${tab === key ? "is-active" : ""}`} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} data-testid={`tab-catalog-${key}`}>
              <Icon size={16} />{label}<span>{count}</span>
            </button>
          ))}
        </div>

        {tab === "products" && <>
          <div className="catalog-toolbar">
            <label className="catalog-search"><Search size={17} /><input aria-label="Buscar produtos" placeholder="Buscar nome, SKU, marca..." value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} data-testid="input-product-search" />{search && <button aria-label="Limpar busca" onClick={() => setSearch("")} data-testid="button-clear-search"><X size={15} /></button>}</label>
            <select aria-label="Filtrar por categoria" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} data-testid="select-filter-category"><option value="">Todas as categorias</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
            <select aria-label="Filtrar por linha" value={lineFilter} onChange={(event) => setLineFilter(event.target.value)} data-testid="select-filter-line"><option value="">Todas as linhas</option>{lines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}</select>
            <select aria-label="Filtrar por situação" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} data-testid="select-filter-status"><option value="all">Todas as situações</option><option value="active">Ativos</option><option value="hidden">Ocultos</option><option value="inactive">Inativos</option><option value="archived">Arquivados</option></select>
            <select aria-label="Ordenar produtos" value={sortBy} onChange={(event) => setSortBy(event.target.value)} data-testid="select-sort-products"><option value="name">Ordenar: nome</option><option value="category">Ordenar: categoria</option><option value="status">Ordenar: situação</option></select>
            <button className="catalog-add" onClick={() => openEditor({ type: "product", mode: "new" })} data-testid="button-create-product"><Plus size={16} />Novo produto</button>
          </div>
          {selected.length > 0 && <div className="bulk-bar" data-testid="bulk-actions"><span><b>{selected.length}</b> selecionados</span><button onClick={() => bulkStatus("active")} data-testid="button-bulk-activate">Ativar</button><button onClick={() => bulkStatus("hidden")} data-testid="button-bulk-hide">Ocultar</button><button onClick={() => bulkStatus("inactive")} data-testid="button-bulk-inactivate">Inativar</button><button className="push-right" onClick={() => setSelected([])} data-testid="button-clear-selection">Limpar seleção</button></div>}
          <div className="catalog-table-wrap">
            <table className="catalog-table">
              <thead><tr><th><input aria-label="Selecionar todos nesta página" type="checkbox" checked={visible.length > 0 && visible.every((product) => selected.includes(product.id))} onChange={(event) => setSelected(event.target.checked ? visible.map((product) => product.id) : [])} data-testid="checkbox-select-page" /></th>
                <th><button className="sort-control" onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")} data-testid="button-sort-products">Produto {sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}</button></th>
                <th>Categoria / linha</th><th>Preço</th><th>Estoque</th><th>Situação</th><th aria-label="Ações" /></tr></thead>
              <tbody>{visible.map((product) => {
                const lowest = Math.min(...product.variants.map((variant) => variant.price));
                const stock = product.variants.reduce((sum, variant) => sum + variant.stock, 0);
                return <tr key={product.id} data-testid={`row-product-${product.id}`}>
                  <td><input aria-label={`Selecionar ${product.name}`} type="checkbox" checked={selected.includes(product.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, product.id] : selected.filter((id) => id !== product.id))} data-testid={`checkbox-product-${product.id}`} /></td>
                  <td><button className="catalog-product" onClick={() => openEditor({ type: "product", mode: "view", id: product.id })} data-testid={`button-view-product-${product.id}`}><span className="product-swatch"><Shirt size={18} /></span><span><b>{product.name}</b><small>{product.baseSku || product.internalCode}{product.featured ? " · Destaque" : ""}</small></span></button></td>
                  <td><b className="cell-main">{product.categoryName}</b><small className="cell-sub">{product.lineName}</small></td>
                  <td><b className="cell-main">{formatBRL(lowest)}</b><small className="cell-sub">{product.variants.length} {product.variants.length === 1 ? "variante" : "variantes"}</small></td>
                  <td><span className={isLowStock(product) ? "stock-low" : "cell-main"}>{stock} un.</span></td>
                  <td><span className={`status-pill status-${!product.active ? "archived" : product.status}`}>{statusLabel(product)}</span></td>
                  <td><div className="row-actions"><button title="Editar produto" aria-label={`Editar ${product.name}`} onClick={() => openEditor({ type: "product", mode: "edit", id: product.id })} data-testid={`button-edit-product-${product.id}`}><Pencil size={15} /></button><button title="Duplicar produto" aria-label={`Duplicar ${product.name}`} onClick={() => duplicateProduct(product)} data-testid={`button-duplicate-product-${product.id}`}><Copy size={15} /></button><button title={!product.active ? "Reativar produto" : "Arquivar produto"} aria-label={!product.active ? `Reativar ${product.name}` : `Arquivar ${product.name}`} onClick={() => toggleProduct(product)} data-testid={`button-toggle-product-${product.id}`}><Archive size={15} /></button></div></td>
                </tr>;
              })}</tbody>
            </table>
            {!filtered.length && <div className="catalog-empty"><div className="empty-mark"><Tag size={19} /></div><h3>Nenhum resultado para esses filtros</h3><p>Ajuste ou limpe os filtros para encontrar produtos.</p><button onClick={() => { setSearch(""); setCategoryFilter(""); setLineFilter(""); setStatusFilter("all"); }} data-testid="button-reset-filters">Limpar filtros</button></div>}
          </div>
          <footer className="catalog-pagination"><span data-testid="text-pagination-count">{filtered.length ? `${(Math.min(page, pageCount) - 1) * pageSize + 1}–${Math.min(page, pageCount) * pageSize} de ${filtered.length} produtos` : "0 produtos"}</span><div><button aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} data-testid="button-page-previous"><ChevronLeft size={16} /></button><span data-testid="text-page-number">{Math.min(page, pageCount)} / {pageCount}</span><button aria-label="Próxima página" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} data-testid="button-page-next"><ChevronRight size={16} /></button></div></footer>
        </>}

        {tab !== "products" && <EntityList
          title={tab === "categories" ? "Categorias" : "Linhas de produto"}
          description={tab === "categories" ? "Organize os produtos por departamento da loja." : "Agrupe coleções e identidades que atravessam categorias."}
          addLabel={tab === "categories" ? "Nova categoria" : "Nova linha"}
          testId={tab}
          items={tab === "categories" ? categories.map((item) => ({ ...item, detail: item.slug })) : lines.map((item) => ({ ...item, detail: item.name.toLowerCase().replaceAll(" ", "-"), description: "Agrupe coleções e identidades que atravessam categorias." }))}
          onAdd={() => openEditor({ type: tab === "categories" ? "category" : "line", mode: "new" })}
          onEdit={(id) => openEditor({ type: tab === "categories" ? "category" : "line", mode: "edit", id })}
          onToggle={(id) => tab === "categories" ? setCategories((items) => items.map((item) => item.id === id ? { ...item, active: !item.active } : item)) : setLines((items) => items.map((item) => item.id === id ? { ...item, active: !item.active } : item))}
          onArchive={(id) => tab === "categories" ? setCategories((items) => items.map((item) => item.id === id ? { ...item, active: false } : item)) : setLines((items) => items.map((item) => item.id === id ? { ...item, active: false } : item))}
        />}
      </main>

      {editor && <div className="catalog-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }} data-testid={editor.type === "category" ? "dialog-category-overlay" : "dialog-product-overlay"}>
        <section className="catalog-dialog" role="dialog" aria-modal="true">
          <header><div><span className="catalog-kicker">{editor.mode === "view" ? "FICHA DO PRODUTO" : editor.type === "category" ? "ORGANIZAÇÃO" : editor.type === "line" ? "IDENTIDADE DE PRODUTO" : "EDIÇÃO DE CATÁLOGO"}</span><h2>{editor.mode === "view" ? selectedProduct?.name : editor.type === "category" ? (editor.mode === "new" ? "Nova categoria" : `Editar ${selectedCategory?.name}`) : editor.type === "line" ? (editor.mode === "new" ? "Nova linha" : `Editar ${selectedLine?.name}`) : (editor.mode === "new" ? "Adicionar produto" : "Editar produto")}</h2></div><button className="icon-button" aria-label="Fechar" onClick={() => setEditor(null)} data-testid={`button-close-${editor.type}-dialog`}><X size={18} /></button></header>
          {editor.mode === "view" && selectedProduct ? <div className="view-product"><span className="product-swatch"><Shirt size={19} /></span><div><p>{selectedProduct.description}</p><small>{selectedProduct.categoryName} · {selectedProduct.lineName} · {statusLabel(selectedProduct)}</small></div><div className="view-variants">{selectedProduct.variants.map((variant) => <div key={variant.id}><span>{variant.name}<small>{variant.sku} · {variant.active ? "Ativa" : "Inativa"}</small></span><b>{formatBRL(variant.price)} · {variant.stock} disponíveis</b></div>)}</div><button className="catalog-add" onClick={() => openEditor({ type: "product", mode: "edit", id: selectedProduct.id })} data-testid="button-view-edit-product"><Pencil size={15} />Editar ficha</button></div> :
            <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); saveEditor(); }}>
              <label>{editor.type === "product" ? "Nome do produto" : "Nome"}<input autoFocus required minLength={2} maxLength={editor.type === "category" ? 80 : 160} value={draftName} onChange={(event) => setDraftName(event.target.value)} data-testid={editor.type === "product" ? "input-product-name" : editor.type === "category" ? "input-category-name" : "input-line-name"} /></label>
              {editor.type === "category" && <label>Ícone<select data-testid="select-category-icon"><option>tag</option><option>shopping-bag</option><option>shirt</option><option>coffee</option><option>headphones</option><option>backpack</option><option>gift</option><option>disc</option></select></label>}
              {editor.type === "product" && <div className="form-columns"><label>Categoria<select defaultValue={selectedProduct?.categoryId ?? ""} data-testid="select-product-category"><option value="">Sem categoria</option>{categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Linha de produto<select defaultValue={selectedProduct?.lineId ?? ""} data-testid="select-product-line"><option value="">Sem linha</option>{lines.filter((line) => line.active).map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}</select></label></div>}
              {editor.type !== "line" && <label>Descrição<textarea value={draftDescription} maxLength={editor.type === "category" ? 400 : 5000} onChange={(event) => setDraftDescription(event.target.value)} data-testid={editor.type === "category" ? "input-category-description" : "input-product-description"} /></label>}
              <footer className="dialog-actions"><button type="button" onClick={() => setEditor(null)} data-testid={`button-cancel-${editor.type}`}>Cancelar</button><button type="submit" data-testid={editor.type === "category" ? "button-save-category" : editor.type === "line" ? "button-save-line" : "button-save-product"}>{editor.type === "category" ? "Salvar categoria" : editor.type === "line" ? "Salvar linha" : "Salvar produto"}</button></footer>
            </form>}
        </section>
      </div>}
    </div>
  );
}

type EntityItem = { id: string; name: string; detail: string; description: string; active: boolean };

function EntityList({ title, description, addLabel, testId, items, onAdd, onEdit, onToggle, onArchive }: {
  title: string;
  description: string;
  addLabel: string;
  testId: string;
  items: EntityItem[];
  onAdd: () => void;
  onEdit: (id: string) => void;
  onToggle: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  return <section className="entity-panel" data-testid={`panel-${testId}`}><header className="entity-heading"><div><h2>{title}</h2><p>{description}</p></div><button className="catalog-add" onClick={onAdd} data-testid={`button-create-${testId}`}><Plus size={15} />{addLabel}</button></header>
    {!items.length ? <div className="catalog-empty category-empty" data-testid={`empty-${testId}`}><div className="empty-mark"><Layers3 size={18} /></div><h3>Nenhum registro ainda</h3><p>Adicione o primeiro item para manter o catálogo organizado.</p></div> :
      <div className="entity-list">{items.map((item) => <article key={item.id} data-testid={`card-${testId}-${item.id}`}><div className="entity-symbol">{testId === "categories" ? <Tag size={17} /> : <Layers3 size={17} />}</div><div className="entity-copy"><div><b>{item.name}</b><span className={`status-pill ${item.active ? "status-active" : "status-inactive"}`}>{item.active ? "Ativa" : "Arquivada"}</span></div><small>{item.detail}</small><p>{item.description || "Sem descrição informada."}</p></div><div className="entity-actions"><button onClick={() => onEdit(item.id)} data-testid={`button-edit-${testId}-${item.id}`}><Pencil size={14} />Editar</button><button onClick={() => onToggle(item.id)} data-testid={`button-toggle-${testId}-${item.id}`}>{item.active ? "Desativar" : "Reativar"}</button>{item.active && <button onClick={() => onArchive(item.id)} data-testid={`button-archive-${testId}-${item.id}`}><Archive size={14} />Arquivar</button>}</div></article>)}</div>}
  </section>;
}
