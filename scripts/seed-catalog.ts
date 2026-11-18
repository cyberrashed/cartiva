// Inserts the sample collection and the default shipping settings. Safe to run
// repeatedly: existing products (matched by ID) and saved settings are left as edited.
import { productInputSchema, productToInput } from "../src/lib/catalog-admin";
import { sampleProducts } from "../src/lib/sample-catalog";
import { pool } from "../src/server/db";
import { seedCatalogProduct } from "../src/server/catalog";
import { seedShippingSettings } from "../src/server/checkout-settings";

async function main() {
  try {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
    let inserted = 0;
    for (const [position, product] of sampleProducts.entries()) {
      const input = productInputSchema.parse(productToInput(product));
      if (await seedCatalogProduct({ ...input, id: product.id, slug: product.slug, position })) inserted++;
    }
    console.log(`Catalog seed complete: ${inserted} added, ${sampleProducts.length - inserted} already present.`);
    console.log(await seedShippingSettings() ? "Default shipping settings added." : "Shipping settings already present.");
    if (process.env.DEMO_MODE === "true") {
      // Public portfolio deployments: shared demo accounts and the demo codes.
      const { ensureDemoAccounts, seedDemoCoupons } = await import("../src/server/demo");
      console.log(`Demo accounts ready: ${(await ensureDemoAccounts()).length}.`);
      await seedDemoCoupons();
      console.log("Demo codes present.");
    }
  } finally {
    await pool.end();
  }
}

void main().catch(error => {
  console.error("Seed failed. Check that migrations are applied and the database is running.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
