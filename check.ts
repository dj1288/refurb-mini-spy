import {
  MINI_URL,
  STUDIO_URL,
  fetchApplePage,
  extractMacMiniProducts,
  formatPrice,
  parseSpecsString,
  parseSpecsStructured,
  type Product,
} from "./lib/scrape";

function getRamGB(product: Product): number {
  const specs = parseSpecsStructured(product.description);
  const ram = specs.ram.match(/(\d+)/);

  return ram ? +ram[1] : 0;
}

function meetsAlertCriteria(product: Product): boolean {
  return getRamGB(product) >= 64;
}

function buildSlackMessage(products: Product[]): { text: string } {
  const lines = products.map((p) => {
    const specs = parseSpecsString(p.description);
    const specLine = specs ? `\n   ${specs}` : "";

    return `• *${formatPrice(p)}* — ${p.name}${specLine}`;
  });

  const text = [
    `🚨 *${products.length} Mac Mini / Mac Studio model${products.length > 1 ? "s" : ""} with 64GB+ RAM spotted on Apple Refurbished!*`,
    "",
    ...lines,
    "",
    `Mac mini: ${MINI_URL}`,
    `Mac Studio: ${STUDIO_URL}`,
  ].join("\n");

  return { text };
}

async function notifySlack(message: { text: string }): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log("SLACK_WEBHOOK_URL not set — skipping Slack notification");
    console.log("Message that would be sent:", JSON.stringify(message, null, 2));
    return;
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
  }

  console.log("Slack notification sent successfully");
}

async function fetchProductsFrom(url: string): Promise<Product[]> {
  const html = await fetchApplePage(url);
  return extractMacMiniProducts(html);
}

async function main() {
  console.log("Fetching Apple refurbished Mac Mini and Mac Studio pages...");

  const [miniProducts, studioProducts] = await Promise.all([
    fetchProductsFrom(MINI_URL),
    fetchProductsFrom(STUDIO_URL),
  ]);

  const allProducts = [...miniProducts, ...studioProducts];

  console.log(`Found ${miniProducts.length} Mac Mini(s)`);
  console.log(`Found ${studioProducts.length} Mac Studio(s)`);

  const qualifyingProducts = allProducts.filter(meetsAlertCriteria);
  const filtered = allProducts.length - qualifyingProducts.length;

  if (filtered > 0) {
    console.log(`Filtered out ${filtered} model(s) below 64GB RAM`);
  }

  if (qualifyingProducts.length === 0) {
    console.log("No qualifying Mac Mini / Mac Studio models found. Exiting.");
    return;
  }

  for (const product of qualifyingProducts) {
    console.log(` → ${product.name} — ${formatPrice(product)}`);
  }

  const message = buildSlackMessage(qualifyingProducts);
  await notifySlack(message);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
