"use client";

import type { PaymentMethod, ProductRecord } from "@/contracts/schemas";
import { create } from "zustand";

export interface CartItem {
  productId: string;
  sku: string;
  name: string;
  unitPriceCents: number;
  unitCostCents: number;
  maxStock: number;
  quantity: number;
}

export type ActiveTab = "pos" | "inventory" | "finance";

interface PosState {
  activeTab: ActiveTab;
  cart: CartItem[];
  paymentMethod: PaymentMethod;
  simulateOffline: boolean;
  browserOnline: boolean;
  setActiveTab: (tab: ActiveTab) => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  setSimulateOffline: (value: boolean) => void;
  setBrowserOnline: (value: boolean) => void;
  addToCart: (product: ProductRecord) => void;
  updateQty: (productId: string, delta: number) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;
}

export const usePosStore = create<PosState>((set) => ({
  activeTab: "pos",
  cart: [],
  paymentMethod: "cash",
  simulateOffline: false,
  browserOnline: true,
  setActiveTab: (activeTab) => set({ activeTab }),
  setPaymentMethod: (paymentMethod) => set({ paymentMethod }),
  setSimulateOffline: (simulateOffline) => set({ simulateOffline }),
  setBrowserOnline: (browserOnline) => set({ browserOnline }),
  addToCart: (product) =>
    set((state) => {
      if (product.stock <= 0) return state;
      const existing = state.cart.find((item) => item.productId === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) return state;
        return {
          cart: state.cart.map((item) =>
            item.productId === product.id
              ? {
                  ...item,
                  quantity: item.quantity + 1,
                  maxStock: product.stock,
                }
              : item,
          ),
        };
      }
      return {
        cart: [
          ...state.cart,
          {
            productId: product.id,
            sku: product.sku,
            name: product.name,
            unitPriceCents: product.priceCents,
            unitCostCents: product.costCents,
            maxStock: product.stock,
            quantity: 1,
          },
        ],
      };
    }),
  updateQty: (productId, delta) =>
    set((state) => ({
      cart: state.cart
        .map((item) => {
          if (item.productId !== productId) return item;
          const next = Math.min(item.maxStock, item.quantity + delta);
          return { ...item, quantity: next };
        })
        .filter((item) => item.quantity > 0),
    })),
  removeFromCart: (productId) =>
    set((state) => ({
      cart: state.cart.filter((item) => item.productId !== productId),
    })),
  clearCart: () => set({ cart: [] }),
}));
