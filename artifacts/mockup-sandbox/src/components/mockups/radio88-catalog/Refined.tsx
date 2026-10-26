import "./_group.css";
import { useMemo, useState } from "react";
import { Archive, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, Layers3, ListFilter, Pencil, Plus, Radio, Search, Shirt, Tag, X } from "lucide-react";
import { CatalogProduct, formatBRL, initialCategories, initialLines, initialProducts, isLowStock, statusLabel } from "./data";

type CatalogTab = "products" | "categories" | "lines";
type ModalState = { kind: "product" | "category" | "line"; mode: "new" | "edit" | "view"; id?: string } | null;

export function Refined() {
  const [tab, setTab] = useState<CatalogTab>("products");
  const [products, setProducts] = useState(initialProducts);
  const [categories, setCategories] = useState(initialCategories);
  const [lines, setLines] = useState(initialLines);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [lineFilter, setLineFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState<string[]>([]);
  const [modal, setModal] = useState<ModalState>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt-BR");
    return products.filter((product) => {
      const searchable = [product.name, product.description, product.baseSku, product.internalCode, product.categoryName, product.lineName, product.brand, product.tags.join(" "), ...product.variants.map((variant) => variant.sku)].join(" ").toLocaleLowerCase("pt-BR");
      const statusMatches = statusFilter === "all" ||
        (statusFilter === "active" ? product.active && product.status === "active" :
          statusFilter === "archived" ? !product.active : product.status === statusFilter);
      return (!needle || searchable.includes(needle)) &&
        (!categoryFilter || product.categoryId === categoryFilter) &&
        (!lineFilter || product.lineId === lineFilter) && statusMatches;
    }).sort((a, b) => {
      const aValue = sortBy === "category" ? a.categoryName : sortBy === "status" ? a.status : a.name;
      const bValue = sortBy === "category" ? b.categoryName : sortBy === "status" ? b.status : b.name;
      return aValue.localeCompare(bValue, "pt-BR") * (sortDir === "asc" ? 1 : -1);
    });
  }, [products, query, categoryFilter, lineFilter, statusFilter, sortBy, sortDir]);

  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize);
  const activeCategoryCount = categories.filter((category) => category.active).length;
  const activeLineCount = lines.filter((line) => line.active).length;
  const modalProduct = modal?.kind === "product" ? products.find((product) => product.id === modal.id) : undefined;
  const modalCategory = modal?.kind === "category" ? categories.find((category) => category.id === modal.id) : undefined;
  const modalLine = modal?.kind === "line" ? lines.find((line) => line.id === modal.id) : undefined;

  const openModal = (next: ModalState) => {
    setModal(next);
    const product = next?.kind === "product" ? products.find((item) => item.id === next.id) : undefined;
    const category = next?.kind === "category" ? categories.find((item) => item.id === next.id) : undefined;
    const line = next?.kind === "line" ? lines.find((item) => item.id === next.id) : undefined;
    setDraftName(product?.name ?? category?.name ?? line?.name ?? "");
    setDraftDescription(product?.description ?? category?.description ?? "");
  };

  const saveModal = () => {
    if (!modal || !draftName.trim()) return;
    const name = draftName.trim();
    if (modal.kind === "category") {
      if (modal.mode === "edit" && modal.id) setCategories((current) => current.map((item) => item.id === modal.id ? { ...item, name, description: draftDescription } : item));
      else setCategories((current) => [...current, { id: `cat-${Date.now()}`, name, slug: name.toLowerCase().replaceAll(" ", "-"), description: draftDescription, active: true }]);
    } else if (modal.kind === "line") {
      if (modal.mode === "edit" && modal.id) setLines((current) => current.map((item) => item.id === modal.id ? { ...item, name } : item));
      else setLines((current) => [...current, { id: `line-${Date.now()}`, name, active: true }]);
    } else if (modal.mode === "edit" && modal.id) {
      setProducts((current) => current.map((item) => item.id === modal.id ? { ...item, name, description: draftDescription } : item));
    } else {
      setProducts((current) => [...current, {
        ...initialProducts[0], id: `p-${Date.now()}`, name, description: draftDescription,
        baseSku: "R88-NOVO", internalCode: "NOVO-0088", featured: false, status: "active",
        variants: [{ ...initialProducts[0].variants[0], id: `v-${Date.now()}`, sku: "R88-NOVO-01", stock: 0 }],
      }]);
    }
    setModal(null);
  };

  const toggleProduct = (product: CatalogProduct) => setProducts((current) => current.map((item) => item.id === product.id
    ? item.active ? { ...item, active: false } : { ...item, active: true, status: "active" }
    : item));

  const duplicateProduct = (product: CatalogProduct) => setProducts((current) => [...current, {
    ...product,
    id: `p-copy-${Date.now()}`,
    name: `${product.name} — cópia`,
    baseSku: `${product.baseSku}-COPY`,
    internalCode: `${product.internalCode}-COPY`,
    featured: false,
    status: "inactive",
    variants: product.variants.map((variant) => ({ ...variant, id: `v-copy-${Date.now()}`, sku: `${variant.sku}-COPY`, stock: 0 })),
  }]);

  const bulkStatus = (status: CatalogProduct["status"]) => {
    setProducts((current) => current.map((product) => selected.includes(product.id) ? { ...product, status } : product));
    setSelected([]);
  };

  const toggleEntity = (kind: "category" | "line", id: string) => {
    if (kind === "category") setCategories((current) => current.map((item) => item.id === id ? { ...item, active: !item.active } : item));
    else setLines((current) => current.map((item) => item.id === id ? { ...item, active: !item.active } : item));
  };

  const archiveEntity = (kind: "category" | "line", id: string) => {
    if (kind === "category") setCategories((current) => current.map((item) => item.id === id ? { ...item, active: false } : item));
    else setLines((current) => current.map((item) => item.id === id ? { ...item, active: false } : item));
  };

  return (
    <div className="radio88-refined">
      <main className="refined-shell">
        <header className="refined-heading">
          <div>
            <div className="refined-brandline"><span className="brand-mark"><Radio size={15} /></span>CATÁLOGO · RÁDIO 88 FM</div>
            <h1>Produtos e organização</h1>
            <p>Uma visão confiável do que está na loja — da ficha ao estoque.</p>
          </div>
          <div className="refined-metrics" aria-label="Resumo do catálogo">
            <div><strong>{products.length}</strong><span>produtos</span></div>
            <div><strong>{activeCategoryCount}</strong><span>categorias ativas</span></div>
            <div><strong>{activeLineCount}</strong><span>linhas ativas</span></div>
          </div>
        </header>

        <nav className="refined-tabs" role="tablist" aria-label="Seções do catálogo">
          {([
            ["products", "Produtos", products.length, Tag],
            ["categories", "Categorias", categories.length, ListFilter],
            ["lines", "Linhas de produto", lines.length, Layers3],
          ] as const).map(([key, label, count, Icon]) => <button key={key} className="refined-tab" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} data-testid={`tab-catalog-${key}`}><Icon size={15} />{label}<span>{count}</span></button>)}
        </nav>

        {tab === "products" ? <>
          <div className="refined-toolbar">
            <label className="refined-search"><Search size={16} /><input aria-label="Buscar produtos" placeholder="Buscar nome, SKU ou marca" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} data-testid="input-product-search" />{query && <button aria-label="Limpar busca" onClick={() => setQuery("")} data-testid="button-clear-search"><X size={14} /></button>}</label>
            <select aria-label="Filtrar por categoria" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} data-testid="select-filter-category"><option value="">Todas as categorias</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
            <select aria-label="Filtrar por linha" value={lineFilter} onChange={(event) => setLineFilter(event.target.value)} data-testid="select-filter-line"><option value="">Todas as linhas</option>{lines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}</select>
            <select aria-label="Filtrar por situação" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} data-testid="select-filter-status"><option value="all">Todas as situações</option><option value="active">Ativos</option><option value="hidden">Ocultos</option><option value="inactive">Inativos</option><option value="archived">Arquivados</option></select>
            <select aria-label="Ordenar produtos" value={sortBy} onChange={(event) => setSortBy(event.target.value)} data-testid="select-sort-products"><option value="name">Ordenar: nome</option><option value="category">Ordenar: categoria</option><option value="status">Ordenar: situação</option></select>
            <button className="refined-button" onClick={() => openModal({ kind: "product", mode: "new" })} data-testid="button-create-product"><Plus size={15} />Novo produto</button>
          </div>

          {selected.length > 0 && <div className="refined-bulk" data-testid="bulk-actions"><b>{selected.length}</b> selecionados<button onClick={() => bulkStatus("active")} data-testid="button-bulk-activate">Ativar</button><button onClick={() => bulkStatus("hidden")} data-testid="button-bulk-hide">Ocultar</button><button onClick={() => bulkStatus("inactive")} data-testid="button-bulk-inactivate">Inativar</button><span className="spacer" /><button onClick={() => setSelected([])} data-testid="button-clear-selection">Limpar seleção</button></div>}

          <div className="refined-table-shell">
            <table className="refined-table">
              <thead><tr><th><input aria-label="Selecionar todos nesta página" type="checkbox" checked={visible.length > 0 && visible.every((product) => selected.includes(product.id))} onChange={(event) => setSelected(event.target.checked ? visible.map((product) => product.id) : [])} data-testid="checkbox-select-page" /></th>
                <th><button className="sort-control" onClick={() => setSortDir((direction) => direction === "asc" ? "desc" : "asc")} data-testid="button-sort-products">Produto {sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />}</button></th>
                <th>Categoria / linha</th><th>Preço</th><th>Estoque</th><th>Situação</th><th aria-label="Ações" /></tr></thead>
              <tbody>{visible.map((product) => {
                const stock = product.variants.reduce((sum, variant) => sum + variant.stock, 0);
                const lowestPrice = Math.min(...product.variants.map((variant) => variant.price));
                const statusClass = !product.active ? "archived" : product.status === "active" ? "" : product.status;
                return <tr key={product.id} data-testid={`row-product-${product.id}`}>
                  <td><input aria-label={`Selecionar ${product.name}`} type="checkbox" checked={selected.includes(product.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, product.id] : selected.filter((id) => id !== product.id))} data-testid={`checkbox-product-${product.id}`} /></td>
                  <td><button className="refined-product" onClick={() => openModal({ kind: "product", mode: "view", id: product.id })} data-testid={`button-view-product-${product.id}`}><span className="product-swatch"><Shirt size={19} /></span><span><b>{product.name}</b><small>{product.baseSku || product.internalCode}{product.featured ? " · Destaque" : ""}</small></span></button></td>
                  <td><b className="refined-primary">{product.categoryName}</b><small className="refined-sub">{product.lineName}</small></td>
                  <td><span className="refined-price">{formatBRL(lowestPrice)}</span><small className="refined-sub">{product.variants.length} {product.variants.length === 1 ? "variante" : "variantes"}</small></td>
                  <td><span className={`refined-stock ${isLowStock(product) ? "is-low" : ""}`}>{stock} un.</span></td>
                  <td><span className={`refined-status ${statusClass}`}>{statusLabel(product)}</span></td>
                  <td><div className="refined-actions"><button title="Editar produto" aria-label={`Editar ${product.name}`} onClick={() => openModal({ kind: "product", mode: "edit", id: product.id })} data-testid={`button-edit-product-${product.id}`}><Pencil size={14} /></button><button title="Duplicar produto" aria-label={`Duplicar ${product.name}`} onClick={() => duplicateProduct(product)} data-testid={`button-duplicate-product-${product.id}`}><Copy size={14} /></button><button title={!product.active ? "Reativar produto" : "Arquivar produto"} aria-label={!product.active ? `Reativar ${product.name}` : `Arquivar ${product.name}`} onClick={() => toggleProduct(product)} data-testid={`button-toggle-product-${product.id}`}><Archive size={14} /></button></div></td>
                </tr>;
              })}</tbody>
            </table>
          </div>

          <div className="mobile-product-list">
            {visible.map((product) => {
              const stock = product.variants.reduce((sum, variant) => sum + variant.stock, 0);
              const lowestPrice = Math.min(...product.variants.map((variant) => variant.price));
              const statusClass = !product.active ? "archived" : product.status === "active" ? "" : product.status;
              return <article className="mobile-product-card" key={product.id} data-testid={`mobile-row-product-${product.id}`}>
                <div className="mobile-product-identity"><input aria-label={`Selecionar ${product.name}`} type="checkbox" checked={selected.includes(product.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, product.id] : selected.filter((id) => id !== product.id))} data-testid={`checkbox-product-mobile-${product.id}`} /><button className="refined-product" onClick={() => openModal({ kind: "product", mode: "view", id: product.id })} data-testid={`button-view-product-mobile-${product.id}`}><span className="product-swatch"><Shirt size={18} /></span><span><b>{product.name}</b><small>{product.baseSku}</small></span></button></div>
                <div className="refined-actions"><button aria-label={`Editar ${product.name}`} onClick={() => openModal({ kind: "product", mode: "edit", id: product.id })} data-testid={`button-edit-product-mobile-${product.id}`}><Pencil size={14} /></button><button aria-label={`Duplicar ${product.name}`} onClick={() => duplicateProduct(product)} data-testid={`button-duplicate-product-mobile-${product.id}`}><Copy size={14} /></button><button aria-label={!product.active ? `Reativar ${product.name}` : `Arquivar ${product.name}`} onClick={() => toggleProduct(product)} data-testid={`button-toggle-product-mobile-${product.id}`}><Archive size={14} /></button></div>
                <div className="mobile-product-meta"><div><span className="refined-primary">{product.categoryName} <span className="refined-sub">/ {product.lineName}</span></span><span className={`refined-stock ${isLowStock(product) ? "is-low" : ""}`}>{stock} un. em estoque</span></div><div><b className="refined-price">{formatBRL(lowestPrice)}</b><span className={`refined-status ${statusClass}`}>{statusLabel(product)}</span></div></div>
              </article>;
            })}
          </div>

          {!filtered.length && <div className="category-empty"><Tag size={20} /><h3>Nenhum resultado para esses filtros</h3><p>Ajuste ou limpe os filtros para encontrar produtos.</p><button className="refined-button quiet" onClick={() => { setQuery(""); setCategoryFilter(""); setLineFilter(""); setStatusFilter("all"); }} data-testid="button-reset-filters">Limpar filtros</button></div>}

          <footer className="refined-pagination"><span data-testid="text-pagination-count">{filtered.length ? `${(Math.min(page, pageCount) - 1) * pageSize + 1}–${Math.min(page, pageCount) * pageSize} de ${filtered.length} produtos` : "0 produtos"}</span><div><button aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} data-testid="button-page-previous"><ChevronLeft size={16} /></button><span data-testid="text-page-number">{Math.min(page, pageCount)} / {pageCount}</span><button aria-label="Próxima página" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} data-testid="button-page-next"><ChevronRight size={16} /></button></div></footer>
        </> : <EntitySection
          kind={tab === "categories" ? "category" : "line"}
          items={tab === "categories" ? categories : lines.map((line) => ({ ...line, slug: line.name.toLowerCase().replaceAll(" ", "-"), description: "Agrupe coleções e identidades que atravessam categorias." }))}
          onAdd={() => openModal({ kind: tab === "categories" ? "category" : "line", mode: "new" })}
          onEdit={(id) => openModal({ kind: tab === "categories" ? "category" : "line", mode: "edit", id })}
          onToggle={(id) => toggleEntity(tab === "categories" ? "category" : "line", id)}
          onArchive={(id) => archiveEntity(tab === "categories" ? "category" : "line", id)}
        />}
      </main>

      {modal && <div className="catalog-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }} data-testid={`dialog-${modal.kind}-overlay`}>
        <section className="catalog-dialog" role="dialog" aria-modal="true" aria-labelledby="refined-dialog-title">
          <header><div><span className="catalog-kicker">{modal.mode === "view" ? "FICHA DO PRODUTO" : modal.kind === "category" ? "ORGANIZAÇÃO" : modal.kind === "line" ? "IDENTIDADE DE PRODUTO" : "EDIÇÃO DE CATÁLOGO"}</span><h2 id="refined-dialog-title">{modal.mode === "view" ? modalProduct?.name : modal.kind === "category" ? (modal.mode === "new" ? "Nova categoria" : `Editar ${modalCategory?.name}`) : modal.kind === "line" ? (modal.mode === "new" ? "Nova linha" : `Editar ${modalLine?.name}`) : modal.mode === "new" ? "Adicionar produto" : "Editar produto"}</h2></div><button className="icon-button" aria-label="Fechar" onClick={() => setModal(null)} data-testid={`button-close-${modal.kind}-dialog`}><X size={18} /></button></header>
          {modal.mode === "view" && modalProduct ? <div className="view-product"><span className="product-swatch"><Shirt size={20} /></span><div><p>{modalProduct.description}</p><small>{modalProduct.categoryName} · {modalProduct.lineName} · {statusLabel(modalProduct)}</small></div><div className="view-variants">{modalProduct.variants.map((variant) => <div key={variant.id}><span>{variant.name}<small>{variant.sku} · {variant.active ? "Ativa" : "Inativa"}{variant.size ? ` · ${variant.size}` : ""}{variant.color ? ` · ${variant.color}` : ""}</small></span><b>{formatBRL(variant.price)} · {variant.stock} disponíveis</b></div>)}</div><button className="refined-button" onClick={() => openModal({ kind: "product", mode: "edit", id: modalProduct.id })} data-testid="button-view-edit-product"><Pencil size={14} />Editar ficha</button></div> :
            <form className="catalog-form" onSubmit={(event) => { event.preventDefault(); saveModal(); }}>
              <label>{modal.kind === "product" ? "Nome do produto" : "Nome"}<input autoFocus required minLength={2} maxLength={modal.kind === "category" ? 80 : 160} value={draftName} onChange={(event) => setDraftName(event.target.value)} data-testid={modal.kind === "product" ? "input-product-name" : modal.kind === "category" ? "input-category-name" : "input-line-name"} /></label>
              {modal.kind === "category" && <label>Ícone<select defaultValue="tag" data-testid="select-category-icon"><option value="tag">tag</option><option value="shopping-bag">shopping-bag</option><option value="shirt">shirt</option><option value="coffee">coffee</option><option value="headphones">headphones</option><option value="backpack">backpack</option><option value="gift">gift</option><option value="disc">disc</option></select></label>}
              {modal.kind === "product" && <div className="form-columns"><label>Categoria<select defaultValue={modalProduct?.categoryId ?? ""} data-testid="select-product-category"><option value="">Sem categoria</option>{categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Linha de produto<select defaultValue={modalProduct?.lineId ?? ""} data-testid="select-product-line"><option value="">Sem linha</option>{lines.filter((line) => line.active).map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}</select></label></div>}
              {(modal.kind === "category" || modal.kind === "product") && <label>Descrição<textarea value={draftDescription} maxLength={modal.kind === "category" ? 400 : 5000} onChange={(event) => setDraftDescription(event.target.value)} data-testid={modal.kind === "category" ? "input-category-description" : "input-product-description"} /></label>}
              <footer className="dialog-actions"><button type="button" onClick={() => setModal(null)} data-testid={`button-cancel-${modal.kind}`}>Cancelar</button><button type="submit" data-testid={modal.kind === "category" ? "button-save-category" : modal.kind === "line" ? "button-save-line" : "button-save-product"}>{modal.kind === "category" ? "Salvar categoria" : modal.kind === "line" ? "Salvar linha" : "Salvar produto"}</button></footer>
            </form>}
        </section>
      </div>}
    </div>
  );
}

type EntityData = { id: string; name: string; slug: string; description?: string; active: boolean };

function EntitySection({ kind, items, onAdd, onEdit, onToggle, onArchive }: {
  kind: "category" | "line";
  items: EntityData[];
  onAdd: () => void;
  onEdit: (id: string) => void;
  onToggle: (id: string) => void;
  onArchive: (id: string) => void;
}) {
  const title = kind === "category" ? "Categorias" : "Linhas de produto";
  const description = kind === "category" ? "Organize os produtos por departamento da loja." : "Agrupe coleções e identidades que atravessam categorias.";
  const activeCount = items.filter((item) => item.active).length;
  return <section className="category-section" data-testid={`panel-${kind === "category" ? "categories" : "lines"}`}>
    <header className="category-section-head"><div><span className="section-label">ORGANIZAÇÃO DO CATÁLOGO</span><h2>{title}</h2><p>{description}</p></div><button className="refined-button" onClick={onAdd} data-testid={`button-create-${kind === "category" ? "categories" : "lines"}`}><Plus size={15} />{kind === "category" ? "Nova categoria" : "Nova linha"}</button></header>
    {!items.length ? <div className="category-empty" data-testid={`empty-${kind === "category" ? "categories" : "lines"}`}><Layers3 size={20} /><h3>Nenhum registro ainda</h3><p>Adicione o primeiro item para manter o catálogo organizado.</p></div> :
      <div className="category-list">{items.map((item) => {
        return <article className="category-row" key={item.id} data-testid={`card-${kind === "category" ? "categories" : "lines"}-${item.id}`}>
          <div className="category-identity"><span className="category-icon">{kind === "category" ? <Tag size={17} /> : <Layers3 size={17} />}</span><span><b>{item.name}</b><small>{item.slug}</small></span></div>
          <p className="category-description">{item.description || "Sem descrição informada."}</p>
          <span className={`refined-status category-status ${item.active ? "" : "inactive"}`}>{item.active ? "Ativa" : "Arquivada"}</span>
          <div className="category-actions"><button onClick={() => onEdit(item.id)} data-testid={`button-edit-${kind === "category" ? "categories" : "lines"}-${item.id}`}><Pencil size={13} />Editar</button><button onClick={() => onToggle(item.id)} data-testid={`button-toggle-${kind === "category" ? "categories" : "lines"}-${item.id}`}>{item.active ? "Desativar" : "Reativar"}</button>{item.active && <button onClick={() => onArchive(item.id)} data-testid={`button-archive-${kind === "category" ? "categories" : "lines"}-${item.id}`}><Archive size={13} />Arquivar</button>}</div>
        </article>;
      })}</div>}
    <footer className="category-footer"><strong>{items.length}</strong> registros <span aria-hidden="true">·</span> <strong>{activeCount}</strong> ativos</footer>
  </section>;
}
