import {
  MINI_URL,
  fetchApplePage,
  extractMacMiniProducts,
  formatPrice,
  parseSpecsString,
  parseChip,
  parseSpecsStructured,
  type Product,
} from "./lib/scrape";

function parseStorageGB(storage: string): number {
  const tb = storage.match(/(\d+)\s*TB/i);
  if (tb) return +tb[1] * 1024;
  const gb = storage.match(/(\d+)\s*GB/i);
  if (gb) return +gb[1];
  return 0;
}

function meetsAlertCriteria(product: Product): boolean {
  const specs = parseSpecsStructured(product.description);
  const ram = specs.ram.match(/(\d+)/);

  if (!ram) return false;

  return +ram[1] >= 64;
}


function buildSlackMessage(minis: Product[]): { text: string } {
  const lines = minis.map((p) => {
    const specs = parseSpecsString(p.description);
    const specLine = specs ? `\n    ${specs}` : "";
    return `• *${formatPrice(p)}* — ${p.name}${specLine}`;
  });
  const text = [
    `🖥️ *${minis.length} Mac Mini${minis.length > 1 ? "s" : ""} spotted on Apple Refurbished!*`,
    "",
    ...lines,
    "",
    `👉 ${MINI_URL}`,
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

async function main() {
  console.log("Fetching Apple refurbished Mac Mini page...");
  const html = await fetchApplePage(MINI_URL);

  const allMinis = extractMacMiniProducts(html);
  console.log(`Found ${allMinis.length} Mac Mini(s)`);

  const minis = allMinis.filter(meetsAlertCriteria);
  const filtered = allMinis.length - minis.length;
  if (filtered > 0) {
    console.log(`Filtered out ${filtered} model(s) below 64GB RAM`);
  }

  if (minis.length === 0) {
    console.log("No qualifying Mac Minis found. Exiting.");
    return;
  }

  for (const mini of minis) {
    console.log(`  → ${mini.name} — ${formatPrice(mini)}`);
  }

  const message = buildSlackMessage(minis);
  await notifySlack(message);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
