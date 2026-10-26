import { useEffect } from 'react';
import { Link } from 'wouter';
import { LEGAL_DOCUMENTS, LEGAL_UPDATED_AT, LEGAL_VERSION, STORE_CONTACT, type LegalDocumentType } from '@/lib/legal-documents';
import { CookiePreferencesReopen } from '@/components/shop-support';

export function LegalNavigation() {
  return <nav className="flex flex-wrap gap-x-5 gap-y-3 text-sm underline underline-offset-4" aria-label="Atendimento e documentos legais">
    <Link href="/contact">Atendimento</Link>
    <Link href="/terms">Termos de uso</Link>
    <Link href="/privacy">Privacidade (LGPD)</Link>
    <Link href="/returns">Trocas e devoluções</Link>
    <Link href="/cookies">Cookies</Link>
  </nav>;
}

export function LegalDocumentContent({ type }: { type: LegalDocumentType }) {
  return <div className="legal-copy">
    {LEGAL_DOCUMENTS[type].sections.map((section, index) => <section key={section.title} aria-labelledby={`${type}-section-${index}`}>
      <h2 id={`${type}-section-${index}`}>{section.title}</h2>
      {section.paragraphs.map(paragraph => <p key={paragraph} className="mb-4">{paragraph}</p>)}
    </section>)}
  </div>;
}

function usePublicTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} | Loja Rádio 88 FM`;
    return () => { document.title = previous; };
  }, [title]);
}

export function LegalPage({ type }: { type: LegalDocumentType }) {
  const content = LEGAL_DOCUMENTS[type];
  usePublicTitle(content.title);
  return <main className="shell legal-page py-10 md:py-14" data-testid={`page-legal-${type}`}>
    <LegalNavigation />
    <div className="eyebrow mt-8">RÁDIO 88 FM · INFORMAÇÃO CLARA</div>
    <h1 className="display">{content.title}</h1>
    <p className="legal-lede">{content.introduction}</p>
    <p className="mb-6 text-xs text-muted-foreground">Atualização: {LEGAL_UPDATED_AT} · Versão {LEGAL_VERSION}</p>
    <LegalDocumentContent type={type} />
    {type === 'privacy' && <div className="my-6"><CookiePreferencesReopen /></div>}
    <aside className="my-8 rounded-2xl border border-border bg-card p-5">
      <h2 className="font-semibold">Precisa de ajuda?</h2>
      <p className="mt-2 text-sm">Atendimento para compras, trocas, devoluções e privacidade, inclusive para quem comprou sem conta.</p>
      <Link href="/contact" className="button mt-4">Ver canais de atendimento</Link>
    </aside>
    <div className="flex flex-wrap gap-3">
      <button type="button" className="button button-outline" onClick={() => window.print()}>Imprimir ou salvar em PDF</button>
      <Link href="/" className="button button-outline">Voltar à loja</Link>
    </div>
    <p className="mt-6 text-xs text-muted-foreground">Referências: <a className="underline" href="https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm" target="_blank" rel="noopener noreferrer">Código de Defesa do Consumidor</a>, <a className="underline" href="https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm" target="_blank" rel="noopener noreferrer">Decreto do comércio eletrônico</a> e <a className="underline" href="https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm" target="_blank" rel="noopener noreferrer">LGPD</a>.</p>
  </main>;
}

export function ContactPage() {
  usePublicTitle('Atendimento');
  return <main className="shell legal-page py-10 md:py-14" data-testid="page-contact">
    <LegalNavigation />
    <div className="eyebrow mt-8">LOJA RÁDIO 88 FM</div>
    <h1 className="display">Como podemos ajudar?</h1>
    <p className="legal-lede">Dúvidas sobre compras, cancelamentos, trocas, devoluções ou seus dados pessoais. Não é necessário criar uma conta.</p>
    <section className="rounded-2xl border border-border bg-card p-5 md:p-7" aria-labelledby="contact-whatsapp">
      <h2 id="contact-whatsapp" className="display text-2xl">WhatsApp de atendimento</h2>
      <p className="mt-3 text-lg font-semibold">{STORE_CONTACT.whatsappLabel}</p>
      <p className="mt-2 text-sm">Canal atual para compras e solicitações de privacidade/LGPD da Loja Rádio 88. Informe o assunto para encaminhamento à equipe responsável.</p>
      <a className="button mt-5" href={STORE_CONTACT.whatsappUrl} target="_blank" rel="noopener noreferrer" data-testid="link-contact-whatsapp">Abrir WhatsApp <span className="sr-only">(serviço externo, abre em nova aba)</span></a>
      <p className="mt-3 text-xs text-muted-foreground">O link abre um serviço externo. Sua mensagem só é enviada quando você a envia no WhatsApp; abrir a conversa não cria protocolo nem confirma recebimento.</p>
    </section>
    <section className="mt-5 rounded-2xl border border-border bg-card p-5 md:p-7" aria-labelledby="contact-email">
      <h2 id="contact-email" className="display text-2xl">E-mail de atendimento e privacidade</h2>
      <a className="mt-3 inline-block break-all text-lg font-semibold underline underline-offset-4" href={`mailto:${STORE_CONTACT.email}`} data-testid="link-contact-email">{STORE_CONTACT.email}</a>
      <p className="mt-3 text-sm">Envie dúvidas sobre compras, trocas, devoluções e cancelamentos. Para dados pessoais, use o assunto “Privacidade / LGPD — Loja Rádio 88”.</p>
      <p className="mt-2 text-xs text-muted-foreground">O link abre seu aplicativo de e-mail. Se não houver um configurado, copie o endereço para o serviço que você utiliza. A solicitação só é enviada quando você envia a mensagem.</p>
    </section>
    <section className="mt-5 rounded-2xl border border-border bg-card p-5 md:p-7" aria-labelledby="contact-hours">
      <h2 id="contact-hours" className="display text-2xl">Horário de atendimento</h2>
      <p className="mt-3 text-lg font-semibold" data-testid="text-contact-hours">{STORE_CONTACT.hours}</p>
      <p className="mt-2 text-sm">Confirme os dias de funcionamento e eventuais alterações em feriados pelos canais acima. Para retirada presencial, aguarde a confirmação da equipe antes de se deslocar.</p>
    </section>
    <div className="legal-copy mt-8">
      <section aria-labelledby="contact-order"><h2 id="contact-order">Pedidos, trocas e cancelamento</h2>
        <p>Informe o número do pedido, se disponível, o item e a solicitação. Se não tiver o número, peça ajuda para localizar a compra. Você pode solicitar atendimento mesmo tendo comprado como visitante. Guarde a conversa e peça confirmação de recebimento e identificação do atendimento.</p>
        <p>Para arrependimento, informe claramente que deseja desistir da compra; não é necessário justificar. A manifestação deve ser enviada dentro do prazo legal, sem aguardar o retorno da equipe para registrá-la.</p>
        <Link href="/returns" className="mt-3 inline-block text-sm underline underline-offset-4">Consultar prazos e política de trocas e devoluções</Link>
      </section>
      <section aria-labelledby="contact-privacy"><h2 id="contact-privacy">Privacidade e direitos LGPD</h2>
        <p>Use o e-mail ou o WhatsApp acima com o assunto “Privacidade / LGPD — Loja Rádio 88”. Diga qual direito deseja exercer e forneça somente os dados mínimos para identificação. Poderá haver verificação de titularidade antes de disponibilizar dados ou efetuar alterações.</p>
        <p>Nunca envie senha, token, dados completos de cartão ou cópia de documento sem necessidade e orientação. Se o assunto for confidencial, peça um meio reservado para encaminhamento ao responsável.</p>
        <Link href="/privacy" className="mt-3 inline-block text-sm underline underline-offset-4">Conhecer seus direitos e a Política de privacidade</Link>
      </section>
      <section aria-labelledby="contact-place"><h2 id="contact-place">Local de referência e retirada</h2>
        <address className="not-italic text-sm leading-7">{STORE_CONTACT.address}</address>
        <p>Confirme o horário e a disponibilidade de atendimento antes de ir ao local. Para retirar produtos, aguarde a confirmação da equipe e apresente documento oficial com foto do comprador. Não há promessa de atendimento presencial 24 horas.</p>
      </section>
      <section aria-labelledby="contact-response"><h2 id="contact-response">Recebimento e resposta</h2>
        <p>O atendimento deve confirmar o recebimento da demanda pelo canal utilizado e encaminhar manifestação em até 5 dias, conforme o Decreto nº 7.962/2013, respeitados prazos legais específicos. A confirmação do arrependimento deve ser imediata. Esses deveres não significam que o site execute confirmação ou solução automática pelo WhatsApp.</p>
        <p>O canal e a identificação pública podem ser conferidos no <a className="underline" href={STORE_CONTACT.officialWebsite} target="_blank" rel="noopener noreferrer">site oficial da Rádio 88 FM (abre em nova aba)</a>. Suspeite de pedidos de pagamento para liberar devolução ou reembolso.</p>
      </section>
    </div>
  </main>;
}
