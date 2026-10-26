import assert from "node:assert/strict";
import test from "node:test";
import { buildOrderEmailMessage } from "./email-content.ts";

const event = {
  id: "00000000-0000-4000-8000-000000000001",
  recipient: "cliente@example.com",
  subject: "Pedido 88-123 registrado",
};

test("order creation with pending manual PIX never says payment was received or paid", () => {
  const message = buildOrderEmailMessage({
    ...event,
    eventType: "order_created",
    payload: { orderNumber: "88-123", total: 159.9, paymentStatus: "pending" },
  });

  assert.match(message.text, /aguardando confirmação manual/i);
  assert.match(message.text, /ainda não validou o pagamento/i);
  assert.doesNotMatch(message.text, /pix (?:foi )?recebido|pagamento (?:foi )?confirmado|pedido (?:foi )?pago/i);
});

test("a pending status update does not describe PIX as confirmed", () => {
  const message = buildOrderEmailMessage({
    ...event,
    eventType: "order_status_updated",
    payload: {
      orderNumber: "88-123",
      toStatus: "awaiting_payment",
      toPaymentStatus: "pending",
    },
  });

  assert.match(message.text, /continua aguardando confirmação manual/i);
  assert.doesNotMatch(message.text, /pagamento confirmado|pix recebido|pedido pago/i);
});

test("a payment update says it was manually confirmed only when the state is paid", () => {
  const message = buildOrderEmailMessage({
    ...event,
    eventType: "order_status_updated",
    payload: {
      orderNumber: "88-123",
      toStatus: "paid",
      toPaymentStatus: "paid",
    },
  });

  assert.match(message.text, /confirmado manualmente/i);
});

test("a pickup status update tells the customer the order was picked up", () => {
  const message = buildOrderEmailMessage({
    ...event,
    eventType: "order_status_updated",
    payload: {
      orderNumber: "88-123",
      toStatus: "picked_up",
      toPaymentStatus: "paid",
    },
  });

  assert.match(message.text, /pedido 88-123 foi atualizado: retirado/i);
});

test("price-drop messages state both effective prices", () => {
  const message = buildOrderEmailMessage({
    ...event,
    eventType: "price_drop",
    payload: { productName: "Camiseta Rádio 88", previousPrice: 129.9, currentPrice: 99.9 },
  });

  assert.match(message.text, /Camiseta Rádio 88/);
  assert.match(message.text, /R\$\s?129,90/);
  assert.match(message.text, /R\$\s?99,90/);
  assert.match(message.html, /aceitou receber comunicações comerciais/);
});

test("price-drop message identifies the option whose price fell", () => {
  const message = buildOrderEmailMessage({
    ...event,
    eventType: "price_drop",
    payload: {
      productName: "Camiseta Rádio 88",
      variantName: "Tamanho M",
      previousPrice: 129.9,
      currentPrice: 99.9,
    },
  });

  assert.match(message.text, /Camiseta Rádio 88 — Tamanho M/);
  assert.match(message.text, /R\$\s?129,90/);
  assert.match(message.text, /R\$\s?99,90/);
});
