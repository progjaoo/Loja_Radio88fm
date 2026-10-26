export const defaultHomepageLayout = {
  sections: [
    { id: "hero", title: "Apresentação" },
    { id: "featured", title: "Em destaque" },
    { id: "catalog", title: "Toda a vitrine" },
    { id: "categories", title: "Explore por categoria" },
  ].map(section => ({ ...section, enabled: true, description: "", limit: 100, columns: 4, categoryIds: [], productIds: [] })),
  hero: {
    title: "A loja oficial dos ouvintes da Rádio 88 FM.",
    description: "Produtos oficiais da estação, com venda direta, preço claro e pagamento via PIX confirmado manualmente pela equipe.",
    ctaLabel: "Ver a vitrine",
    ctaHref: "/#vitrine",
    alignment: "left",
  },
};

export function homepageSectionsValid(sections: { id: string; enabled: boolean }[]): boolean {
  return sections.length === 4 && new Set(sections.map(section => section.id)).size === 4 &&
    ["hero", "featured", "catalog", "categories"].every(id => sections.some(section => section.id === id)) &&
    sections.some(section => section.enabled);
}
