export interface OrderEmailEvent {
  id: string;
  recipient: string;
  eventType: string;
  subject: string;
  payload: Record<string, unknown>;
}

export interface OrderEmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const orderStatuses: Record<string, string> = {
  awaiting_payment: "aguardando confirmação do pagamento",
  paid: "pagamento confirmado",
  packing: "em preparação",
  shipped: "enviado",
  delivered: "entregue",
  picked_up: "retirado",
  cancelled: "cancelado",
  returned: "devolvido",
};

function textValue(payload: Record<string, unknown>, key: string, fallback: string): string {
  const value = payload[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character]!;
  });
}

function amountInBrl(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "consulte o pedido";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(amount);
}

function htmlDocument(
  title: string,
  paragraphs: string[],
  footer = "Esta é uma mensagem automática sobre seu pedido.",
): string {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f5f2eb;font-family:Arial,sans-serif;color:#202019"><main style="max-width:600px;margin:32px auto;padding:32px;background:#fff;border-radius:16px"><p style="color:#a72d24;font-weight:bold;letter-spacing:.08em">RÁDIO 88 FM</p><h1 style="font-size:24px">${escapeHtml(title)}</h1>${paragraphs.map((paragraph) => `<p style="line-height:1.6">${escapeHtml(paragraph)}</p>`).join("")}<p style="margin-top:28px;color:#666;font-size:13px">${escapeHtml(footer)}</p></main></body></html>`;
}

export function buildOrderEmailMessage(event: OrderEmailEvent): OrderEmailMessage {
  const orderNumber = textValue(event.payload, "orderNumber", "da loja");

  if (event.eventType === "order_created") {
    const total = amountInBrl(event.payload["total"]);
    const text = [
      `Seu pedido ${orderNumber} foi registrado.`,
      `Total: ${total}.`,
      "Pagamento: aguardando confirmação manual.",
      "A equipe da Rádio 88 FM ainda não validou o pagamento. Aguarde as instruções oficiais antes de transferir.",
    ].join("\n\n");

    return {
      to: event.recipient,
      subject: event.subject,
      text,
      html: htmlDocument(`Pedido ${orderNumber} registrado`, text.split("\n\n")),
    };
  }

  if (event.eventType === "price_drop") {
    const productName = textValue(event.payload, "productName", "um produto da loja");
    const variantName = textValue(event.payload, "variantName", "");
    const previousPrice = amountInBrl(event.payload["previousPrice"]);
    const currentPrice = amountInBrl(event.payload["currentPrice"]);
    const text = `${productName}${variantName ? ` — ${variantName}` : ""}: o preço caiu de ${previousPrice} para ${currentPrice}.`;
    return {
      to: event.recipient,
      subject: event.subject,
      text,
      html: htmlDocument(
        "O preço baixou",
        [text],
        "Você recebe este aviso porque aceitou receber comunicações comerciais. Atualize suas preferências na sua conta para deixar de receber alertas de preço.",
      ),
    };
  }

  if (event.eventType === "fiscal_invoice_authorized") {
    const text = [
      `A nota fiscal do pedido ${orderNumber} foi autorizada.`,
      "O DANFE e o XML seguem anexos a esta mensagem.",
    ].join("\n\n");
    return {
      to: event.recipient,
      subject: event.subject,
      text,
      html: htmlDocument(`Nota fiscal do pedido ${orderNumber}`, text.split("\n\n")),
    };
  }

  if (event.eventType !== "order_status_updated") {
    throw new Error(`Unsupported email event type: ${event.eventType}`);
  }

  const paymentStatus = textValue(event.payload, "toPaymentStatus", "pending");
  const orderStatus = textValue(event.payload, "toStatus", "awaiting_payment");
  const safeOrderStatus =
    orderStatus === "paid" && paymentStatus !== "paid"
      ? "atualizado"
      : orderStatuses[orderStatus] ?? "atualizado";
  const paymentMessage =
    paymentStatus === "paid"
      ? "Pagamento confirmado manualmente pela equipe da Rádio 88 FM."
      : paymentStatus === "refunded"
        ? "O pagamento foi devolvido."
        : paymentStatus === "failed"
          ? "O pagamento não foi confirmado."
          : "O pagamento continua aguardando confirmação manual.";
  const trackingCode = textValue(event.payload, "trackingCode", "");
  const text = [
    `O pedido ${orderNumber} foi atualizado: ${safeOrderStatus}.`,
    paymentMessage,
    ...(trackingCode ? [`Código de rastreio: ${trackingCode}.`] : []),
  ].join("\n\n");

  return {
    to: event.recipient,
    subject: event.subject,
    text,
    html: htmlDocument(`Atualização do pedido ${orderNumber}`, text.split("\n\n")),
  };
}
