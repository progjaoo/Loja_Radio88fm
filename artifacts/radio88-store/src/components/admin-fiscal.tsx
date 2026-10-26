import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Download, RefreshCw, Save, ShieldCheck, Truck, Upload } from "lucide-react";
import { ErrorState, Loading, Notice } from "@/components/feedback";
import { useCan } from "@/components/admin-permissions";

type FiscalSettings = {
  issuerLegalName: string | null;
  issuerTradeName: string | null;
  issuerCnpj: string | null;
  stateRegistration: string | null;
  stateTaxId: string | null;
  taxRegime: string | null;
  municipalityCode: string | null;
  issuerAddress: Record<string, string> | null;
  defaultCfop: string | null;
  invoiceSeries: number | null;
  invoiceDefaults: Record<string, unknown> | null;
  nfeioPaymentMethod: string | null;
  nfeioPaymentType: string | null;
  nfeioPaymentMappingConfirmed: boolean;
  nfeioTestSetupConfirmed: boolean;
  nfeioCertificateConfirmed: boolean;
};
type FiscalDocument = {
  id: string;
  mode: "manual" | "nfeio";
  status: string;
  environment: string;
  invoiceNumber: string | null;
  series: string | null;
  accessKey: string | null;
  rejectionReason: string | null;
  exemptionReason: string | null;
  cancellationReason: string | null;
  xmlObjectPath: string | null;
  danfeObjectPath: string | null;
};
type FiscalRecipient = {
  taxNumber: string;
  legalName: string;
  email: string;
  address: {
    postalCode: string;
    street: string;
    number: string;
    complement: string | null;
    neighborhood: string;
    city: string;
    state: string;
    municipalityCode: string;
  };
};
type FiscalOrder = {
  order: {
    id: string;
    orderNumber: string;
    createdAt: string;
    status: string;
    paymentStatus: string;
    shippingMethod: string;
    subtotalCents: number;
    shippingFeeCents: number;
    totalCents: number;
    customerEmail: string | null;
    shippingLabelStatus: string | null;
    superfreteLabelId: string | null;
    shippingLabelAttempted: boolean;
    trackingCode: string | null;
  };
  document: FiscalDocument | null;
  recipient: FiscalRecipient | null;
  lines: { productName: string; variantName: string; sku: string; quantity: number; unitPriceCents: number; originalUnitPriceCents: number }[];
};
type FiscalDashboard = {
  settings: FiscalSettings | null;
  mode: string;
  nfeioApiConfigured: boolean;
  webhookConfigured: boolean;
  webhookPath: string;
  orders: FiscalOrder[];
  categories: { id: string; name: string }[];
};
type FiscalProfiles = {
  taxRegime: string | null;
  taxRegimeKind: "simples" | "normal" | "unknown";
  mode: string;
  canEditAdvanced: boolean;
  products: {
    product: { id: string; name: string; categoryId: string | null; sku: string; effectiveCfop: string | null };
    profile: null | {
      ncm: string; origin: string; unit: string; taxUnit: string; cest: string | null; cfop: string | null;
      taxPayload?: Record<string, unknown> | null;
    };
    taxFields: GuidedFiscalTaxFields;
    complete: boolean;
    missing: string[];
  }[];
  categories: { category: { id: string; name: string }; rule: null | {
    cfop: string | null; taxPayload?: Record<string, unknown>; taxConfigured: boolean;
  } }[];
};

type GuidedFiscalTaxFields = {
  icmsCode: string; icmsBaseTax: string; icmsRate: string; icmsAmount: string;
  pisCst: string; pisBaseTax: string; pisRate: string; pisAmount: string;
  cofinsCst: string; cofinsBaseTax: string; cofinsRate: string; cofinsAmount: string;
  ipiCst: string; ipiBaseTax: string; ipiRate: string; ipiAmount: string;
  ibsCbsSituationCode: string; ibsCbsClassCode: string; ibsCbsBasis: string;
  ibsStateRate: string; ibsStateAmount: string; ibsMunicipalRate: string; ibsMunicipalAmount: string;
  cbsRate: string; cbsAmount: string;
};

const emptyGuidedFiscalTaxFields: GuidedFiscalTaxFields = {
  icmsCode: "", icmsBaseTax: "", icmsRate: "", icmsAmount: "",
  pisCst: "", pisBaseTax: "", pisRate: "", pisAmount: "",
  cofinsCst: "", cofinsBaseTax: "", cofinsRate: "", cofinsAmount: "",
  ipiCst: "", ipiBaseTax: "", ipiRate: "", ipiAmount: "",
  ibsCbsSituationCode: "", ibsCbsClassCode: "", ibsCbsBasis: "",
  ibsStateRate: "", ibsStateAmount: "", ibsMunicipalRate: "", ibsMunicipalAmount: "",
  cbsRate: "", cbsAmount: "",
};

const paymentMethods = [
  ["", "Selecionar após confirmação contábil"],
  ["Cash", "Dinheiro"], ["Cheque", "Cheque"], ["CreditCard", "Cartão de crédito"],
  ["DebitCard", "Cartão de débito"], ["StoreCredict", "Crédito da loja"],
  ["FoodVouchers", "Vale-alimentação"], ["MealVouchers", "Vale-refeição"],
  ["GiftVouchers", "Vale-presente"], ["FuelVouchers", "Vale-combustível"],
  ["BankBill", "Boleto"], ["BankDeposit", "Depósito"],
  ["InstantPayment", "Pagamento instantâneo (confirmar antes de usar para PIX)"],
  ["WireTransfer", "Transferência"], ["Cashback", "Cashback"], ["WithoutPayment", "Sem pagamento"], ["Others", "Outro"],
];
const paymentTypes = [["", "Selecionar após confirmação contábil"], ["InCash", "À vista"], ["Term", "A prazo"]];
const statusLabels: Record<string, string> = {
  pending: "Pendente", processing: "Em processamento", authorized: "Autorizada",
  rejected: "Rejeitada", cancelled: "Cancelada", exempt: "Exceção registrada",
  submission_unknown: "Resultado incerto — não reenviar",
};
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

async function fiscalRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string") headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers, credentials: "include" });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || "Não foi possível concluir a operação fiscal.");
  return body as T;
}

async function uploadFiscalFile(file: File, kind: "xml" | "pdf"): Promise<string> {
  const signed = await fiscalRequest<{ uploadURL: string; objectPath: string }>("/api/admin/fiscal/uploads", {
    method: "POST", body: JSON.stringify({ kind }),
  });
  const response = await fetch(signed.uploadURL, {
    method: "PUT",
    headers: { "Content-Type": kind === "pdf" ? "application/pdf" : "application/xml" },
    body: file,
    credentials: "omit",
  });
  if (!response.ok) throw new Error(`O envio do arquivo ${kind.toUpperCase()} falhou.`);
  return signed.objectPath;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-[24px] bg-card p-5 shadow-soft"><h2 className="display text-xl">{title}</h2><div className="mt-4">{children}</div></section>;
}
function TextField({ label, value, onChange, required = false, maxLength, type = "text", testId, hint, inputMode }: {
  label: string; value: string; onChange: (value: string) => void; required?: boolean; maxLength?: number; type?: string; testId?: string; hint?: string;
  inputMode?: "text" | "numeric" | "decimal" | "email" | "tel" | "url" | "search" | "none";
}) {
  return <label className="grid gap-1.5 text-xs font-bold">{label}<input className="field" type={type} inputMode={inputMode ?? (type === "email" ? "email" : undefined)} autoComplete={type === "email" ? "email" : undefined} data-testid={testId} value={value} required={required} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />{hint && <span className="text-[11px] font-normal leading-4 text-muted-foreground">{hint}</span>}</label>;
}

function FiscalSettingsPanel({ dashboard, canManage, refresh }: { dashboard: FiscalDashboard; canManage: boolean; refresh: () => Promise<unknown> }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [defaultsJson, setDefaultsJson] = useState("{}");
  const [issuerAddressJson, setIssuerAddressJson] = useState("{}");
  const [a1Confirmed, setA1Confirmed] = useState(false);
  const [paymentMappingConfirmed, setPaymentMappingConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const settings = dashboard.settings;
  useEffect(() => {
    if (!settings) return;
    setForm({
      issuerLegalName: settings.issuerLegalName ?? "", issuerTradeName: settings.issuerTradeName ?? "",
      issuerCnpj: settings.issuerCnpj ?? "", stateRegistration: settings.stateRegistration ?? "",
      stateTaxId: settings.stateTaxId ?? "", taxRegime: settings.taxRegime ?? "",
      municipalityCode: settings.municipalityCode ?? "", defaultCfop: settings.defaultCfop ?? "",
      invoiceSeries: settings.invoiceSeries == null ? "" : String(settings.invoiceSeries),
      nfeioPaymentMethod: settings.nfeioPaymentMethod ?? "", nfeioPaymentType: settings.nfeioPaymentType ?? "",
    });
    setDefaultsJson(JSON.stringify(settings.invoiceDefaults ?? {}, null, 2));
    setIssuerAddressJson(JSON.stringify(settings.issuerAddress ?? {}, null, 2));
  }, [settings]);
  const set = (key: string, value: string) => setForm(current => ({ ...current, [key]: value }));
  const fields: [string, string, number?][] = [
    ["issuerLegalName", "Razão social", 180], ["issuerTradeName", "Nome fantasia", 180],
    ["issuerCnpj", "CNPJ do emitente", 18], ["stateRegistration", "Inscrição estadual", 32],
    ["stateTaxId", "Identificador estadual NFE.io", 128], ["taxRegime", "Regime tributário informado pelo contador", 64],
    ["municipalityCode", "Código IBGE do município", 7], ["defaultCfop", "CFOP padrão", 4],
    ["invoiceSeries", "Série da NF-e", 3],
  ];
  const save = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setSuccess("");
    let invoiceDefaults: Record<string, unknown>;
    let issuerAddress: Record<string, string>;
    try {
      const value: unknown = JSON.parse(defaultsJson || "{}");
      if (!value || Array.isArray(value) || typeof value !== "object") throw new Error();
      invoiceDefaults = value as Record<string, unknown>;
    } catch {
      setError("Os campos complementares precisam ser um objeto JSON válido.");
      return;
    }
    try {
      const value: unknown = JSON.parse(issuerAddressJson || "{}");
      if (!value || Array.isArray(value) || typeof value !== "object" ||
          Object.values(value).some(item => typeof item !== "string")) throw new Error();
      issuerAddress = value as Record<string, string>;
    } catch {
      setError("O endereço do emitente precisa ser um objeto JSON com valores de texto.");
      return;
    }
    try {
      await fiscalRequest("/api/admin/fiscal/settings", {
        method: "PUT",
        body: JSON.stringify({
          ...Object.fromEntries(fields.map(([key]) => [key, form[key]?.trim() || null])),
          invoiceSeries: form.invoiceSeries ? Number(form.invoiceSeries) : null,
          issuerAddress: Object.keys(issuerAddress).length ? issuerAddress : null,
          invoiceDefaults,
          nfeioPaymentMethod: form.nfeioPaymentMethod || null,
          nfeioPaymentType: form.nfeioPaymentType || null,
        }),
      });
      setSuccess("Configurações fiscais salvas.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar as configurações.");
    }
  };
  const verifyTest = async () => {
    setError(""); setSuccess("");
    try {
      await fiscalRequest("/api/admin/fiscal/nfeio/verify-test-setup", {
        method: "POST", body: JSON.stringify({ accountantConfirmedA1: a1Confirmed }),
      });
      setSuccess("Cadastro estadual verificado em Teste; certificado A1 confirmado.");
      setA1Confirmed(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível verificar o ambiente de teste.");
    }
  };
  const confirmPaymentMapping = async () => {
    setError(""); setSuccess("");
    if (!settings || form.nfeioPaymentMethod !== settings.nfeioPaymentMethod ||
        form.nfeioPaymentType !== settings.nfeioPaymentType) {
      setError("Salve o método e o tipo escolhidos pelo contador antes de confirmar.");
      return;
    }
    try {
      await fiscalRequest("/api/admin/fiscal/nfeio/confirm-payment-mapping", {
        method: "POST", body: JSON.stringify({ accountantConfirmedMapping: paymentMappingConfirmed }),
      });
      setSuccess("Mapeamento de pagamento confirmado pelo contador.");
      setPaymentMappingConfirmed(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível confirmar o mapeamento.");
    }
  };
  return <Panel title="Emitente e ambiente">
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl bg-muted p-4"><div className="flex items-center gap-2 text-sm font-bold"><ShieldCheck size={17} />Modo fiscal: {dashboard.mode === "nfeio" ? "NFE.io" : "Manual"}</div><p className="mt-1 text-xs text-muted-foreground">A integração, quando ativa, usa somente o ambiente de homologação. Credenciais nunca são exibidas no painel.</p></div>
      <div className="rounded-2xl bg-muted p-4 text-sm"><div className="font-bold">NFE.io: {dashboard.nfeioApiConfigured ? "credenciais configuradas" : "credenciais ausentes"}</div><div className="mt-1 text-xs text-muted-foreground">Webhook: {dashboard.webhookConfigured ? "configurado" : "não configurado"} · {dashboard.webhookPath}</div></div>
    </div>
    <form onSubmit={save} className="mt-5 grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([key, label, max]) =>
        <TextField key={key} label={label} value={form[key] ?? ""} maxLength={max} required={key === "issuerLegalName"} onChange={value => set(key, value)} />)}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs font-bold">Método de pagamento informado à NFE.io
          <select className="field" value={form.nfeioPaymentMethod ?? ""} onChange={event => set("nfeioPaymentMethod", event.target.value)}>
            {paymentMethods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5 text-xs font-bold">Tipo de pagamento
          <select className="field" value={form.nfeioPaymentType ?? ""} onChange={event => set("nfeioPaymentType", event.target.value)}>
            {paymentTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <label className="grid gap-1.5 text-xs font-bold">Campos complementares NFE.io definidos pelo contador (JSON)
        <textarea className="field min-h-32 font-mono text-xs" value={defaultsJson} onChange={event => setDefaultsJson(event.target.value)} />
      </label>
      <label className="grid gap-1.5 text-xs font-bold">Endereço do emitente (JSON)
        <textarea className="field min-h-24 font-mono text-xs" value={issuerAddressJson} onChange={event => setIssuerAddressJson(event.target.value)} />
      </label>
      <p className="text-xs text-muted-foreground">Não informe itens, comprador, pagamento, ambiente ou campos de cálculo de impostos. O sistema usa apenas os tributos fornecidos nos perfis fiscais.</p>
      <button className="button w-fit" type="submit" disabled={!canManage}><Save size={16} />Salvar dados fiscais</button>
    </form>
    {dashboard.mode === "nfeio" && <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm">
      <div className="flex items-center gap-2 font-bold"><AlertTriangle size={16} />Homologação bloqueada até a validação contábil</div>
      <p className="mt-1 text-xs">A emissão de teste exige cadastro estadual ativo em Teste, CNPJ correspondente e certificado A1 no ambiente de Teste. O envio de PIX só será habilitado após confirmação do método e do tipo pelo contador.</p>
      <label className="mt-3 flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={a1Confirmed} onChange={event => setA1Confirmed(event.target.checked)} disabled={!canManage} /><span>O contador confirmou que o certificado A1 está instalado no ambiente de Teste da NFE.io.</span></label>
      <button type="button" className="button button-outline mt-3" onClick={verifyTest} disabled={!canManage || !a1Confirmed}>Verificar cadastro de teste</button>
      {settings?.nfeioTestSetupConfirmed && settings?.nfeioCertificateConfirmed && <span className="ml-3 text-xs font-bold text-green-700">Verificação concluída</span>}
      <label className="mt-4 flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={paymentMappingConfirmed} onChange={event => setPaymentMappingConfirmed(event.target.checked)} disabled={!canManage} /><span>O contador confirmou o método e o tipo de pagamento para a integração, inclusive o equivalente ao PIX manual.</span></label>
      <button type="button" className="button button-outline mt-3" onClick={confirmPaymentMapping} disabled={!canManage || !paymentMappingConfirmed}>Confirmar mapeamento do pagamento</button>
      {settings?.nfeioPaymentMappingConfirmed && <span className="ml-3 text-xs font-bold text-green-700">Mapeamento confirmado</span>}
    </div>}
    {error && <Notice text={error} />}{success && <div className="flex items-center gap-2 text-sm text-green-700" role="status"><Check size={16} />{success}</div>}
  </Panel>;
}

function ProductProfileRow({ entry, canManage, regimeKind, mode, canEditAdvanced, refresh }: {
  entry: FiscalProfiles["products"][number];
  canManage: boolean;
  regimeKind: FiscalProfiles["taxRegimeKind"];
  mode: string;
  canEditAdvanced: boolean;
  refresh: () => Promise<unknown>;
}) {
  const p = entry.profile;
  const [values, setValues] = useState({
    ncm: "", origin: "", unit: "", taxUnit: "", cest: "", cfop: "",
    ...emptyGuidedFiscalTaxFields,
  });
  const [taxPayloadJson, setTaxPayloadJson] = useState("{}");
  const [advancedMode, setAdvancedMode] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setValues({
      ncm: p?.ncm ?? "",
      origin: p?.origin ?? "",
      unit: p?.unit ?? "",
      taxUnit: p?.taxUnit ?? "",
      cest: p?.cest ?? "",
      cfop: p?.cfop ?? entry.product.effectiveCfop ?? "",
      ...(entry.taxFields ?? emptyGuidedFiscalTaxFields),
    });
    setTaxPayloadJson(JSON.stringify(p?.taxPayload ?? {}, null, 2));
    setAdvancedMode(false);
  }, [entry, p]);
  const set = (key: keyof typeof values, value: string) => setValues(current => ({ ...current, [key]: value }));
  const save = async () => {
    setError("");
    setSaving(true);
    try {
      const request: Record<string, unknown> = {
        ncm: values.ncm,
        origin: values.origin,
        unit: values.unit,
        taxUnit: values.taxUnit,
        cest: values.cest || null,
        cfop: values.cfop || null,
        taxFields: Object.fromEntries(Object.keys(emptyGuidedFiscalTaxFields).map(key => [
          key,
          values[key as keyof typeof values],
        ])),
      };
      if (advancedMode) {
        const payload: unknown = JSON.parse(taxPayloadJson || "{}");
        if (!payload || Array.isArray(payload) || typeof payload !== "object") {
          throw new Error("O JSON avançado deve ser um objeto.");
        }
        request.advancedTaxPayload = payload;
      }
      await fiscalRequest(`/api/admin/fiscal/profiles/products/${entry.product.id}`, {
        method: "PUT", body: JSON.stringify(request),
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar o perfil do produto.");
    } finally {
      setSaving(false);
    }
  };
  const taxInput = (key: keyof GuidedFiscalTaxFields, label: string, hint: string, maxLength?: number, decimal = false) =>
    <TextField key={key} label={label} value={values[key]} onChange={value => set(key, value)} hint={hint} maxLength={maxLength} inputMode={decimal ? "decimal" : "text"} />;
  const icmsCodeLabel = regimeKind === "simples"
    ? "CSOSN (3 dígitos)"
    : regimeKind === "normal" ? "CST do ICMS (2 dígitos)" : "CST/CSOSN do ICMS";
  const icmsCodeHint = regimeKind === "unknown"
    ? "Confirme o regime tributário da empresa antes de preencher este campo."
    : regimeKind === "simples"
      ? "Código CSOSN definido pelo contador para o Simples Nacional."
      : "Código CST definido pelo contador para o regime normal.";
  return <details className="rounded-2xl border border-border/70 p-4">
    <summary className="cursor-pointer text-sm font-bold">
      {entry.product.name}
      <span className="ml-2 text-xs font-normal text-muted-foreground">{entry.complete ? "Perfil fiscal completo" : "Perfil fiscal pendente"}</span>
      {!entry.complete && <span className="ml-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">Pendente</span>}
      {entry.complete && <span className="ml-2 inline-flex rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-800">Completo</span>}
    </summary>
    <div className="mt-4 grid gap-4">
      {!entry.complete && <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950" role="status">
        <strong>Para liberar venda e emissão, complete:</strong> {entry.missing.join(" · ")}
      </div>}
      <section>
        <h3 className="text-sm font-bold">Identificação fiscal do produto</h3>
        <p className="mt-1 text-xs text-muted-foreground">Preencha com os dados aprovados pelo contador. O emissor é {mode === "nfeio" ? "NFE.io" : "manual"}; nenhum tributo será calculado aqui.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextField label="NCM (8 dígitos)" value={values.ncm} onChange={v => set("ncm", v)} maxLength={8} hint="Classificação fiscal da mercadoria, informada pelo contador." />
          <TextField label="Origem (0–8)" value={values.origin} onChange={v => set("origin", v)} maxLength={1} hint="Código de origem da mercadoria para o ICMS." />
          <TextField label="CEST (opcional)" value={values.cest} onChange={v => set("cest", v)} maxLength={7} hint="Informe 7 dígitos quando o produto estiver sujeito ao CEST." />
          <TextField label="Unidade comercial" value={values.unit} onChange={v => set("unit", v)} maxLength={6} hint="Unidade vendida na nota, por exemplo UN ou KG." />
          <TextField label="Unidade tributável" value={values.taxUnit} onChange={v => set("taxUnit", v)} maxLength={6} hint="Unidade usada no grupo tributário do item." />
          <TextField label="CFOP (4 dígitos)" value={values.cfop} onChange={v => set("cfop", v)} maxLength={4} hint="Código da operação informado pelo contador; vazio usa a regra da categoria ou padrão." />
        </div>
      </section>
      <section className="rounded-xl bg-muted/50 p-3">
        <h3 className="text-sm font-bold">ICMS</h3>
        <p className="mt-1 text-xs text-muted-foreground">A NFE.io recebe o código fiscal e os valores de base, alíquota e imposto. Digite somente o que o contador informou; deixe os três valores vazios se ele não se aplicar.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {taxInput("icmsCode", icmsCodeLabel, icmsCodeHint, regimeKind === "normal" ? 2 : 3)}
          {taxInput("icmsBaseTax", "Base do ICMS (R$)", "Valor da base informado pelo contador; não é calculado.", 24, true)}
          {taxInput("icmsRate", "Alíquota do ICMS (%)", "Percentual informado pelo contador; não é calculado.", 24, true)}
          {taxInput("icmsAmount", "Valor do ICMS (R$)", "Valor informado pelo contador; não é calculado.", 24, true)}
        </div>
      </section>
      <div className="grid gap-3 lg:grid-cols-2">
        {(["pis", "cofins"] as const).map(group => {
          const title = group === "pis" ? "PIS" : "COFINS";
          const prefix = group;
          return <section key={group} className="rounded-xl bg-muted/50 p-3">
            <h3 className="text-sm font-bold">{title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">CST e valores conforme orientação do contador, sem cálculo automático.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {taxInput(`${prefix}Cst` as keyof GuidedFiscalTaxFields, `CST de ${title}`, `Código de situação tributária de ${title}, informado pelo contador.`, 2)}
              {taxInput(`${prefix}BaseTax` as keyof GuidedFiscalTaxFields, `Base de ${title} (R$)`, `Valor da base informado pelo contador.`, 24, true)}
              {taxInput(`${prefix}Rate` as keyof GuidedFiscalTaxFields, `Alíquota de ${title} (%)`, `Percentual informado pelo contador.`, 24, true)}
              {taxInput(`${prefix}Amount` as keyof GuidedFiscalTaxFields, `Valor de ${title} (R$)`, `Valor informado pelo contador.`, 24, true)}
            </div>
          </section>;
        })}
      </div>
      <section className="rounded-xl bg-muted/50 p-3">
        <h3 className="text-sm font-bold">IPI (quando aplicável)</h3>
        <p className="mt-1 text-xs text-muted-foreground">Deixe vazio se o contador não indicar IPI para este produto.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {taxInput("ipiCst", "CST de IPI", "Código de situação tributária de IPI informado pelo contador.", 2)}
          {taxInput("ipiBaseTax", "Base de IPI (R$)", "Valor da base informado pelo contador.", 24, true)}
          {taxInput("ipiRate", "Alíquota de IPI (%)", "Percentual informado pelo contador.", 24, true)}
          {taxInput("ipiAmount", "Valor de IPI (R$)", "Valor informado pelo contador.", 24, true)}
        </div>
      </section>
      <section className="rounded-xl bg-muted/50 p-3">
        <h3 className="text-sm font-bold">IBS e CBS (Reforma Tributária)</h3>
        <p className="mt-1 text-xs text-muted-foreground">A NFE.io recebe situação, classificação e valores manuais. O modo é sempre Manual; não use serviço de cálculo automático.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {taxInput("ibsCbsSituationCode", "CST IBS/CBS (3 dígitos)", "Código de situação tributária informado pelo contador.", 3)}
          {taxInput("ibsCbsClassCode", "Classificação tributária (6 dígitos)", "Código compatível com o CST, fornecido pelo contador.", 6)}
          {taxInput("ibsCbsBasis", "Base IBS/CBS (R$)", "Base informada pelo contador; não é calculada.", 24, true)}
          {taxInput("ibsStateRate", "Alíquota IBS estadual (%)", "Percentual informado pelo contador.", 24, true)}
          {taxInput("ibsStateAmount", "Valor IBS estadual (R$)", "Valor informado pelo contador; não é calculado.", 24, true)}
          {taxInput("ibsMunicipalRate", "Alíquota IBS municipal (%)", "Percentual informado pelo contador.", 24, true)}
          {taxInput("ibsMunicipalAmount", "Valor IBS municipal (R$)", "Valor informado pelo contador; não é calculado.", 24, true)}
          {taxInput("cbsRate", "Alíquota CBS (%)", "Percentual informado pelo contador.", 24, true)}
          {taxInput("cbsAmount", "Valor CBS (R$)", "Valor informado pelo contador; não é calculado.", 24, true)}
        </div>
      </section>
      {canEditAdvanced && <details className="rounded-xl border border-border p-3">
        <summary className="cursor-pointer text-xs font-bold">JSON avançado (administradores)</summary>
        <p className="mt-2 text-xs text-muted-foreground">Use apenas quando o contador e a documentação da NFE.io exigirem campos fora do formulário. Os valores tributários continuam sendo informados pelo contador.</p>
        <label className="mt-3 grid gap-1.5 text-xs font-bold">Objeto tax da NFE.io<textarea className="field min-h-40 font-mono text-xs" value={taxPayloadJson} onChange={event => setTaxPayloadJson(event.target.value)} /></label>
        <label className="mt-3 flex items-start gap-2 text-xs"><input type="checkbox" checked={advancedMode} onChange={event => setAdvancedMode(event.target.checked)} /><span>Salvar usando o JSON avançado em vez dos campos guiados</span></label>
      </details>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="button button-outline" disabled={!canManage || saving || regimeKind === "unknown"} onClick={() => void save()}>
          <Save size={15} />{saving ? "Salvando…" : "Salvar perfil"}
        </button>
        {regimeKind === "unknown" && <span className="text-xs text-amber-800">Regime tributário não reconhecido. Confirme-o nas configurações do emitente antes de salvar.</span>}
        {error && <span className="text-xs text-destructive" role="alert">{error}</span>}
      </div>
    </div>
  </details>;
}

function FiscalProfilesPanel({ data, canManage, refresh }: { data: FiscalProfiles | undefined; canManage: boolean; refresh: () => Promise<unknown> }) {
  const [categoryValues, setCategoryValues] = useState<Record<string, { cfop: string; payload: string }>>({});
  const [error, setError] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<null | { imported: number; rejected: { row: number; product: string; reason: string }[] }>(null);
  useEffect(() => {
    if (!data) return;
    setCategoryValues(Object.fromEntries(data.categories.map(({ category, rule }) => [category.id, {
      cfop: rule?.cfop ?? "", payload: JSON.stringify(rule?.taxPayload ?? {}, null, 2),
    }])));
  }, [data]);
  const saveCategory = async (id: string) => {
    const form = categoryValues[id] ?? { cfop: "", payload: "{}" };
    setCategoryError("");
    try {
      let body: Record<string, unknown> = { cfop: form.cfop || null };
      if (data?.canEditAdvanced) {
        const taxPayload: unknown = JSON.parse(form.payload || "{}");
        if (!taxPayload || Array.isArray(taxPayload) || typeof taxPayload !== "object") throw new Error("Perfil tributário precisa ser um objeto JSON.");
        body = { ...body, taxPayload };
      }
      await fiscalRequest(`/api/admin/fiscal/profiles/categories/${id}`, {
        method: "PUT", body: JSON.stringify(body),
      });
      await refresh();
    } catch (cause) {
      setCategoryError(cause instanceof Error ? cause.message : "Não foi possível salvar a regra.");
    }
  };
  const downloadTemplate = async () => {
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/admin/fiscal/profiles/template.csv", { credentials: "include" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || "Não foi possível exportar o modelo.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "modelo-perfis-fiscais-produtos.csv";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível exportar o modelo.");
    } finally {
      setBusy(false);
    }
  };
  const importFile = async (file: File) => {
    setError("");
    setReport(null);
    if (file.size > 1_500_000) {
      setError("O CSV deve ter no máximo 1,5 MB.");
      return;
    }
    setBusy(true);
    try {
      const result = await fiscalRequest<{
        imported: number;
        rejected: { row: number; product: string; reason: string }[];
      }>("/api/admin/fiscal/profiles/import", {
        method: "POST",
        body: JSON.stringify({ csvText: await file.text() }),
      });
      setReport(result);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível importar a planilha.");
    } finally {
      setBusy(false);
    }
  };
  if (!data) return <Loading />;
  return <div className="grid gap-5">
    <Panel title="Perfis fiscais por produto">
      <p className="mb-3 text-xs text-muted-foreground">NCM, origem, CEST, unidades, CFOP e tributos vêm do contador. Nenhum imposto é calculado pelo sistema.</p>
      <div className="mb-4 rounded-xl bg-muted p-3 text-xs">
        <strong>Regime da empresa:</strong> {data.taxRegime || "não configurado"}
        <span className="ml-2">· Emissor: {data.mode === "nfeio" ? "NFE.io" : "Manual"}</span>
        {data.taxRegimeKind === "unknown" && <p className="mt-2 text-amber-900">O regime tributário não foi reconhecido. Confirme e atualize o valor nas configurações do emitente com o contador; enquanto isso, as vendas e emissões permanecem bloqueadas para evitar perfis incorretos.</p>}
      </div>
      <section className="mb-4 rounded-2xl border border-border/70 p-4" aria-label="Importar e exportar perfis fiscais">
        <h3 className="text-sm font-bold">Planilha para o contador</h3>
        <p className="mt-1 text-xs text-muted-foreground">Baixe o CSV com todos os produtos e colunas fiscais. O arquivo usa ponto e vírgula como separador e pode ser aberto no Excel ou Google Sheets. Na importação, as linhas válidas serão salvas e as rejeitadas virão com o motivo; tamanho máximo de 1,5 MB. Nenhum imposto é calculado.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="button button-outline" disabled={!canManage || busy} onClick={() => void downloadTemplate()}><Download size={15} />Baixar modelo CSV</button>
          <label className={`button button-outline ${!canManage || busy ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
            <Upload size={15} />{busy ? "Processando…" : "Importar CSV"}
            <input className="sr-only" type="file" accept=".csv,text/csv" disabled={!canManage || busy} onChange={event => {
              const file = event.currentTarget.files?.[0];
              if (file) void importFile(file);
              event.currentTarget.value = "";
            }} />
          </label>
        </div>
        {report && <div className="mt-3 rounded-xl border border-border p-3 text-xs" role="status">
          <strong>Importação concluída:</strong> {report.imported} produto(s) importado(s), {report.rejected.length} linha(s) rejeitada(s).
          {report.rejected.length > 0 && <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left">
              <thead><tr><th className="p-2">Linha</th><th className="p-2">Produto</th><th className="p-2">Motivo</th></tr></thead>
              <tbody>{report.rejected.map((row, index) => <tr key={`${row.row}-${index}`} className="border-t border-border/70"><td className="p-2">{row.row}</td><td className="p-2">{row.product || "—"}</td><td className="p-2">{row.reason}</td></tr>)}</tbody>
            </table>
          </div>}
        </div>}
        {error && <div className="mt-3"><Notice text={error} /></div>}
      </section>
      <div className="grid gap-2">{data.products.map(entry => <ProductProfileRow
        key={entry.product.id}
        entry={entry}
        canManage={canManage}
        regimeKind={data.taxRegimeKind}
        mode={data.mode}
        canEditAdvanced={data.canEditAdvanced}
        refresh={refresh}
      />)}</div>
    </Panel>
    <Panel title="Regras fiscais por categoria">
      <div className="grid gap-3">{data.categories.map(({ category }) => {
        const form = categoryValues[category.id] ?? { cfop: "", payload: "{}" };
        return <details key={category.id} className="rounded-2xl border border-border/70 p-4">
          <summary className="cursor-pointer text-sm font-bold">{category.name}</summary>
          <div className={`mt-3 grid gap-3 ${data.canEditAdvanced ? "sm:grid-cols-[180px_1fr]" : ""}`}>
            <TextField label="CFOP padrão da categoria" value={form.cfop} onChange={cfop => setCategoryValues(current => ({ ...current, [category.id]: { ...form, cfop } }))} maxLength={4} hint="Código de 4 dígitos informado pelo contador." />
            {data.canEditAdvanced
              ? <label className="grid gap-1.5 text-xs font-bold">Perfil tributário da categoria (JSON avançado)<textarea className="field min-h-24 font-mono text-xs" value={form.payload} onChange={event => setCategoryValues(current => ({ ...current, [category.id]: { ...form, payload: event.target.value } }))} /></label>
              : <p className="self-center text-xs text-muted-foreground">{form.cfop ? "O perfil tributário avançado desta categoria está configurado e só pode ser alterado por administrador." : "Perfil tributário avançado só pode ser criado ou alterado por administrador."}</p>}
          </div>
          <button type="button" className="button button-outline mt-3" disabled={!canManage || (!data.canEditAdvanced && !data.categories.find(item => item.category.id === category.id)?.rule?.taxConfigured)} onClick={() => void saveCategory(category.id)}><Save size={15} />Salvar regra</button>
        </details>;
      })}</div>
      {categoryError && <div className="mt-3"><Notice text={categoryError} /></div>}
    </Panel>
  </div>;
}

function FiscalOrderCard({ entry, canManage, canShip, refresh }: {
  entry: FiscalOrder; canManage: boolean; canShip: boolean; refresh: () => Promise<unknown>;
}) {
  const { order, document, recipient } = entry;
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [recipientForm, setRecipientForm] = useState({
    taxNumber: recipient?.taxNumber ?? "", legalName: recipient?.legalName ?? "",
    email: recipient?.email ?? order.customerEmail ?? "", postalCode: recipient?.address.postalCode ?? "",
    street: recipient?.address.street ?? "", number: recipient?.address.number ?? "",
    complement: recipient?.address.complement ?? "", neighborhood: recipient?.address.neighborhood ?? "",
    city: recipient?.address.city ?? "", state: recipient?.address.state ?? "", municipalityCode: recipient?.address.municipalityCode ?? "",
  });
  const [note, setNote] = useState({ invoiceNumber: "", series: "", accessKey: "", environment: "homologacao" });
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [manualCancelReason, setManualCancelReason] = useState("");
  const [correction, setCorrection] = useState("");
  const [providerCancelReason, setProviderCancelReason] = useState("");
  const [shippingCancelReason, setShippingCancelReason] = useState("");
  const [reconcileId, setReconcileId] = useState("");
  const [labelBusy, setLabelBusy] = useState(false);
  const [docMode, setDocMode] = useState<"manual" | "nfeio">("manual");
  useEffect(() => {
    setRecipientForm({
      taxNumber: recipient?.taxNumber ?? "", legalName: recipient?.legalName ?? "",
      email: recipient?.email ?? order.customerEmail ?? "", postalCode: recipient?.address.postalCode ?? "",
      street: recipient?.address.street ?? "", number: recipient?.address.number ?? "",
      complement: recipient?.address.complement ?? "", neighborhood: recipient?.address.neighborhood ?? "",
      city: recipient?.address.city ?? "", state: recipient?.address.state ?? "", municipalityCode: recipient?.address.municipalityCode ?? "",
    });
  }, [recipient, order.customerEmail]);
  useEffect(() => { if (document) setDocMode(document.mode); }, [document]);
  const act = async (label: string, path: string, method = "POST", body?: unknown) => {
    setError(""); setNotice("");
    try {
      await fiscalRequest(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      setNotice(label);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir a operação.");
    }
  };
  const saveRecipient = (event: FormEvent) => {
    event.preventDefault();
    void act("Destinatário fiscal atualizado.", `/api/admin/fiscal/recipients/${order.id}`, "POST", {
      taxNumber: recipientForm.taxNumber, legalName: recipientForm.legalName, email: recipientForm.email,
      address: {
        postalCode: recipientForm.postalCode, street: recipientForm.street, number: recipientForm.number,
        complement: recipientForm.complement || null, neighborhood: recipientForm.neighborhood, city: recipientForm.city,
        state: recipientForm.state, municipalityCode: recipientForm.municipalityCode,
      },
    });
  };
  const registerNote = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setNotice("");
    if (!document || !xmlFile || !pdfFile) { setError("Selecione o XML e o DANFE em PDF."); return; }
    try {
      const [xmlObjectPath, danfeObjectPath] = await Promise.all([uploadFiscalFile(xmlFile, "xml"), uploadFiscalFile(pdfFile, "pdf")]);
      await fiscalRequest(`/api/admin/fiscal/documents/${document.id}/manual`, {
        method: "PUT", body: JSON.stringify({ ...note, xmlObjectPath, danfeObjectPath }),
      });
      setNotice("Nota fiscal manual registrada; DANFE e XML serão enviados ao cliente.");
      setXmlFile(null); setPdfFile(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível registrar a nota manual.");
    }
  };
  const setLabel = async (action: string) => {
    setLabelBusy(true); setError(""); setNotice("");
    try {
      const result = await fiscalRequest<{ url?: string; status?: string }>(action, { method: "POST" });
      if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
      setNotice(result.status ? `Etiqueta: ${result.status}.` : "Etiqueta atualizada.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir a operação de frete.");
    } finally { setLabelBusy(false); }
  };
  return <article className="rounded-[24px] bg-card p-5 shadow-soft">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="eyebrow">{order.orderNumber} · {new Date(order.createdAt).toLocaleDateString("pt-BR")}</div>
        <h3 className="display mt-1 text-xl">{money(order.totalCents)}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{order.shippingMethod === "delivery" ? "Entrega" : "Retirada"} · {order.paymentStatus === "paid" ? "Pago" : order.paymentStatus}</p>
      </div>
      <span className="rounded-full bg-muted px-3 py-1.5 text-xs font-bold">{statusLabels[document?.status ?? "pending"] ?? (document ? document.status : "Aguardando documento")}</span>
    </header>
    {document?.rejectionReason && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{document.rejectionReason}</p>}
    {document?.status === "submission_unknown" && <p className="mt-3 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-800"><AlertTriangle size={15} className="shrink-0" />Não reenviar. Confirme o resultado no painel NFE.io antes de qualquer outra ação.</p>}
    <div className="mt-4 grid gap-2 sm:grid-cols-2">{entry.lines.map(line => <div key={line.sku} className="rounded-xl bg-muted p-3 text-xs"><b>{line.productName}</b><span className="ml-2 text-muted-foreground">SKU {line.sku} · {line.quantity} un.</span></div>)}</div>
    {recipient && <details className="mt-4 rounded-xl border border-border/70 p-3">
      <summary className="cursor-pointer text-sm font-bold">Destinatário fiscal (dados protegidos)</summary>
      <p className="mt-2 text-xs">{recipient.legalName} · {recipient.taxNumber} · {recipient.email}</p>
      <p className="mt-1 text-xs text-muted-foreground">{recipient.address.street}, {recipient.address.number} · {recipient.address.neighborhood}, {recipient.address.city} - {recipient.address.state}, {recipient.address.postalCode}</p>
    </details>}
    {canManage && <details className="mt-4 rounded-xl border border-border/70 p-3">
      <summary className="cursor-pointer text-sm font-bold">Revisar destinatário fiscal</summary>
      <form onSubmit={saveRecipient} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {([
          ["taxNumber", "CPF/CNPJ"], ["legalName", "Nome/razão social"], ["email", "E-mail"],
          ["postalCode", "CEP"], ["street", "Rua"], ["number", "Número"], ["complement", "Complemento"],
          ["neighborhood", "Bairro"], ["city", "Cidade"], ["state", "UF"], ["municipalityCode", "Código IBGE"],
        ] as const).map(([key, label]) => <TextField key={key} label={label} type={key === "email" ? "email" : "text"} testId={key === "email" ? "input-fiscal-recipient-email" : undefined} value={recipientForm[key]} onChange={value => setRecipientForm(current => ({ ...current, [key]: value }))} required={key !== "complement"} />)}
        <button className="button w-fit" type="submit"><Save size={15} />Salvar destinatário</button>
      </form>
    </details>}
    {document && canManage && <details className="mt-4 rounded-xl border border-border/70 p-3">
      <summary className="cursor-pointer text-sm font-bold">Ações fiscais</summary>
      <div className="mt-3 grid gap-3">
        {document.status === "pending" && <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1.5 text-xs font-bold">Modo deste pedido<select className="field min-w-40" value={docMode} onChange={event => setDocMode(event.target.value as "manual" | "nfeio")}><option value="manual">Manual</option><option value="nfeio">NFE.io (Teste)</option></select></label>
          <button type="button" className="button button-outline" onClick={() => void act("Modo fiscal atualizado.", `/api/admin/fiscal/documents/${document.id}/mode`, "PATCH", { mode: docMode })}>Salvar modo</button>
        </div>}
        {document.mode === "manual" && ["pending", "rejected"].includes(document.status) && <form onSubmit={registerNote} className="grid gap-3 rounded-xl bg-muted p-3">
          <b className="text-sm">Registrar nota emitida pelo contador</b>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <TextField label="Número da NF-e" value={note.invoiceNumber} onChange={v => setNote(current => ({ ...current, invoiceNumber: v }))} required />
            <TextField label="Série" value={note.series} onChange={v => setNote(current => ({ ...current, series: v }))} required />
            <TextField label="Chave de acesso (44 dígitos)" value={note.accessKey} onChange={v => setNote(current => ({ ...current, accessKey: v.replace(/\D/g, "") }))} maxLength={44} required />
            <label className="grid gap-1.5 text-xs font-bold">Ambiente da nota<select className="field" value={note.environment} onChange={event => setNote(current => ({ ...current, environment: event.target.value }))}><option value="homologacao">Homologação</option><option value="producao">Produção</option></select></label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-xs font-bold">XML da NF-e<input className="field" type="file" accept=".xml,text/xml,application/xml" onChange={event => setXmlFile(event.target.files?.[0] ?? null)} required /></label><label className="grid gap-1.5 text-xs font-bold">DANFE em PDF<input className="field" type="file" accept=".pdf,application/pdf" onChange={event => setPdfFile(event.target.files?.[0] ?? null)} required /></label></div>
          <button className="button w-fit" type="submit"><Upload size={15} />Registrar nota e enviar ao cliente</button>
        </form>}
        {["pending", "rejected"].includes(document.status) && <form onSubmit={event => { event.preventDefault(); void act("Exceção fiscal registrada.", `/api/admin/fiscal/documents/${document.id}/exemption`, "POST", { reason }); }} className="grid gap-2 rounded-xl bg-muted p-3">
          <label className="grid gap-1.5 text-xs font-bold">Registrar exceção fiscal deste pedido (mínimo 20 caracteres)<textarea className="field min-h-20" value={reason} onChange={event => setReason(event.target.value)} maxLength={1000} required /></label>
          <button className="button button-outline w-fit" type="submit">Confirmar exceção fiscal</button>
        </form>}
        {document.status === "authorized" && <>
          <div className="flex flex-wrap gap-2">
            {document.xmlObjectPath && <a className="button button-outline py-2 text-xs" href={`/api/admin/fiscal/documents/${document.id}/files/xml`}><Download size={14} />Baixar XML</a>}
            {document.danfeObjectPath && <a className="button button-outline py-2 text-xs" href={`/api/admin/fiscal/documents/${document.id}/files/pdf`}><Download size={14} />Baixar DANFE</a>}
          </div>
          {document.mode === "nfeio" && <div className="grid gap-2 sm:grid-cols-2">
            <form onSubmit={event => { event.preventDefault(); void act("Cancelamento solicitado à NFE.io.", `/api/admin/fiscal/documents/${document.id}/cancel`, "POST", { reason: providerCancelReason }); }} className="grid gap-2 rounded-xl bg-muted p-3">
              <label className="grid gap-1.5 text-xs font-bold">Motivo do cancelamento<textarea className="field" value={providerCancelReason} onChange={event => setProviderCancelReason(event.target.value)} minLength={15} maxLength={500} required /></label><button className="button button-outline" type="submit">Solicitar cancelamento</button>
            </form>
            <form onSubmit={event => { event.preventDefault(); void act("Carta de correção enviada.", `/api/admin/fiscal/documents/${document.id}/correction-letter`, "POST", { reason: correction }); }} className="grid gap-2 rounded-xl bg-muted p-3">
              <label className="grid gap-1.5 text-xs font-bold">Carta de correção (ASCII, sem acentos)<textarea className="field" value={correction} onChange={event => setCorrection(event.target.value)} minLength={15} maxLength={1000} required /></label><button className="button button-outline" type="submit">Enviar carta de correção</button>
            </form>
          </div>}
          {document.mode === "manual" && <form onSubmit={event => { event.preventDefault(); void act("Cancelamento manual registrado.", `/api/admin/fiscal/documents/${document.id}/manual-cancellation`, "POST", { reason: manualCancelReason }); }} className="grid gap-2 rounded-xl bg-muted p-3">
            <label className="grid gap-1.5 text-xs font-bold">Motivo do cancelamento já confirmado pela contabilidade<textarea className="field" value={manualCancelReason} onChange={event => setManualCancelReason(event.target.value)} minLength={15} maxLength={1000} required /></label><button className="button button-outline w-fit" type="submit">Registrar cancelamento manual</button>
          </form>}
        </>}
        {document.status === "cancelled" && <p className="text-xs text-muted-foreground">{document.cancellationReason || "Cancelamento confirmado."}</p>}
      </div>
    </details>}
    {order.shippingMethod === "delivery" && canShip && <div className="mt-4 rounded-xl border border-border/70 p-3">
      <div className="flex items-center gap-2 text-sm font-bold"><Truck size={16} />Etiqueta SuperFrete</div>
      {order.superfreteLabelId ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span>Status: {order.shippingLabelStatus ?? "desconhecido"} · {order.trackingCode ?? "sem rastreio"}</span>
        {order.shippingLabelStatus === "pending" && <button type="button" className="button button-outline py-2 text-xs" disabled={labelBusy} onClick={() => void setLabel(`/api/admin/orders/${order.id}/shipping-label/pay`)}>Pagar e liberar</button>}
        {["released", "posted", "delivered"].includes(order.shippingLabelStatus ?? "") && <button type="button" className="button button-outline py-2 text-xs" disabled={labelBusy} onClick={() => void setLabel(`/api/admin/orders/${order.id}/shipping-label/print`)}>Abrir etiqueta</button>}
        <button type="button" className="button button-outline py-2 text-xs" disabled={labelBusy} onClick={() => void act("Status da etiqueta consultado.", `/api/admin/orders/${order.id}/shipping-label`, "GET")}>Atualizar status</button>
        {["pending", "released"].includes(order.shippingLabelStatus ?? "") && <form onSubmit={event => { event.preventDefault(); void act("Cancelamento solicitado à SuperFrete.", `/api/admin/orders/${order.id}/shipping-label/cancel`, "POST", { reason: shippingCancelReason }); }} className="flex flex-wrap gap-2">
          <input className="field min-w-56" placeholder="Motivo do cancelamento" value={shippingCancelReason} onChange={event => setShippingCancelReason(event.target.value)} minLength={1} maxLength={500} required />
          <button className="button button-outline py-2 text-xs" type="submit">Cancelar etiqueta</button>
        </form>}
      </div> : <div className="mt-2 flex flex-wrap items-end gap-2">
        {!order.shippingLabelAttempted && <button type="button" className="button button-outline py-2 text-xs" disabled={labelBusy || order.paymentStatus !== "paid"} onClick={() => void setLabel(`/api/admin/orders/${order.id}/shipping-label`)}>Criar etiqueta</button>}
        {order.shippingLabelAttempted && <span className="text-xs text-amber-800">Há uma tentativa anterior. Não emita outra etiqueta sem conciliar com a SuperFrete.</span>}
        {order.shippingLabelStatus === "reconciliation_required" && <form onSubmit={event => { event.preventDefault(); void act("Etiqueta conciliada.", `/api/admin/orders/${order.id}/shipping-label/reconcile`, "POST", { providerLabelId: reconcileId }); }} className="flex gap-2">
          <input className="field" placeholder="ID confirmado no painel SuperFrete" value={reconcileId} onChange={event => setReconcileId(event.target.value)} required />
          <button className="button button-outline py-2 text-xs" type="submit">Conciliar</button>
        </form>}
      </div>}
    </div>}
    {error && <div className="mt-3"><Notice text={error} /></div>}
    {notice && <p className="mt-3 flex items-center gap-2 text-xs text-green-700" role="status"><Check size={14} />{notice}</p>}
  </article>;
}

export function AdminFiscalPage() {
  const canManage = useCan("fiscal:manage");
  const canExport = useCan("fiscal:export");
  const canShip = useCan("shipping:manage");
  const queryClient = useQueryClient();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = useQuery({
    queryKey: ["admin-fiscal", from, to],
    queryFn: () => fiscalRequest<FiscalDashboard>(`/api/admin/fiscal${from || to ? `?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}` : ""}`),
    retry: false,
  });
  const profiles = useQuery({
    queryKey: ["admin-fiscal-profiles"],
    queryFn: () => fiscalRequest<FiscalProfiles>("/api/admin/fiscal/profiles"),
    retry: false,
  });
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["admin-fiscal"] }),
    queryClient.invalidateQueries({ queryKey: ["admin-fiscal-profiles"] }),
  ]);
  if (query.isLoading) return <Loading />;
  if (query.isError || !query.data) return <ErrorState retry={() => query.refetch()} message="As informações fiscais não estão disponíveis para este perfil." />;
  const data = query.data;
  return <div className="grid gap-5" data-testid="admin-fiscal-page">
    <FiscalSettingsPanel dashboard={data} canManage={canManage} refresh={refresh} />
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Exportação para a contabilidade">
        <p className="text-sm text-muted-foreground">CSV com pedidos pagos, destinatários fiscais e perfis dos itens. O arquivo só fica disponível para perfis com permissão de exportação.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <TextField label="De" value={from} type="date" onChange={setFrom} />
          <TextField label="Até" value={to} type="date" onChange={setTo} />
          {canExport && <a className="button button-outline self-end" href={`/api/admin/fiscal/export.csv${from || to ? `?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}` : ""}`}><Download size={15} />Baixar CSV</a>}
        </div>
      </Panel>
      <Panel title="Regras e segurança">
        <p className="flex items-start gap-2 text-sm"><ShieldCheck size={17} className="mt-0.5 shrink-0" />CPF/CNPJ, endereço e arquivos fiscais são servidos apenas a perfis com permissão fiscal. XML e DANFE ficam em armazenamento privado.</p>
        <p className="mt-2 text-xs text-muted-foreground">O sistema não calcula tributos nem gera XML. A emissão automática permanece em Teste; cada pedido pode usar o modo manual.</p>
      </Panel>
    </div>
    {profiles.isLoading ? <Loading label="Carregando perfis tributários" /> :
      profiles.isError || !profiles.data ? <ErrorState retry={() => profiles.refetch()} message="Os perfis fiscais de produtos e categorias não estão disponíveis." /> :
        <FiscalProfilesPanel data={profiles.data} canManage={canManage} refresh={refresh} />}
    <Panel title="Pedidos pagos e notas fiscais">
      <div className="mb-4 flex justify-end"><button type="button" className="button button-outline py-2 text-xs" onClick={() => { void query.refetch(); void profiles.refetch(); }}><RefreshCw size={14} />Atualizar</button></div>
      {!data.orders.length ? <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">Nenhum pedido pago neste período.</p> :
        <div className="grid gap-3">{data.orders.map(entry => <FiscalOrderCard key={entry.order.id} entry={entry} canManage={canManage} canShip={canShip} refresh={refresh} />)}</div>}
    </Panel>
  </div>;
}
