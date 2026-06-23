export const MINI_URL = "https://www.apple.com/shop/refurbished/mac/mac-mini";
export const STUDIO_URL = "https://www.apple.com/shop/refurbished/mac/mac-studio";

export interface Offer {
  price?: string | number;
  priceCurrency?: string;
}

export interface Product {
  "@type"?: string;
  name?: string;
  description?: string;
  sku?: string;
  offers?: Offer | Offer[];
}

export async function fetchApplePage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Apple refurbished page: ${res.status}`);
  }
  return res.text();
}

function isTargetMac(name?: string): boolean {
  return !!name && /(mac\s*mini|mac\s*studio)/i.test(name);
}

function extractFromJsonLd(html: string): Product[] {
  const pattern = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  const products: Product[] = [];
  for (const match of html.matchAll(pattern)) {
    try {
      const data = JSON.parse(match[1]);
      const items: Product[] = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item["@type"] === "Product" && isMacMini(t.title)) {
          products.push(item);
        }
      }
    } catch { /* skip malformed JSON-LD */ }
  }
  return products;
}

function buildDescription(title: string, dims: Record<string, string>): string {
  const parts: string[] = [];
  const mem = dims.tsMemorySize?.match(/(\d+)/);
  if (mem) parts.push(`${mem[1]}GB unified memory`);
  const cap = dims.dimensionCapacity?.match(/(\d+)(gb|tb)/i);
  if (cap) parts.push(`${cap[1]}${cap[2].toUpperCase()} SSD`);
  // Title included so downstream spec parsers can extract Ethernet info
  parts.push(title);
  return parts.join(" · ");
}

interface BootstrapTile {
  title?: string;
  partNumber?: string;
  price?: { currentPrice?: { raw_amount?: number }; priceCurrency?: string };
  filters?: { dimensions?: Record<string, string> };
}

function tileToProduct(tile: BootstrapTile): Product {
  const title = tile.title?.trim() ?? "";
  const dims = tile.filters?.dimensions ?? {};
  return {
    name: title,
    sku: tile.partNumber ?? "",
    description: buildDescription(title, dims),
    offers: {
      price: tile.price?.currentPrice?.raw_amount,
      priceCurrency: tile.price?.priceCurrency ?? "USD",
    },
  };
}

function extractFromBootstrap(html: string): Product[] {
  const match = html.match(
    /window\.REFURB_GRID_BOOTSTRAP\s*=\s*(\{[\s\S]*?\});\s*<\/script>/,
  );
  if (!match) return [];
  try {
    const data = JSON.parse(match[1]);
    const tiles: BootstrapTile[] = data.tiles ?? [];
    return tiles
      .filter((t) => isTargetMac(t.title))
      .map(tileToProduct);
  } catch {
    return [];
  }
}

export function extractMacMiniProducts(html: string): Product[] {
  const jsonLd = extractFromJsonLd(html);
  if (jsonLd.length > 0) {
    console.log("Extracted products via JSON-LD");
    return jsonLd;
  }
  console.log("JSON-LD had no products, falling back to REFURB_GRID_BOOTSTRAP");
  return extractFromBootstrap(html);
}

export function getOffer(product: Product): Offer | undefined {
  if (!product.offers) return undefined;
  return Array.isArray(product.offers) ? product.offers[0] : product.offers;
}

export function getPrice(product: Product): number | null {
  const offer = getOffer(product);
  if (offer?.price == null) return null;
  return Number(offer.price);
}

export function formatPrice(product: Product): string {
  const offer = getOffer(product);
  if (offer?.price == null) return "price unknown";
  const currency = offer.priceCurrency ?? "USD";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    Number(offer.price),
  );
}

export function parseSpecsString(description?: string): string {
  if (!description) return "";
  const cleaned = description.replace(/Originally released\s+\w+\s+\d{4}/, "");
  const specs: string[] = [];
  const mem = cleaned.match(/(\d+)GB unified memory/);
  if (mem) specs.push(mem[1] + "GB RAM");
  const storage = cleaned.match(/(\d+[GT]B) SSD/);
  if (storage) specs.push(storage[1] + " SSD");
  const eth = cleaned.match(/\d*(10 Gigabit|Gigabit) Ethernet/);
  if (eth) specs.push(eth[1] + " Ethernet");
  const tb = cleaned.match(/((?:Three|Four|Two|\d+) Thunderbolt \d+ ports?)/);
  if (tb) specs.push(tb[1]);
  return specs.join(" · ");
}

export interface ChipInfo {
  chip: string;
  generation: number;
  cpuCores: number;
  gpuCores: number;
}

const CHIP_VARIANT_PATTERNS: Array<[string, RegExp]> = [
  ["Pro", /M(\d+)\s*Pro[-\s]*(\d+)[-\s]*core CPU[-\s]*(\d+)[-\s]*core GPU/i],
  ["", /M(\d+)[-\s]*(\d+)[-\s]*core CPU[-\s]*(\d+)[-\s]*core GPU/i],
];

export function parseChip(name: string): ChipInfo {
  for (const [variant, pattern] of CHIP_VARIANT_PATTERNS) {
    const m = name.match(pattern);
    if (m) {
      const generation = +m[1];
      const chip = variant ? `M${generation} ${variant}` : `M${generation}`;
      return { chip, generation, cpuCores: +m[2], gpuCores: +m[3] };
    }
  }
  return { chip: "Intel", generation: 0, cpuCores: 0, gpuCores: 0 };
}

export interface SpecsInfo {
  ram: string;
  storage: string;
  ethernet: string;
}

export function parseSpecsStructured(desc?: string): SpecsInfo {
  if (!desc) return { ram: "", storage: "", ethernet: "GbE" };
  const cleaned = desc.replace(/Originally released\s+\w+\s+\d{4}/, "");
  const mem = cleaned.match(/(\d+)\s*GB\s*unified\s*memory/i);
  const ram = mem ? `${mem[1]}GB` : "";
  const stor = cleaned.match(/(\d+\s*[GT]B)\s*SSD/i);
  const storage = stor ? stor[1].replace(/\s+/g, "") : "";
  const eth = /10\s*Gigabit\s*Ethernet/i.test(cleaned) ? "10GbE" : "GbE";
  return { ram, storage, ethernet: eth };
}
