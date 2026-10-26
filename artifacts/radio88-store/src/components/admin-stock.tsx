import { userFacingError } from '@/lib/user-facing-errors';
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAdminSummaryQueryKey,
  getListAdminProductsQueryKey,
  getListAdminStockMovementsQueryKey,
  getListAdminStockQueryKey,
  useAdjustStock,
  useCreateAdminStockMovement,
  useImportAdminStockCatalog,
  useListAdminStock,
  useListAdminStockMovements,
} from "@workspace/api-client-react";
import type {
  ListAdminStockMovementsParams,
  StockItem,
  StockMovement,
} from "@workspace/api-client-react";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, AlertTriangle, Check, ChevronLeft, ChevronRight, Clock3, FileUp, History, PackageCheck, Search, SlidersHorizontal, X } from "lucide-react";
import { Loading, ErrorState, Notice } from "@/components/feedback";
import { money } from "@/lib/format";
import { serializeStockCsv, validateStockCsv } from "@/lib/stock-csv";
import { useCan } from "@/components/admin-permissions";

const errText = userFacingError;
const dateLabel = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const movementNames: Record<string, string> = { inbound: "Entrada", outbound: "Saída", manual_adjustment: "Ajuste manual", sale: "Venda", reservation: "Reserva", cancellation: "Cancelamento", return: "Devolução" };
const movementOptions = ["inbound", "outbound", "manual_adjustment", "sale", "reservation", "cancellation", "return"] as const;

function dateFilterBound(value: string, endOfDay: boolean): string | undefined {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0).toISOString();
}

function downloadStockCsv(rows: StockItem[]) {
  const blob = new Blob([serializeStockCsv(rows)], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href; link.download = "radio88-estoque.csv"; link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export function AdminStockPage() {
  const qc = useQueryClient();
  const canAdjust = useCan("inventory:adjust");
  const canImportPermission = useCan("inventory:import");
  const canCreateProducts = useCan("products:create");
  const canUpdateProducts = useCan("products:update");
  const canImport = canImportPermission && canCreateProducts && canUpdateProducts;
  const canExport = useCan("inventory:export");
  const stockQ = useListAdminStock({ query: { queryKey: getListAdminStockQueryKey(), retry: false } });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [line, setLine] = useState("");
  const [condition, setCondition] = useState("all");
  const [selected, setSelected] = useState<StockItem | null>(null);
  const [action, setAction] = useState<"adjust" | "inbound" | "outbound">("adjust");
  const [count, setCount] = useState("");
  const [reason, setReason] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const [moveSearch, setMoveSearch] = useState("");
  const [moveType, setMoveType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [movePage, setMovePage] = useState(1);
  const [csvText, setCsvText] = useState("");
  const [csvFileName, setCsvFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const adjust = useAdjustStock();
  const movement = useCreateAdminStockMovement();
  const importer = useImportAdminStockCatalog();
  const rows = stockQ.data ?? [];
  const categories = useMemo(() => Array.from(new Map(rows.filter(row => row.categorySlug).map(row => [row.categorySlug!, row.categoryName ?? row.categorySlug!])).entries()), [rows]);
  const lines = useMemo(() => Array.from(new Map(rows.filter(row => row.lineSlug).map(row => [row.lineSlug!, row.lineName ?? row.lineSlug!])).entries()), [rows]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return rows.filter(row => {
      const searchable = [row.productName, row.variantName, row.sku, row.baseSku, row.brand, row.size, row.color].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
      const state = !row.variantActive || !row.productActive ? "inactive" : row.availableStock <= 0 ? "zero" : row.availableStock <= row.minimumStock ? "low" : "healthy";
      return (!query || searchable.includes(query)) && (!category || row.categorySlug === category) && (!line || row.lineSlug === line) && (condition === "all" || state === condition);
    }).sort((a, b) => a.availableStock - b.availableStock || a.productName.localeCompare(b.productName, "pt-BR"));
  }, [rows, search, category, line, condition]);
  const movementParams = useMemo<ListAdminStockMovementsParams>(() => ({
    ...(moveSearch.trim() ? { search: moveSearch.trim() } : {}),
    ...(moveType ? { movementType: moveType as ListAdminStockMovementsParams["movementType"] } : {}),
    ...(from ? { from: dateFilterBound(from, false)! } : {}),
    ...(to ? { to: dateFilterBound(to, true)! } : {}),
    page: movePage, pageSize: 12,
  }), [moveSearch, moveType, from, to, movePage]);
  const invalidDateRange = Boolean(from && to && from > to);
  const historyQ = useListAdminStockMovements(movementParams, { query: { queryKey: getListAdminStockMovementsQueryKey(movementParams), retry: false, enabled: !invalidDateRange } });
  const sellableRows = rows.filter(row => row.variantActive && row.productActive);
  const low = sellableRows.filter(row => row.availableStock > 0 && row.availableStock <= row.minimumStock);
  const zero = sellableRows.filter(row => row.availableStock <= 0);
  const totalPages = Math.max(1, Math.ceil((historyQ.data?.total ?? 0) / 12));
  const importing = validateStockCsv(csvText);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getListAdminStockQueryKey() });
    void qc.invalidateQueries({ queryKey: getListAdminStockMovementsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListAdminProductsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetAdminSummaryQueryKey() });
  };
  const beginAction = (item: StockItem, kind: "adjust" | "inbound" | "outbound") => {
    setSelected(item); setAction(kind); setCount(kind === "adjust" ? String(item.availableStock) : ""); setReason(""); setFeedback(null);
  };
  const submitAction = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const qty = Number(count);
    if (reason.trim().length < 3 || !Number.isInteger(qty) || qty < 0 || (action !== "adjust" && qty < 1)) return;
    const done = () => { invalidate(); setSelected(null); setFeedback({ text: action === "adjust" ? "Saldo disponível ajustado e histórico registrado." : `Movimentação de ${action === "inbound" ? "entrada" : "saída"} registrada.`, kind: "success" }); };
    if (action === "adjust") adjust.mutate({ variantId: selected.variantId, data: { stock: qty, reason: reason.trim() } }, { onSuccess: done, onError: error => setFeedback({ text: errText(error), kind: "error" }) });
    else movement.mutate({ data: { variantId: selected.variantId, movementType: action, quantity: qty, reason: reason.trim() } }, { onSuccess: done, onError: error => setFeedback({ text: errText(error), kind: "error" }) });
  };
  const loadFile = async (file?: File) => {
    if (!file) return;
    setCsvFileName(file.name); setFeedback(null);
    try { setCsvText(await file.text()); } catch { setFeedback({ text: "Não foi possível ler este arquivo CSV.", kind: "error" }); }
  };
  const submitImport = () => {
    if (!importing.items.length || importing.errors.length || importing.items.length > 500) return;
    importer.mutate({ data: { items: importing.items } }, { onSuccess: result => {
      invalidate(); setCsvText(""); setCsvFileName(""); if (fileRef.current) fileRef.current.value = "";
      setFeedback({ text: `Importação concluída: ${result.productsCreated} produtos novos, ${result.productsUpdated} atualizados, ${result.variantsCreated} variantes novas, ${result.variantsUpdated} atualizadas e ${result.stockAdjusted} saldos ajustados.`, kind: "success" });
    }, onError: error => setFeedback({ text: errText(error), kind: "error" }) });
  };

  if (stockQ.isLoading) return <div className="stock-loading"><Loading label="Carregando posições de estoque" /></div>;
  if (stockQ.isError) return <div className="stock-loading"><ErrorState retry={() => stockQ.refetch()} message="Não foi possível consultar o estoque agora." /></div>;

  return <div className="stock-console enter" data-testid="admin-stock-console">
    <header className="stock-heading">
      <div><div className="stock-kicker">CONTROLE DE INVENTÁRIO · 88 FM</div><h2>Estoque da loja</h2><p>Saldo disponível, reservas e cada ajuste com rastreabilidade.</p></div>
       <div className="stock-heading-actions">{canExport && <button className="stock-button stock-button-quiet" onClick={() => downloadStockCsv(rows)} data-testid="button-stock-export"><ArrowDownToLine size={15} />Exportar CSV</button>}{canImport && <button className="stock-button" onClick={() => fileRef.current?.click()} data-testid="button-stock-import"><FileUp size={15} />Importar catálogo</button>}{canImport && <input ref={fileRef} hidden type="file" accept=".csv,text/csv" onChange={event => void loadFile(event.target.files?.[0])} data-testid="input-stock-csv" />}</div>
    </header>
    {feedback && <div className="stock-feedback" data-testid="stock-feedback"><Notice text={feedback.text} kind={feedback.kind} /></div>}
    <div className="stock-summary" data-testid="stock-summary">
      <div className="stock-summary-primary"><span>Variantes ativas</span><strong>{sellableRows.length}</strong><small>em {new Set(sellableRows.map(row => row.productId)).size} produtos</small></div>
      <div className="stock-summary-alert"><AlertTriangle size={17} /><div><strong>{zero.length}</strong><span>sem saldo disponível</span></div></div>
      <div className="stock-summary-alert low"><Clock3 size={17} /><div><strong>{low.length}</strong><span>abaixo do mínimo</span></div></div>
      <div className="stock-summary-note"><PackageCheck size={17} /><span>Reservas permanecem vinculadas aos pedidos.</span></div>
    </div>
    {(zero.length > 0 || low.length > 0) && <div className="stock-alerts" data-testid="stock-alerts">
      {zero.length > 0 && <div className="stock-alert danger"><span className="stock-alert-mark">0</span><div><strong>{zero.length} {zero.length === 1 ? "variante sem disponibilidade" : "variantes sem disponibilidade"}</strong><p>Itens zerados não podem ser comprados na vitrine.</p></div><button onClick={() => setCondition("zero")} data-testid="button-filter-zero-alert">Ver zerados</button></div>}
      {low.length > 0 && <div className="stock-alert caution"><span className="stock-alert-mark">{low.length}</span><div><strong>Reposição necessária</strong><p>{low.length} variantes estão no mínimo ou abaixo dele.</p></div><button onClick={() => setCondition("low")} data-testid="button-filter-low-alert">Ver baixo estoque</button></div>}
    </div>}
    <section className="stock-panel" aria-labelledby="stock-list-heading">
      <div className="stock-panel-heading"><div><span className="stock-overline">POSIÇÕES</span><h3 id="stock-list-heading">Inventário por variante</h3></div><span className="stock-count" data-testid="stock-row-count">{filtered.length} de {rows.length} variantes</span></div>
      <div className="stock-filters">
        <label className="stock-search"><Search size={16} /><input placeholder="Produto, SKU, tamanho ou cor" value={search} onChange={event => setSearch(event.target.value)} data-testid="input-stock-search" aria-label="Buscar estoque" />{search && <button onClick={() => setSearch("")} aria-label="Limpar busca" data-testid="button-clear-stock-search"><X size={14} /></button>}</label>
        <select value={category} onChange={event => setCategory(event.target.value)} aria-label="Filtrar categoria" data-testid="select-stock-category"><option value="">Todas as categorias</option>{categories.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}</select>
        <select value={line} onChange={event => setLine(event.target.value)} aria-label="Filtrar linha" data-testid="select-stock-line"><option value="">Todas as linhas</option>{lines.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}</select>
        <select value={condition} onChange={event => setCondition(event.target.value)} aria-label="Filtrar condição do estoque" data-testid="select-stock-condition"><option value="all">Todas as condições</option><option value="low">Baixo estoque</option><option value="zero">Sem saldo</option><option value="healthy">Saudável</option><option value="inactive">Desativadas</option></select>
        <span className="stock-filter-icon"><SlidersHorizontal size={15} /></span>
      </div>
      <div className="stock-table-wrap">
        <table className="stock-table"><thead><tr><th>Produto / variante</th><th>Identificação</th><th>Preço</th><th>Disponível</th><th>Em mãos</th><th>Reservado</th><th>Mínimo</th><th aria-label="Ações" /></tr></thead>
          <tbody>{filtered.map(item => {
            const state = !item.variantActive || !item.productActive ? "inactive" : item.availableStock <= 0 ? "zero" : item.availableStock <= item.minimumStock ? "low" : "healthy";
            return <tr key={item.variantId} data-testid={`stock-row-${item.variantId}`}>
              <td><div className="stock-product">{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span className="stock-product-mark">{item.productName.slice(0, 1).toLocaleUpperCase("pt-BR")}</span>}<div><strong>{item.productName}</strong><small>{item.variantName}{item.size ? ` · ${item.size}` : ""}{item.color ? ` · ${item.color}` : ""}</small></div></div></td>
              <td><span className="stock-sku">{item.sku}</span><small className="stock-subline">{item.categoryName || "Sem categoria"}{item.lineName ? ` / ${item.lineName}` : ""}{state === "inactive" ? " · inativa" : ""}</small></td>
              <td className="stock-price">{money(item.price)}</td>
              <td><span className={`stock-qty stock-${state}`} data-testid={`stock-available-${item.variantId}`}>{item.availableStock}</span><small className="stock-subline">{state === "zero" ? "indisponível" : state === "low" ? "repor em breve" : "disponível"}</small></td>
              <td><strong className="stock-onhand">{item.stockOnHand}</strong><small className="stock-subline">unidades</small></td>
              <td><strong className="stock-reserved">{item.reservedStock}</strong><small className="stock-subline">em pedidos</small></td>
              <td><span className="stock-min">{item.minimumStock}</span></td>
               <td><div className="stock-row-actions">{canAdjust && <><button onClick={() => beginAction(item, "adjust")} title="Ajustar saldo exato" aria-label={`Ajustar saldo de ${item.productName} ${item.variantName}`} data-testid={`button-adjust-${item.variantId}`}><SlidersHorizontal size={14} /></button><button onClick={() => beginAction(item, "inbound")} title="Registrar entrada" aria-label={`Registrar entrada para ${item.sku}`} data-testid={`button-inbound-${item.variantId}`}><ArrowDownToLine size={14} /></button><button onClick={() => beginAction(item, "outbound")} title="Registrar saída" aria-label={`Registrar saída de ${item.sku}`} data-testid={`button-outbound-${item.variantId}`}><ArrowUpFromLine size={14} /></button></>}</div></td>
            </tr>;
          })}</tbody>
        </table>
        {!filtered.length && <div className="stock-empty" data-testid="stock-empty"><PackageCheck size={21} /><strong>{rows.length ? "Nenhuma variante corresponde aos filtros" : "Nenhuma posição de estoque"}</strong><p>{rows.length ? "Amplie a busca ou limpe os filtros para encontrar uma variante." : "As variantes cadastradas aparecerão aqui com saldo e reservas atuais."}</p>{rows.length > 0 && <button onClick={() => { setSearch(""); setCategory(""); setLine(""); setCondition("all"); }} data-testid="button-reset-stock-filters">Limpar filtros</button>}</div>}
      </div>
    </section>

    <section className="stock-panel stock-history" aria-labelledby="stock-history-heading">
      <div className="stock-panel-heading"><div><span className="stock-overline">AUDITORIA</span><h3 id="stock-history-heading"><History size={18} />Histórico de movimentações</h3></div><span className="stock-count" data-testid="movement-total">{historyQ.data?.total ?? 0} registros</span></div>
      <div className="movement-filters"><label className="stock-search"><Search size={15} /><input value={moveSearch} onChange={event => { setMoveSearch(event.target.value); setMovePage(1); }} placeholder="Buscar SKU, motivo ou pedido" aria-label="Buscar movimentações" data-testid="input-movement-search" /></label><select value={moveType} onChange={event => { setMoveType(event.target.value); setMovePage(1); }} aria-label="Tipo de movimentação" data-testid="select-movement-type"><option value="">Todos os tipos</option>{movementOptions.map(type => <option value={type} key={type}>{movementNames[type]}</option>)}</select><label className="date-filter">De<input type="date" value={from} onChange={event => { setFrom(event.target.value); setMovePage(1); }} data-testid="input-movement-from" /></label><label className="date-filter">Até<input type="date" value={to} onChange={event => { setTo(event.target.value); setMovePage(1); }} data-testid="input-movement-to" /></label></div>
      {invalidDateRange ? <p className="movement-range-error" data-testid="movement-date-range-error">A data inicial precisa ser anterior ou igual à data final.</p> : historyQ.isLoading ? <div className="movement-loading"><Loading label="Carregando histórico" /></div> : historyQ.isError ? <ErrorState retry={() => historyQ.refetch()} message="Não foi possível consultar o histórico." /> : !historyQ.data?.items.length ? <div className="movement-empty" data-testid="movement-empty"><ArrowLeftRight size={19} /><strong>Nenhuma movimentação encontrada</strong><p>Quando houver ajustes, entradas ou pedidos, a trilha de auditoria aparecerá aqui.</p></div> : <>
        <div className="movement-list">{historyQ.data.items.map((entry: StockMovement) => <article className="movement-row" key={entry.id} data-testid={`movement-row-${entry.id}`}><div className={`movement-symbol movement-${entry.movementType}`}><ArrowLeftRight size={15} /></div><div className="movement-main"><div><strong>{entry.productName}</strong><small>{entry.variantName} · {entry.sku}</small></div><p>{entry.reason}{entry.orderNumber ? <b> · Pedido {entry.orderNumber}</b> : ""}</p></div><div className="movement-delta"><strong className={entry.delta > 0 ? "positive" : entry.delta < 0 ? "negative" : ""}>{entry.delta > 0 ? "+" : ""}{entry.delta}</strong><small>un. em mãos</small>{entry.reservedDelta !== 0 && <small className="reserve-delta">Reserva {entry.reservedDelta > 0 ? "+" : ""}{entry.reservedDelta}</small>}</div><div className="movement-meta"><span className={`movement-tag type-${entry.movementType}`}>{movementNames[entry.movementType] ?? entry.movementType}</span><small>{entry.actorName || "Sistema"} · {dateLabel(entry.createdAt)}</small></div></article>)}</div>
        <footer className="movement-pagination"><span>{historyQ.data.total ? `${(movePage - 1) * 12 + 1}–${Math.min(movePage * 12, historyQ.data.total)} de ${historyQ.data.total}` : "0 registros"}</span><div><button disabled={movePage <= 1} onClick={() => setMovePage(page => Math.max(1, page - 1))} aria-label="Página anterior" data-testid="button-movements-previous"><ChevronLeft size={16} /></button><b data-testid="movement-page">{movePage} / {totalPages}</b><button disabled={movePage >= totalPages} onClick={() => setMovePage(page => Math.min(totalPages, page + 1))} aria-label="Próxima página" data-testid="button-movements-next"><ChevronRight size={16} /></button></div></footer>
      </>}
    </section>
     {canImport && <section className="stock-import-panel" aria-labelledby="stock-import-heading"><div className="stock-import-copy"><span className="stock-overline">CATÁLOGO EM LOTE</span><h3 id="stock-import-heading">Importar e revisar CSV</h3><p>Atualiza variantes correspondentes pelo SKU e inclui novas. IDs, pedidos, histórico e reservas existentes são preservados; linhas nunca são removidas.</p>{canExport && <button className="stock-link-button" onClick={() => downloadStockCsv(rows)} data-testid="button-download-stock-template">Baixar CSV atual como modelo</button>}</div>
      <div className="stock-import-drop"><FileUp size={20} /><div><strong>{csvFileName || "Escolha um arquivo CSV"}</strong><small>Até 500 variantes por lote · CSV com cabeçalho exportado</small></div><button onClick={() => fileRef.current?.click()} data-testid="button-choose-import-file">Escolher arquivo</button></div>
      {csvText && <div className="stock-preview" data-testid="stock-import-preview"><div className="stock-preview-heading"><div><strong>Prévia de importação</strong><small>{importing.items.length} linhas prontas · {importing.errors.length} problemas</small></div><button aria-label="Remover arquivo importado" onClick={() => { setCsvText(""); setCsvFileName(""); if (fileRef.current) fileRef.current.value = ""; }} data-testid="button-clear-import"><X size={16} /></button></div>
        <div className="stock-import-rules"><Check size={14} /> Campos opcionais vazios são omitidos para preservar os valores atuais. Tags usam | e atributos/dimensões usam JSON.</div>
        {importing.errors.length > 0 && <div className="stock-validation" data-testid="stock-import-errors"><strong>Corrija antes de importar</strong><ul>{importing.errors.slice(0, 8).map((issue, i) => <li key={`${issue}-${i}`}>{issue}</li>)}</ul>{importing.errors.length > 8 && <small>+ {importing.errors.length - 8} problemas adicionais</small>}</div>}
        {importing.items.length > 0 && <div className="stock-preview-table"><table><thead><tr><th>SKU</th><th>Produto</th><th>Variante</th><th>Preço</th><th>Saldo</th></tr></thead><tbody>{importing.items.slice(0, 5).map((item, i) => <tr key={`${item.sku}-${i}`}><td>{item.sku}</td><td>{item.productName}</td><td>{item.variantName}</td><td>{money(item.price)}</td><td>{item.availableStock}</td></tr>)}</tbody></table>{importing.items.length > 5 && <small>Mais {importing.items.length - 5} linhas válidas na prévia.</small>}</div>}
        <div className="stock-import-actions"><span>Corresponder por SKU · Não exclui registros</span><button className="stock-button" disabled={!importing.items.length || importing.errors.length > 0 || importer.isPending} onClick={submitImport} data-testid="button-confirm-stock-import">{importer.isPending ? "Importando…" : `Importar ${importing.items.length} linhas`}</button></div>
      </div>}
     </section>}
     {canAdjust && selected && <div className="stock-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSelected(null); }}><section className="stock-modal" role="dialog" aria-modal="true" aria-labelledby="stock-action-title" data-testid="stock-action-dialog">
      <header><div><span className="stock-overline">{action === "adjust" ? "AJUSTE DE INVENTÁRIO" : action === "inbound" ? "ENTRADA DE ESTOQUE" : "SAÍDA DE ESTOQUE"}</span><h3 id="stock-action-title">{action === "adjust" ? "Definir saldo disponível" : `Registrar ${action === "inbound" ? "entrada" : "saída"}`}</h3><p>{selected.productName} · {selected.variantName} · {selected.sku}</p></div><button onClick={() => setSelected(null)} aria-label="Fechar" data-testid="button-close-stock-dialog"><X size={17} /></button></header>
      <div className="stock-modal-balance"><div><span>Disponível</span><strong>{selected.availableStock}</strong></div><div><span>Em mãos</span><strong>{selected.stockOnHand}</strong></div><div><span>Reservado</span><strong>{selected.reservedStock}</strong></div></div>
      <form onSubmit={submitAction} className="stock-action-form"><label>{action === "adjust" ? "Novo saldo disponível (unidades)" : "Quantidade (unidades)"}<input autoFocus className="field" type="number" min={action === "adjust" ? 0 : 1} step="1" required value={count} onChange={event => setCount(event.target.value)} data-testid="input-stock-action-count" /></label><label>Motivo obrigatório<textarea className="field" minLength={3} maxLength={240} required rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder="Ex.: conferência física do depósito" data-testid="input-stock-action-reason" /></label><p>O registro fica no histórico de estoque. Quantidades reservadas não são alteradas por este ajuste.</p><div className="stock-action-buttons"><button type="button" className="stock-button stock-button-quiet" onClick={() => setSelected(null)} data-testid="button-cancel-stock-action">Cancelar</button><button className="stock-button" disabled={adjust.isPending || movement.isPending || reason.trim().length < 3 || !count} data-testid="button-submit-stock-action">{adjust.isPending || movement.isPending ? "Registrando…" : action === "adjust" ? "Salvar ajuste" : "Registrar movimentação"}</button></div></form>
    </section></div>}
  </div>;
}
