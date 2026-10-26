export const LEGAL_UPDATED_AT = '16/10/2026';
export const LEGAL_VERSION = '2026-10-16.2';

// Current channels confirmed by the store owner; the WhatsApp may change later.
// Do not substitute technical integration e-mails for a consumer support channel.
export const STORE_CONTACT = {
  whatsappLabel: '(24) 99868-0088',
  whatsappUrl: 'https://wa.me/5524998680088',
  email: 'comercialvpd@gmail.com',
  hours: '08h às 16h50',
  address: 'Rua Moacyr de Paula Lobo, 104, Vila Mury, Volta Redonda – RJ, CEP 27283-350',
  officialWebsite: 'https://www.radio88fm.com/',
} as const;

type LegalSection = { title: string; paragraphs: string[] };
type LegalDocument = { title: string; introduction: string; sections: LegalSection[] };

export const LEGAL_DOCUMENTS = {
  terms: {
    title: 'Termos de uso',
    introduction: 'Conheça as condições de navegação e compra da Loja Rádio 88 FM.',
    sections: [
      { title: '1. A loja e o atendimento', paragraphs: [
        'Estes termos se aplicam à Loja Rádio 88 FM e às compras realizadas neste site. A oferta de cada produto, as informações apresentadas no checkout e os direitos previstos no Código de Defesa do Consumidor integram a contratação.',
        `Para dúvidas, reclamações, cancelamentos ou solicitações sobre dados pessoais, use o e-mail ${STORE_CONTACT.email} ou o WhatsApp ${STORE_CONTACT.whatsappLabel}, identificando o assunto como “Loja Rádio 88”. Horário de atendimento: ${STORE_CONTACT.hours}. Confirme os dias de funcionamento e feriados antes de se deslocar. Endereço de referência para contato e retirada: ${STORE_CONTACT.address}.`,
      ] },
      { title: '2. Produtos, preços e disponibilidade', paragraphs: [
        'As características, opções, quantidades e preços dos produtos são apresentados no catálogo. Confira a variante selecionada e o resumo da compra antes de finalizar. Os preços são em reais (BRL), com descontos e frete discriminados antes da confirmação.',
        'A disponibilidade depende do estoque da opção escolhida. O custo e a estimativa de envio são apresentados conforme o CEP e o serviço selecionados. A oferta confirmada será respeitada; eventual indisponibilidade ou erro será tratado com informação ao consumidor e as alternativas asseguradas por lei, sem substituição ou cobrança adicional imposta.',
      ] },
      { title: '3. Cadastro e checkout de visitante', paragraphs: [
        'Você pode comprar com conta ou como visitante, conforme as opções disponíveis no checkout. Informe dados corretos para identificação, contato, emissão fiscal e entrega. Revise e corrija seus dados antes de concluir.',
        'Mantenha sua conta e credenciais protegidas. A ausência de cadastro não retira seus direitos: visitantes podem solicitar informações, cancelamento e pós-venda pelo canal público de atendimento, com verificação proporcional da titularidade.',
      ] },
      { title: '4. Pedido e pagamento', paragraphs: [
        'Criar um pedido não significa pagamento confirmado nem transferência automática de dinheiro. O pagamento atual segue as instruções de PIX exibidas no pedido e a confirmação é feita pela equipe. Confira destinatário e valor nas instruções oficiais; nunca forneça senha bancária ou código de autenticação.',
        'O status apresentado na compra informa a etapa registrada. Comprovante enviado deve ser conferido pelo financeiro. Problemas de pagamento, divergências e pedidos de cancelamento devem ser comunicados ao atendimento. Não efetue novo pagamento para corrigir uma divergência sem orientação.',
        'Prazos de pagamento, quando informados no pedido, e condições específicas da oferta devem ser observados. Recursos planejados, como expiração automática de reservas ou acompanhamento de visitante por link, não são considerados disponíveis apenas por constarem em um planejamento.',
      ] },
      { title: '5. Envio e retirada presencial', paragraphs: [
        'Para envio, confira endereço, modalidade e previsão informados no checkout. Acompanhe o status registrado e, quando disponível, o código de rastreio. Se houver atraso, avaria, falta de item ou divergência, contate a equipe para tratamento, sem prejuízo dos seus direitos.',
        'Na retirada, aguarde a confirmação da equipe e combine o horário pelo canal de atendimento. O comprador deve apresentar documento oficial com foto. Não envie fotos do documento por mensagens sem orientação e necessidade. Terceiros não estão autorizados a retirar nesta política.',
      ] },
      { title: '6. Cancelamento, troca e devolução', paragraphs: [
        'Você pode solicitar cancelamento, exercer o direito de arrependimento e reclamar de defeitos pelos canais de atendimento, inclusive sem conta. Consulte a Política de trocas e devoluções para prazos, logística e reembolso.',
        'Nenhuma condição destes termos elimina garantia legal, transfere automaticamente a responsabilidade da loja ao transportador ou exige renúncia a direitos do consumidor.',
      ] },
      { title: '7. Dados pessoais e comunicações', paragraphs: [
        'Os dados necessários à compra são tratados para execução do contrato, cumprimento de obrigações legais e demais bases descritas na Política de privacidade. A ciência dessa política não é uma autorização genérica de uso dos dados.',
        'Publicidade e analytics opcionais não são condição para comprar. As preferências de comunicação e de cookies são controles separados do aceite destes termos.',
      ] },
      { title: '8. Histórico, atualização e legislação', paragraphs: [
        'Guarde o número do pedido, o resumo da compra e as comunicações. Estas páginas podem ser impressas ou salvas em PDF pelo navegador. Solicite ao atendimento uma cópia das condições e dos registros da sua compra quando necessário.',
        'Alterações passam a valer para novas contratações e não modificam retroativamente a oferta ou os direitos de compras anteriores. Aplicam-se a legislação brasileira e o foro competente previsto em lei, preservada a proteção ao consumidor.',
      ] },
    ],
  },
  privacy: {
    title: 'Política de privacidade',
    introduction: 'Saiba quais dados são usados, para quê e como exercer seus direitos previstos na LGPD.',
    sections: [
      { title: '1. Responsabilidade e contato de privacidade', paragraphs: [
        'Esta política descreve o tratamento de dados na operação da Loja Rádio 88 FM. Para exercer seus direitos ou esclarecer dúvidas de privacidade, use os canais abaixo, identificando a mensagem como “Privacidade / LGPD — Loja Rádio 88”.',
        `E-mail: ${STORE_CONTACT.email}. WhatsApp: ${STORE_CONTACT.whatsappLabel}. Horário de atendimento: ${STORE_CONTACT.hours}; confirme os dias de funcionamento e feriados. Endereço de referência: ${STORE_CONTACT.address}. O contato não exige criar uma conta. A equipe deverá encaminhar a demanda ao responsável pelo tratamento de dados da loja.`,
      ] },
      { title: '2. Dados tratados', paragraphs: [
        'Conforme a funcionalidade utilizada, tratamos nome, e-mail, telefone, identificação da conta, endereços, CPF/CNPJ e dados necessários à nota fiscal, itens comprados, valores, situação de pagamento, entrega, histórico de solicitações e preferências de comunicação.',
        'Também são tratados dados técnicos necessários à autenticação, segurança e funcionamento, como informações de sessão, navegador e registros de acesso. Não solicitamos senhas bancárias nem dados de cartão para o pagamento manual atual. Não envie documentos, dados sensíveis ou dados de terceiros sem necessidade.',
      ] },
      { title: '3. Finalidades e bases legais', paragraphs: [
        'Execução de contrato e procedimentos a seu pedido: cadastro, checkout, processamento da compra, cálculo de frete, entrega e atendimento. Cumprimento de obrigação legal/regulatória: emissão e conservação fiscal e demais deveres aplicáveis.',
        'Exercício regular de direitos: conservação de evidências necessárias a reclamações e processos. Legítimo interesse, quando cabível e avaliado: segurança, prevenção de fraude e proteção da operação, respeitando necessidade e direitos do titular.',
        'Consentimento, quando aplicável: comunicações promocionais e tecnologias opcionais, de forma separada e revogável. A compra ou o aceite dos termos não autoriza automaticamente marketing ou analytics.',
      ] },
      { title: '4. Compartilhamento e prestadores', paragraphs: [
        'Compartilhamos somente os dados necessários com prestadores de autenticação e hospedagem, infraestrutura e armazenamento, envio de e-mail, serviços fiscais, cotação/logística e transportadoras, além de autoridades quando houver fundamento legal.',
        'A operação utiliza serviços como Clerk (autenticação), infraestrutura de hospedagem, Cloudflare R2 (armazenamento), Resend (e-mails), SuperFrete e prestadores fiscais conforme a funcionalidade utilizada. O uso desses serviços não significa que todos recebem todos os dados de cada cliente.',
        'Não comercializamos dados pessoais. Links para WhatsApp e outros serviços externos levam a ambientes com suas próprias políticas. Não publique dados pessoais em canais abertos.',
      ] },
      { title: '5. Tratamento internacional', paragraphs: [
        'Prestadores de tecnologia podem tratar dados fora do Brasil. Quando houver transferência internacional, a operação deve observar as hipóteses e salvaguardas exigidas pela LGPD e regulamentação da ANPD. Informações sobre prestadores e transferências relacionadas à sua compra podem ser solicitadas pelo canal de privacidade.',
      ] },
      { title: '6. Cookies e preferências', paragraphs: [
        'Cookies e armazenamento essenciais permitem sessão, segurança, carrinho e registro de preferências. Analytics é opcional e deve permanecer desativado sem sua autorização. Atualmente não há ferramenta de analytics ativa na loja.',
        'Você pode aceitar ou recusar tecnologias opcionais e rever a decisão em “Preferências de cookies”, no rodapé. A recusa não impede a compra. Consulte a Política de cookies para detalhes. Não há garantia de anonimato apenas por recusar cookies opcionais: registros operacionais necessários continuam existindo.',
      ] },
      { title: '7. Conservação e exclusão', paragraphs: [
        'Os dados são conservados pelo tempo necessário às finalidades informadas e aos prazos legais e regulatórios aplicáveis. Pedidos, documentos fiscais e evidências podem precisar ser mantidos mesmo após exclusão da conta ou revogação de consentimento.',
        'A exclusão de conta não significa apagar imediatamente todos os registros comerciais, fiscais, backups ou dados sob guarda legal. Dados sem fundamento para manutenção devem ser eliminados ou anonimizados; cópias de segurança seguem seu ciclo de retenção e proteção. Você pode solicitar esclarecimentos sobre os critérios aplicados ao seu caso.',
      ] },
      { title: '8. Seus direitos e como pedir', paragraphs: [
        'Você pode solicitar confirmação de tratamento, acesso, correção, informação sobre compartilhamento, anonimização/bloqueio/eliminação de dados desnecessários ou irregulares, portabilidade nos termos da regulamentação, eliminação de dados tratados com consentimento quando cabível e revogação de consentimento.',
        'Também pode conhecer as consequências de não consentir, apresentar oposição nas hipóteses legais e solicitar revisão e informações sobre decisões exclusivamente automatizadas que afetem seus interesses, quando aplicável.',
        'Use o canal público de privacidade, com ou sem conta. Informe o direito pretendido e os dados mínimos para localizar o relacionamento com a loja. Poderá ser necessária verificação proporcional de identidade; não envie espontaneamente cópia de documento ou senha. O exercício de direitos é gratuito.',
        'Clientes com conta também podem atualizar informações, gerenciar endereços, exportar dados e solicitar exclusão em Minha conta. Esses atalhos não limitam os demais direitos nem substituem o atendimento a visitantes. Caso necessário, você pode peticionar à ANPD e buscar os órgãos de defesa do consumidor.',
      ] },
      { title: '9. Segurança e incidentes', paragraphs: [
        'O acesso a dados deve ser limitado a pessoas autorizadas e a finalidades legítimas. A loja utiliza mecanismos de autenticação e controles de acesso, mas nenhum ambiente pode prometer segurança absoluta.',
        'Se suspeitar de exposição de dados ou uso indevido de conta, comunique o canal de privacidade sem incluir senhas. Incidentes devem ser avaliados e, quando exigido, comunicados à ANPD e aos titulares conforme a legislação e a regulamentação aplicáveis.',
      ] },
      { title: '10. Atualizações desta política', paragraphs: [
        'A data e a versão deste documento aparecem nesta página. Alterações relevantes devem ser comunicadas de forma adequada. Uma atualização não substitui consentimento específico quando ele for necessário para uma nova finalidade.',
      ] },
    ],
  },
  returns: {
    title: 'Política de trocas e devoluções',
    introduction: 'Orientações para arrependimento, defeitos, divergências, cancelamento e reembolso.',
    sections: [
      { title: '1. Como solicitar, inclusive sem conta', paragraphs: [
        `Entre em contato pelo e-mail ${STORE_CONTACT.email} ou pelo WhatsApp ${STORE_CONTACT.whatsappLabel}, identificando “Loja Rádio 88 — troca, devolução ou cancelamento”. Horário de atendimento: ${STORE_CONTACT.hours}; confirme os dias de funcionamento e feriados. Informe o número do pedido, item, quantidade e o que deseja solicitar. Se não tiver o número, peça ajuda para localizar a compra com os dados mínimos de identificação.`,
        'Não é necessário criar conta para exercer seus direitos. Guarde a mensagem e solicite confirmação do recebimento da demanda. O canal externo abre no WhatsApp: clicar no link não envia a solicitação; é necessário enviar a mensagem. Não há aprovação ou reembolso automático pelo clique.',
      ] },
      { title: '2. Arrependimento de compra online', paragraphs: [
        'Nas compras realizadas pela internet, o consumidor pode exercer o direito de arrependimento no prazo legal de 7 dias corridos, contado da assinatura ou do recebimento do produto, conforme o caso (art. 49 do CDC). Para produtos recebidos por envio ou retirada, considere o recebimento como referência para a solicitação.',
        'Não é necessário justificar a desistência. O exercício regular desse direito não gera custo ao consumidor e inclui a restituição dos valores pagos, inclusive o frete da compra. A loja orientará a devolução por meio adequado, sem cobrar a logística de retorno aplicável a esse direito.',
        'A falta de embalagem original ou a impossibilidade de apresentar uma foto não geram recusa automática. Preserve o produto e seus acessórios e não realize uso além do necessário à avaliação. Casos concretos devem ser analisados sem restrição indevida dos direitos legais.',
      ] },
      { title: '3. Defeito e garantia legal', paragraphs: [
        'A garantia legal independe de termo escrito. Os prazos legais para reclamar de vícios aparentes ou de fácil constatação são de 30 dias para produtos não duráveis e 90 dias para duráveis, contados da entrega efetiva; no vício oculto, o prazo começa quando o defeito fica evidenciado (art. 26 do CDC).',
        'Entre em contato para avaliação e instruções. Poderemos pedir descrição e evidências proporcionais à análise, sem impedir o registro da reclamação. O tratamento observará os arts. 18 e seguintes do CDC, inclusive os prazos e as alternativas legais de reparação, substituição, restituição ou abatimento, conforme o caso.',
        'Não se limita a garantia legal ao prazo de 7 dias do arrependimento, nem se impõe contato exclusivo com o fabricante como condição para atendimento pela loja.',
      ] },
      { title: '4. Item errado, avaria ou quantidade divergente', paragraphs: [
        'Se receber item diferente do comprado, produto avariado ou quantidade incorreta, contate a loja assim que identificar o problema. Fotos do produto e da embalagem podem ajudar, mas a ausência de foto não impede a abertura do atendimento.',
        'A loja orientará a solução e a logística correspondente, sem impor custo de correção de erro da loja ao consumidor. A comunicação posterior ao recebimento não elimina direitos legais. Não envie o item por conta própria antes de combinar o procedimento, para evitar despesas e perda de rastreabilidade.',
      ] },
      { title: '5. Troca por tamanho, cor ou preferência', paragraphs: [
        'Uma troca comercial adicional depende das condições expressamente oferecidas na compra, da disponibilidade e da avaliação do atendimento. Ela não substitui nem restringe o direito de arrependimento ou a garantia legal.',
        'A substituição não ocorre automaticamente: a equipe deve confirmar o item, a disponibilidade e eventuais diferenças acordadas antes de prosseguir. Não efetue pagamentos adicionais sem orientação oficial.',
      ] },
      { title: '6. Cancelamento e pedidos já pagos', paragraphs: [
        'Solicite cancelamento pelo atendimento, informando o pedido. Se o pedido já estiver pago ou em transporte, a equipe avaliará a etapa e orientará a solução de acordo com o motivo e os direitos aplicáveis.',
        'Um pedido marcado como cancelado ou devolvido não comprova, sozinho, transferência de dinheiro ao comprador. A operação financeira deve ser identificada e confirmada separadamente.',
      ] },
      { title: '7. Devolução física e reembolso', paragraphs: [
        'Após combinar a devolução, a equipe informará endereço/modalidade, identificação do retorno e orientações de embalagem. Guarde o comprovante. O recebimento físico e a conferência do produto são registros distintos do reembolso.',
        'No arrependimento, a restituição observará o CDC, inclusive a devolução imediata dos valores pagos e atualização quando cabível. Nos demais casos, serão respeitados o fundamento da solicitação e os prazos legais. A conferência física não poderá ser usada para impor atraso indevido ao reembolso legalmente exigível.',
        'O pagamento atual é manual. O reembolso também exige execução e confirmação financeira; a loja não realiza transferência automática apenas ao alterar um status. A equipe deve informar valor, forma e comprovação da devolução. Não são solicitadas senhas bancárias, tokens ou pagamento de taxa para liberar reembolso.',
      ] },
      { title: '8. Acompanhamento e proteção dos direitos', paragraphs: [
        'O acompanhamento destas solicitações ocorre pelo atendimento. A loja deve confirmar o recebimento da demanda e encaminhar sua manifestação em até 5 dias, conforme o Decreto nº 7.962/2013, sem afastar prazos legais específicos e o dever de confirmação imediata do arrependimento.',
        'Esta política não exige renúncia a direitos, não condiciona o atendimento à criação de conta e não promete funcionalidades de pós-venda ainda não disponibilizadas no site. Se houver conflito, prevalecem a legislação e as condições mais favoráveis legalmente aplicáveis ao consumidor.',
      ] },
    ],
  },
} satisfies Record<string, LegalDocument>;

export type LegalDocumentType = keyof typeof LEGAL_DOCUMENTS;
