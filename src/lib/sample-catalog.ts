import type { Product } from "./catalog.ts";

// Fictional collection for the Cartiva prototype. Prices are USD cents; names,
// vendors, stock and descriptions are sample data, not live offers.
// `scripts/seed-catalog.ts` copies these into PostgreSQL; the storefront reads
// the database. Sample orders, dashboards and the content preview still use
// this list directly because they are explicitly sample screens.
const collection: Omit<Product, "media" | "optionGroups" | "variants">[] = [
  {
    id: "arc-lounge-chair",
    slug: "arc-lounge-chair",
    name: "Arc lounge chair",
    category: "Home & living",
    price: 42000,
    color: "Chalk",
    colors: [{ name: "Chalk", value: "#e8e8e3" }],
    vendor: "Form & Field",
    description:
      "A sculptural seat for your quiet corner. A sweeping silhouette and pale upholstery make room for a slower moment.",
    image: "/images/lounge-chair.jpg",
    imageAlt: "White curved lounge chair with a polished pedestal base beside gray curtains.",
    details: ["Curved high-back silhouette", "Light upholstery", "Polished pedestal base"],
    stock: 8,
  },
  {
    id: "studio-headphones",
    slug: "studio-headphones",
    name: "Studio headphones",
    category: "Tech",
    price: 14800,
    color: "Ivory",
    colors: [{ name: "Ivory", value: "#e8e2d8" }],
    vendor: "Signal Studio",
    description:
      "A little space for your favorite sound. Rounded forms and a soft neutral finish fit naturally into the everyday.",
    image: "/images/studio-headphones.jpg",
    imageAlt: "Ivory over-ear headphones with cushioned ear pads on a white background.",
    details: ["Over-ear silhouette", "Cushioned ear pads", "Pale neutral finish"],
    stock: 24,
  },
  {
    id: "halo-table-light",
    slug: "halo-table-light",
    name: "Halo table light",
    category: "Home & living",
    price: 9600,
    color: "Opal & chrome",
    colors: [{ name: "Opal & chrome", value: "#d3d5d2" }],
    vendor: "Form & Field",
    description:
      "A simple sphere with a reflective base. An easy accent for the bedside, a console, or the place you settle in to read.",
    image: "/images/globe-lamp.jpg",
    imageAlt: "White globe table lamp on a chrome base, standing on a marble table in front of beige curtains.",
    details: ["Spherical shade", "Reflective circular base", "Compact tabletop silhouette"],
    stock: 16,
  },
  {
    id: "field-commuter-bag",
    slug: "field-commuter-bag",
    name: "Field commuter bag",
    category: "Everyday carry",
    price: 8900,
    color: "Sandstone",
    colors: [{ name: "Sandstone", value: "#a47b51" }],
    vendor: "Wayfare Goods",
    description:
      "From the first coffee to the last stop. A warm, understated carry with a roomy profile and a place for the small things.",
    image: "/images/commuter-backpack.jpg",
    imageAlt: "Brown canvas-style backpack with a front flap pocket as a laptop is placed inside.",
    details: ["Front flap pocket", "Adjustable shoulder straps", "Warm canvas-style finish"],
    stock: 19,
  },
  {
    id: "ritual-ceramic-mug",
    slug: "ritual-ceramic-mug",
    name: "Ritual ceramic mug",
    category: "Home & living",
    price: 2800,
    color: "Sage",
    colors: [{ name: "Sage", value: "#91977b" }],
    vendor: "Form & Field",
    description:
      "A familiar ritual, thoughtfully framed. A ribbed surface, rounded handle, and muted glaze make the everyday coffee feel considered.",
    image: "/images/ceramic-mug.jpg",
    imageAlt: "Sage-green ribbed ceramic mug with a curved handle casting a shadow in natural light.",
    details: ["Vertical ribbed surface", "Generous curved handle", "Sage or Oat glaze", "Choose a single mug or a pair of the same color"],
    stock: 36,
  },
  {
    id: "focus-compact-camera",
    slug: "focus-compact-camera",
    name: "Focus compact camera",
    category: "Tech",
    price: 34900,
    color: "Graphite",
    colors: [{ name: "Graphite", value: "#343533" }],
    vendor: "Signal Studio",
    description:
      "For the details worth noticing. A compact form and a tilting display invite a fresh perspective on familiar places.",
    image: "/images/compact-camera.jpg",
    imageAlt: "Side view of a dark compact camera with its rear display tilted outward on a neutral surface.",
    details: ["Compact camera body", "Tilting rear display", "Dark graphite finish"],
    stock: 11,
  },
  {
    id: "form-desktop-speaker",
    slug: "form-desktop-speaker",
    name: "Form desktop speaker",
    category: "Tech",
    price: 12900,
    color: "Walnut & black",
    colors: [{ name: "Walnut & black", value: "#5d4037" }],
    vendor: "Signal Studio",
    description:
      "Give your desk a different soundtrack. Warm wood tones and a dark face bring a grounded presence to your listening space.",
    image: "/images/studio-speaker.jpg",
    imageAlt: "Black desktop speaker with wood-tone side panels on a desk under cool studio lighting.",
    details: ["Wood-tone side panels", "Dark front baffle", "Desktop form"],
    stock: 14,
  },
  {
    id: "line-mesh-watch",
    slug: "line-mesh-watch",
    name: "Line mesh watch",
    category: "Everyday carry",
    price: 11200,
    color: "Brushed silver",
    colors: [{ name: "Brushed silver", value: "#b8b9b6" }],
    vendor: "Wayfare Goods",
    description:
      "An everyday detail with a quieter point of view. A clean dial and a fine mesh strap keep the form simple.",
    image: "/images/mesh-watch.jpg",
    imageAlt: "Silver-tone analog wristwatch with a minimal dial and fine mesh strap on a wooden surface.",
    details: ["Minimal analog face", "Silver-tone mesh strap", "Round case"],
    stock: 22,
  },
];

export const sampleProducts: Product[] = collection.map(product => {
  if (product.id === "ritual-ceramic-mug") {
    return {
      ...product,
      colors: [{ name: "Sage", value: "#91977b" }, { name: "Oat", value: "#ded2bb" }],
      media: [
        { id: "sage-original", src: product.image, alt: product.imageAlt, label: "Sage · front" },
        { id: "sage-detail", src: "/images/ritual-sage-detail.png", alt: "Alternate view of the Sage ribbed ceramic mug and its curved handle.", label: "Sage · detail" },
        { id: "oat", src: "/images/ritual-oat.png", alt: "Oat-colored ribbed ceramic mug with a curved handle.", label: "Oat · front" },
      ],
      optionGroups: [
        { name: "Color", values: [{ name: "Sage", value: "#91977b" }, { name: "Oat", value: "#ded2bb" }] },
        { name: "Set", values: [{ name: "Single" }, { name: "Pair" }] },
      ],
      // Stock counts sellable sets. Pair stock is independently packed, not drawn
      // from the Single SKU. All prices and quantities remain sample data.
      variants: [
        { id: "ritual-sage-single", sku: "CV-RIT-SAG-1", options: { Color: "Sage", Set: "Single" }, price: 2800, stock: 36, mediaIds: ["sage-original", "sage-detail"] },
        { id: "ritual-sage-pair", sku: "CV-RIT-SAG-2", options: { Color: "Sage", Set: "Pair" }, price: 5200, stock: 4, mediaIds: ["sage-original", "sage-detail"] },
        { id: "ritual-oat-single", sku: "CV-RIT-OAT-1", options: { Color: "Oat", Set: "Single" }, price: 3200, stock: 3, mediaIds: ["oat"] },
        { id: "ritual-oat-pair", sku: "CV-RIT-OAT-2", options: { Color: "Oat", Set: "Pair" }, price: 6000, stock: 0, mediaIds: ["oat"] },
      ],
    };
  }

  return {
    ...product,
    media: [{ id: "main", src: product.image, alt: product.imageAlt, label: product.color }],
    optionGroups: [{ name: "Color", values: product.colors }],
    variants: [{
      id: `${product.id}-default`,
      sku: `CV-${product.id.toUpperCase()}`,
      options: { Color: product.color },
      price: product.price,
      compareAtPrice: product.compareAtPrice,
      stock: product.stock,
      mediaIds: ["main"],
    }],
  };
});
