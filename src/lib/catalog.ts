export type ProductMedia = {
  id: string;
  src: string;
  alt: string;
  label: string;
};

export type ProductVariant = {
  id: string;
  sku: string;
  options: Record<string, string>;
  price: number;
  compareAtPrice?: number;
  stock: number;
  mediaIds: string[];
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  category: string;
  price: number;
  compareAtPrice?: number;
  color: string;
  colors: { name: string; value: string }[];
  vendor: string;
  description: string;
  image: string;
  imageAlt: string;
  details: string[];
  stock: number;
  media: ProductMedia[];
  optionGroups: { name: string; values: { name: string; value?: string }[] }[];
  variants: ProductVariant[];
};

export const categories = ["Home & living", "Tech", "Everyday carry"];

export type LibraryImage = { id: string; src: string; alt: string; label: string };

// Photos available to the product editor. Uploads are future work; these are the
// existing local images documented in public/ASSET-SOURCES.md.
export const mediaLibrary: readonly LibraryImage[] = [
  { id: "lounge-chair", src: "/images/lounge-chair.jpg", alt: "White curved lounge chair with a polished pedestal base beside gray curtains.", label: "Lounge chair" },
  { id: "studio-headphones", src: "/images/studio-headphones.jpg", alt: "Ivory over-ear headphones with cushioned ear pads on a white background.", label: "Headphones" },
  { id: "globe-lamp", src: "/images/globe-lamp.jpg", alt: "White globe table lamp on a chrome base, standing on a marble table in front of beige curtains.", label: "Globe lamp" },
  { id: "commuter-backpack", src: "/images/commuter-backpack.jpg", alt: "Brown canvas-style backpack with a front flap pocket as a laptop is placed inside.", label: "Backpack" },
  { id: "ceramic-mug", src: "/images/ceramic-mug.jpg", alt: "Sage-green ribbed ceramic mug with a curved handle casting a shadow in natural light.", label: "Sage mug" },
  { id: "ritual-sage-detail", src: "/images/ritual-sage-detail.png", alt: "Alternate view of the Sage ribbed ceramic mug and its curved handle.", label: "Sage mug detail" },
  { id: "ritual-oat", src: "/images/ritual-oat.png", alt: "Oat-colored ribbed ceramic mug with a curved handle.", label: "Oat mug" },
  { id: "compact-camera", src: "/images/compact-camera.jpg", alt: "Side view of a dark compact camera with its rear display tilted outward on a neutral surface.", label: "Compact camera" },
  { id: "studio-speaker", src: "/images/studio-speaker.jpg", alt: "Black desktop speaker with wood-tone side panels on a desk under cool studio lighting.", label: "Desktop speaker" },
  { id: "mesh-watch", src: "/images/mesh-watch.jpg", alt: "Silver-tone analog wristwatch with a minimal dial and fine mesh strap on a wooden surface.", label: "Mesh watch" },
  { id: "editorial-room", src: "/images/editorial-room.jpg", alt: "A quiet, sunlit contemporary living room.", label: "Living room" },
];

export function getDefaultVariant(product: Product): ProductVariant {
  return product.variants[0];
}

export function getVariant(product: Product, variantId: string): ProductVariant | undefined {
  return product.variants.find(variant => variant.id === variantId);
}

export function getVariantMedia(product: Product, variant: ProductVariant): ProductMedia[] {
  return variant.mediaIds.flatMap(id => {
    const media = product.media.find(item => item.id === id);
    return media ? [media] : [];
  });
}

export function getVariantLabel(variant: ProductVariant): string {
  return Object.values(variant.options).join(" · ");
}
