import type { AuditEvent } from "@workspace/api-client-react";
import { Activity } from "lucide-react";

const actionLabels: Record<string, string> = {
  "category.created": "Categoria criada",
  "category.updated": "Categoria atualizada",
  "category.archived": "Categoria arquivada",
  "homepage.banner.updated": "Banner da vitrine atualizado",
  "order.created": "Pedido criado",
  "order.cancelled": "Pedido cancelado",
  "order.status_updated": "Pedido atualizado",
  "product.created": "Produto criado",
  "product.updated": "Produto atualizado",
  "product.archived": "Produto arquivado",
  "product.bulk_status_updated": "Situação dos produtos alterada",
  "product_line.created": "Linha de produtos criada",
  "product_line.updated": "Linha de produtos atualizada",
  "product_line.archived": "Linha de produtos arquivada",
  "profile.anonymized": "Dados da conta removidos",
  "role.created": "Função de acesso criada",
  "role.updated": "Função de acesso atualizada",
  "stock.adjusted": "Estoque ajustado",
  "stock.inbound": "Entrada de estoque registrada",
  "stock.outbound": "Saída de estoque registrada",
  "user.role_updated": "Acesso de uma pessoa atualizado",
  "user.roles_updated": "Funções de acesso atualizadas",
  "variant.created": "Variação de produto criada",
  "variant.updated": "Variação de produto atualizada",
};

const entityLabels: Record<string, string> = {
  category: "Categoria",
  homepage_banner: "Banner",
  order: "Pedido",
  product: "Produto",
  product_line: "Linha de produtos",
  product_variant: "Variação de produto",
  profile: "Conta",
  store_role: "Função de acesso",
};

const fieldLabels: Record<string, string> = {
  active: "situação",
  categoryId: "categoria",
  description: "descrição",
  featured: "destaque",
  imageUrl: "imagem",
  lineId: "linha de produto",
  name: "nome",
  paymentStatus: "pagamento",
  price: "preço",
  promotionEndsAt: "fim da promoção",
  promotionStartsAt: "início da promoção",
  role: "função",
  status: "situação",
  title: "título",
  trackingCode: "código de rastreio",
};

const statusLabels: Record<string, string> = {
  active: "Ativo",
  archived: "Arquivado",
  awaiting_payment: "Aguardando pagamento",
  cancelled: "Cancelado",
  delivered: "Entregue",
  failed: "Falhou",
  hidden: "Oculto",
  inactive: "Inativo",
  paid: "Pago",
  packing: "Em separação",
  picked_up: "Retirado",
  pending: "Pendente",
  refunded: "Reembolsado",
  returned: "Devolvido",
  shipped: "Enviado",
};

const ignoredKey = /(?:^id$|id$|_id$|^actor|^userId$)/i;
const uuidValue = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const privateIdValue = /^(?:user|org|sess|clerk)_[A-Za-z0-9_-]{6,}$/;

function parseDetails(details: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(details);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function safeText(value: unknown): string | null {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text || uuidValue.test(text) || privateIdValue.test(text)) return null;
    return text;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return null;
}

function formatDetails(details: string): string {
  const record = parseDetails(details);
  if (!record) {
    const text = details.trim();
    return text && !text.startsWith("{") && !text.startsWith("[") && !uuidValue.test(text) && !privateIdValue.test(text)
      ? text
      : "As alterações foram registradas.";
  }

  const parts: string[] = [];
  const itemName = safeText(record.productName) ?? safeText(record.orderNumber) ??
    safeText(record.roleName) ?? safeText(record.name) ?? safeText(record.sku);
  if (itemName) parts.push(itemName);

  for (const key of ["status", "paymentStatus", "role", "active"]) {
    const value = safeText(record[key]);
    if (value) parts.push(`${fieldLabels[key] ?? key}: ${statusLabels[value] ?? value}`);
  }

  const quantity = safeText(record.quantity) ?? safeText(record.delta);
  if (quantity) parts.push(`Quantidade: ${quantity}`);

  const reason = safeText(record.reason);
  if (reason) parts.push(`Motivo: ${reason}`);

  const fieldList = Array.isArray(record.changedFields) ? record.changedFields :
    Array.isArray(record.fields) ? record.fields : [];
  const fields = fieldList
    .filter((field): field is string => typeof field === "string")
    .map((field) => fieldLabels[field] ?? field.replace(/([A-Z])/g, " $1").toLocaleLowerCase("pt-BR"))
    .filter((field) => !ignoredKey.test(field));
  if (fields.length) parts.push(`Campos: ${fields.join(", ")}`);

  if (typeof record.permissionCount === "number") parts.push(`${record.permissionCount} permissões`);
  if (typeof record.updatedCount === "number") parts.push(`${record.updatedCount} produtos`);
  return parts.join(" · ") || "As alterações foram registradas.";
}

function eventTitle(action: string) {
  return actionLabels[action] ?? "Atividade administrativa registrada";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data indisponível"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function AdminActivity({ events }: { events: AuditEvent[] }) {
  if (!events.length) {
    return <p className="mt-3 rounded-[20px] border border-dashed p-6 text-sm text-muted-foreground">Nenhuma atividade registrada.</p>;
  }

  return <ol className="mt-4 grid gap-3" aria-label="Atividade administrativa">
    {events.map((event) => (
      <li key={event.id} className="flex gap-3 rounded-[20px] border border-border/70 bg-card p-4 shadow-soft">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-foreground" aria-hidden="true">
          <Activity size={17} />
        </span>
        <article className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <div>
              <h3 className="text-sm font-bold">{eventTitle(event.action)}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {event.actorName || "Equipe"}{entityLabels[event.entityType] ? ` · ${entityLabels[event.entityType]}` : ""}
              </p>
            </div>
            <time className="text-xs text-muted-foreground" dateTime={event.createdAt}>{formatDate(event.createdAt)}</time>
          </div>
          <p className="mt-2 break-words text-sm leading-6">{formatDetails(event.details)}</p>
        </article>
      </li>
    ))}
  </ol>;
}
