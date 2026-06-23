import {
  MINI_URL,
  STUDIO_URL,
  fetchApplePage,
  extractTargetMacProducts,
  formatPrice,
  parseSpecsString,
  parseSpecsStructured,
  type Product,
} from "./lib/scrape";

const MIN_RAM_GB = 64;

function getRamGB(product: Product): number {
  const specs = parseSpecsStructured(product.description);
  const ram = specs.ram.match(/(\d+)/);

  return ram ? Number(ram[1]) : 0;
}

function meetsAlertCriteria(product: Product): boolean {
  return getRamGB(product) >= MIN_RAM_GB;
}

function buildSlackMessage(products: Product[]): { text: string } {
  const lines = products.map((product) => {
    const specs = parseSpecsString(product.description);
    const specLine = specs ? `\n   ${specs}` : "";
    const linkLine = product.sku
      ? `\n   SKU: ${product.sku}`
      : "";

    return `• *${formatPrice(product)}* — ${product.name}${specLine}${linkLine}`;
  });

  const text = [
    `🚨 *${products.length} Apple refurbished Mac Mini / Mac Studio model${
      products.length > 1 ? "s" : ""
    } with ${MIN_RAM_GB}GB+ RAM spotted!*`,
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
    console.log("SLACK_WEBHOOK_URL not set. Skipping Slack notification.");
    console.log("Message that would be sent:");
    console.log(JSON.stringify(message, null, 2));
    return;
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
  }

  console.log("Slack notification sent successfully");
}

async function fetchProductsFrom(url: string): Promise<Product[]> {
  const html = await fetchApplePage(url);
  return extractTargetMacProducts(html);
}

async function main(): Promise<void> {
  console.log("Fetching Apple refurbished Mac Mini and Mac Studio pages...");

  const [miniProducts, studioProducts] = await Promise.all([
    fetchProductsFrom(MINI_URL),
    fetchProductsFrom(STUDIO_URL),
  ]);

  const allProducts = [...miniProducts, ...studioProducts];

  console.log(`Found ${miniProducts.length} Mac Mini model(s)`);
  console.log(`Found ${studioProducts.length} Mac Studio model(s)`);

  const qualifyingProducts = allProducts.filter(meetsAlertCriteria);
  const filteredCount = allProducts.length - qualifyingProducts.length;

  console.log(`Filtered out ${filteredCount} model(s) below ${MIN_RAM_GB}GB RAM`);

  if (qualifyingProducts.length === 0) {
    console.log(`No qualifying Mac Mini / Mac Studio models found with ${MIN_RAM_GB}GB+ RAM. Exiting.`);
    return;
  }

  console.log(`Found ${qualifyingProducts.length} qualifying model(s):`);

  for (const product of qualifyingProducts) {
    const ramGB = getRamGB(product);
    console.log(` → ${product.name} — ${formatPrice(product)} — ${ramGB}GB RAM`);
  }

  const message = buildSlackMessage(qualifyingProducts);
  await notifySlack(message);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
