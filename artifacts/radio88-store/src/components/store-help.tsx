import { Link } from 'wouter';
import { ArrowRight, ClipboardList, MapPin, MessageCircle, PackageCheck, ShieldQuestion, UserRound } from 'lucide-react';
import { STORE_CONTACT } from '@/lib/legal-documents';

const helpLinks = [
  { href: '/orders', label: 'Acompanhar um pedido', description: 'Consulte pedidos feitos com uma conta Rádio 88.', icon: PackageCheck },
  { href: '/returns', label: 'Trocas e devoluções', description: 'Leia as orientações disponíveis para solicitar atendimento.', icon: ClipboardList },
  { href: '/account/addresses', label: 'Endereços de entrega', description: 'Gerencie os endereços salvos na sua conta.', icon: MapPin },
  { href: '/account', label: 'Minha conta', description: 'Atualize seus dados e preferências.', icon: UserRound },
  { href: '/privacy', label: 'Privacidade e dados', description: 'Entenda suas escolhas e direitos sobre os dados.', icon: ShieldQuestion },
];

export function StoreHelpPage() {
  return <main className="shell store-page store-help-page">
    <header className="store-page-head">
      <div><div className="eyebrow">ATENDIMENTO · RÁDIO 88 FM</div><h1 className="display">Como podemos ajudar?</h1><p>Escolha um assunto ou fale com a equipe pelos canais oficiais da loja.</p></div>
    </header>
    <nav className="store-help-grid" aria-label="Assuntos de ajuda">
      {helpLinks.map(({ href, label, description, icon: Icon }) => <Link key={href} href={href} className="store-help-card">
        <Icon size={20} aria-hidden="true" />
        <span><strong>{label}</strong><small>{description}</small></span>
        <ArrowRight size={17} aria-hidden="true" />
      </Link>)}
    </nav>
    <section className="store-help-guest-note">
      <div><h2>Comprou sem criar uma conta?</h2><p>O acompanhamento online de pedidos de visitante ainda não está disponível. Guarde o número exibido na confirmação e informe-o ao atendimento para localizarmos o pedido.</p></div>
      <a href={STORE_CONTACT.whatsappUrl} target="_blank" rel="noopener noreferrer" className="button"><MessageCircle size={17} />Falar pelo WhatsApp<span className="sr-only"> (abre em nova aba)</span></a>
    </section>
    <p className="store-help-contact">E-mail: <a href={`mailto:${STORE_CONTACT.email}`}>{STORE_CONTACT.email}</a> · Horário: {STORE_CONTACT.hours}</p>
  </main>;
}
