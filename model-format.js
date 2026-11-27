// Formatação compartilhada do catálogo: famílias, preço e ordem. Usada pelo /models (site) e pela
// página Disponibilidade do admin. admin/model-format.js é cópia idêntica deste arquivo (o teste confere).
export const FAMILIES = {
  anthropic: { label: 'Anthropic', color: '#d97757', mark: 'A' },
  openai: { label: 'OpenAI', color: '#121212', mark: 'O' },
  google: { label: 'Google', color: '#4285f4', mark: 'G' },
  deepseek: { label: 'DeepSeek', color: '#4d6bfe', mark: 'D' },
  qwen: { label: 'Qwen', color: '#615ced', mark: 'Q' },
  moonshot: { label: 'Moonshot AI', color: '#16191e', mark: 'K' },
  zai: { label: 'Z.ai', color: '#2563eb', mark: 'Z' },
  minimax: { label: 'MiniMax', color: '#e2167e', mark: 'M' },
  xai: { label: 'xAI', color: '#000000', mark: 'X' },
  meta: { label: 'Meta', color: '#0668e1', mark: 'L' },
  mistral: { label: 'Mistral', color: '#fa520f', mark: 'M' },
  xiaomi: { label: 'Xiaomi', color: '#ff6900', mark: 'X' },
  inception: { label: 'Inception', color: '#7c3aed', mark: 'I' },
  agnes: { label: 'Agnes AI', color: '#0891b2', mark: 'A' },
  other: { label: 'Outros', color: '#6b6759', mark: '•' },
};
export const family = id => FAMILIES[id] || FAMILIES.other;
export const FAMILY_ORDER = Object.keys(FAMILIES);

/** Preço em dólar: grátis, inteiro, 2 casas a partir de US$ 0,10 e 2 algarismos significativos abaixo disso (0,035 continua 0,035). */
export function money(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number === 0) return 'Grátis';
  if (Number.isInteger(number)) return `$${number}`;
  if (number >= 0.1) return `$${number.toFixed(2)}`;
  return `$${Number(number.toPrecision(2))}`;
}
export const context = tokens => !tokens ? '—' : tokens >= 1e6 ? `${(tokens / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}M` : `${Math.round(tokens / 1e3)}K`;
export const isFree = m => !!m.price && (m.price.billingType === 'request' ? Number(m.price.request) === 0 : Number(m.price.input) === 0 && Number(m.price.output) === 0);
export const bestDiscount = m => Math.max(0, ...Object.values(m.originalPrice?.discount || {}).filter(v => typeof v === 'number'));
export const mainPrice = m => !m.price ? Infinity : m.price.billingType === 'request' ? Number(m.price.request) * 1000 : Number(m.price.input || 0) + Number(m.price.output || 0);

export const byFamily = (a, b) => FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family) || a.name.localeCompare(b.name, 'pt-BR', { numeric: true });
const sorters = {
  family: byFamily,
  price_asc: (a, b) => mainPrice(a) - mainPrice(b) || byFamily(a, b),
  price_desc: (a, b) => (mainPrice(b) === Infinity ? -1 : mainPrice(b)) - (mainPrice(a) === Infinity ? -1 : mainPrice(a)) || byFamily(a, b),
  discount: (a, b) => bestDiscount(b) - bestDiscount(a) || byFamily(a, b),
  context: (a, b) => (b.context || 0) - (a.context || 0) || byFamily(a, b),
};
/** Ordena uma cópia da lista; "family" é a ordem padrão do /models. `extra` acrescenta ordenações próprias da página. */
export function sortModels(list, sort = 'family', extra = {}) {
  return [...list].sort(extra[sort] || sorters[sort] || byFamily);
}
