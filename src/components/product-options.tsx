"use client";

import { useState } from "react";
import { getDefaultVariant, getVariant, getVariantLabel, type Product } from "@/lib/catalog";
import { useStore } from "./store-provider";
import "@/app/variant-options.css";

export function useProductSelection(product: Product, initialVariantId?: string) {
  const { lines, setQuantity } = useStore();
  const initial = initialVariantId === undefined ? getDefaultVariant(product) : getVariant(product, initialVariantId);
  const [options, setOptions] = useState<Record<string, string>>(() => ({ ...initial?.options }));
  const [quantity, setAmount] = useState(1);
  const [message, setMessage] = useState("");
  const variant = product.variants.find(candidate => product.optionGroups.every(group => candidate.options[group.name] === options[group.name]));
  const inBag = lines.find(line => line.productId === product.id && line.variantId === variant?.id)?.quantity ?? 0;
  const remaining = Math.max(0, (variant?.stock ?? 0) - inBag);
  const amount = Math.min(quantity, remaining);
  const stockMessage = !variant ? "This combination is unavailable. Choose another option." : variant.stock === 0 ? "Out of stock" : remaining === 0 ? "All available units of this option are in your bag" : `${remaining} available`;

  function changeOption(name: string, value: string) {
    setOptions(current => ({ ...current, [name]: value }));
    setAmount(1);
    setMessage("");
  }
  function reset() {
    setOptions({ ...getDefaultVariant(product).options });
    setAmount(1);
    setMessage("");
  }
  function add() {
    if (!variant || amount < 1) return;
    setQuantity(product, variant.id, inBag + amount);
    setMessage(`${amount} ${amount === 1 ? "item" : "items"} added to your bag: ${getVariantLabel(variant)}.`);
  }
  return { options, variant, remaining, amount, message, stockMessage, setAmount, changeOption, reset, add };
}

export function ProductOptions({ product, options, onChange }: {
  product: Product;
  options: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  return <div className="variant-options">{product.optionGroups.map(group => <fieldset className="color-options" key={group.name}>
    <legend>{group.name}: {options[group.name] ?? "Choose an option"}</legend>
    <div className="variant-option-values">{group.values.map(value => {
      const matches = product.variants.filter(candidate => product.optionGroups.every(other => other.name === group.name ? candidate.options[other.name] === value.name : options[other.name] === undefined || candidate.options[other.name] === options[other.name]));
      const availability = !matches.length ? "Unavailable" : matches.every(candidate => candidate.stock === 0) ? "Sold out" : "";
      return <button type="button" key={value.name} aria-pressed={options[group.name] === value.name} className={options[group.name] === value.name ? "selected" : ""} onClick={() => onChange(group.name, value.name)}>
        {value.value && <span aria-hidden="true" style={{ backgroundColor: value.value }} />}{value.name}{availability && <small>{availability}</small>}
      </button>;
    })}</div>
  </fieldset>)}</div>;
}
