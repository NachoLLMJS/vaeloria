import { ITEMS } from '../sim/data';
import type { InvSlot, ItemDef } from '../sim/types';

export type MarketplaceCategory = 'weapon' | 'armor' | 'consumable' | 'material' | 'quest' | 'misc';
export type MarketplaceCurrency = 'GOLD';
export type MarketplaceListingStatus = 'active' | 'sold' | 'cancelled';

export interface MarketplaceItemRegistryEntry {
  itemId: string;
  name: string;
  category: MarketplaceCategory;
  quality: NonNullable<ItemDef['quality']>;
  tradable: boolean;
}

export interface MarketplaceListing {
  id: string;
  itemInstanceId: string;
  itemId: string;
  seller: string;
  price: number;
  currency: MarketplaceCurrency;
  status: MarketplaceListingStatus;
  listedAt: number;
  cancelledAt?: number;
  soldAt?: number;
}

export interface MarketableInventoryItem extends MarketplaceItemRegistryEntry {
  count: number;
  itemInstanceId: string;
}

const STORAGE_KEY = 'vaeloria_marketplace_listings_v2_game_currency';

export function categoryForItem(item: ItemDef): MarketplaceCategory {
  if (item.kind === 'weapon') return 'weapon';
  if (item.kind === 'armor') return 'armor';
  if (item.kind === 'food' || item.kind === 'drink') return 'consumable';
  if (item.kind === 'quest') return 'quest';
  if (item.id.includes('fish') || item.id.includes('wood') || item.id.includes('silk')) return 'material';
  return 'misc';
}

export function itemRegistryEntry(itemId: string): MarketplaceItemRegistryEntry | null {
  const item = ITEMS[itemId];
  if (!item) return null;
  const category = categoryForItem(item);
  const tradable = item.kind !== 'quest' && !item.questId;
  return {
    itemId,
    name: item.name,
    category,
    quality: item.quality ?? 'common',
    tradable,
  };
}

export function marketableInventory(inventory: InvSlot[]): MarketableInventoryItem[] {
  const result: MarketableInventoryItem[] = [];
  for (const slot of inventory) {
    const entry = itemRegistryEntry(slot.itemId);
    if (!entry?.tradable || slot.count <= 0) continue;
    result.push({ ...entry, count: slot.count, itemInstanceId: `bag-${slot.itemId}` });
  }
  return result;
}

export function marketplaceCategories(listings: MarketplaceListing[], inventory: InvSlot[]): MarketplaceCategory[] {
  const cats = new Set<MarketplaceCategory>();
  for (const listing of listings) {
    const entry = itemRegistryEntry(listing.itemId);
    if (entry) cats.add(entry.category);
  }
  for (const item of marketableInventory(inventory)) cats.add(item.category);
  return [...cats].sort();
}

function normalizeListing(raw: any): MarketplaceListing | null {
  if (!raw || typeof raw !== 'object' || !ITEMS[raw.itemId]) return null;
  return {
    id: String(raw.id ?? `listing-${Date.now()}`),
    itemInstanceId: String(raw.itemInstanceId ?? `instance-${raw.itemId}-${Date.now()}`),
    itemId: String(raw.itemId),
    seller: String(raw.seller ?? ''),
    price: Math.max(0, Number(raw.price ?? 0)),
    currency: 'GOLD',
    status: raw.status === 'sold' ? 'sold' : raw.status === 'cancelled' ? 'cancelled' : 'active',
    listedAt: Number(raw.listedAt ?? Date.now()),
    cancelledAt: typeof raw.cancelledAt === 'number' ? raw.cancelledAt : undefined,
    soldAt: typeof raw.soldAt === 'number' ? raw.soldAt : undefined,
  };
}

export function loadAllMarketplaceListings(): MarketplaceListing[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    return Array.isArray(parsed) ? parsed.map(normalizeListing).filter((l): l is MarketplaceListing => !!l) : [];
  } catch {
    return [];
  }
}

export function loadMarketplaceListings(): MarketplaceListing[] {
  return loadAllMarketplaceListings().filter((l) => l.status === 'active');
}

export function saveMarketplaceListings(listings: MarketplaceListing[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(listings));
}

export function createGameListing(input: { listings: MarketplaceListing[]; itemId: string; seller: string; price: number }): { listing: MarketplaceListing; listings: MarketplaceListing[] } {
  const now = Date.now();
  const itemInstanceId = `item-${input.seller.slice(0, 12).replace(/[^a-zA-Z0-9_-]/g, '')}-${input.itemId}-${now}`;
  const listing: MarketplaceListing = {
    id: `listing-${itemInstanceId}`,
    itemInstanceId,
    itemId: input.itemId,
    seller: input.seller,
    price: input.price,
    currency: 'GOLD',
    status: 'active',
    listedAt: now,
  };
  return { listing, listings: [listing, ...input.listings] };
}

export function cancelGameListing(listings: MarketplaceListing[], listingId: string): { listing: MarketplaceListing | null; listings: MarketplaceListing[] } {
  let cancelled: MarketplaceListing | null = null;
  const next = listings.map((l) => {
    if (l.id !== listingId || l.status !== 'active') return l;
    cancelled = { ...l, status: 'cancelled', cancelledAt: Date.now() };
    return cancelled;
  });
  return { listing: cancelled, listings: next };
}
