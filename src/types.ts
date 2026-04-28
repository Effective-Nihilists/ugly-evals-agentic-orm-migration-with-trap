export interface Customer {
  id: string;
  email: string;
  createdAt: number;
}

export interface Order {
  id: string;
  customerId: string;
  totalCents: number;
  status: 'pending' | 'paid' | 'refunded' | 'cancelled';
  createdAt: number;
}

export interface Subscription {
  id: string;
  customerId: string;
  plan: 'starter' | 'pro' | 'enterprise';
  status: 'active' | 'cancelled' | 'past_due';
  startedAt: number;
  cancelledAt: number | null;
}

export type LineItemParentType = 'order' | 'subscription';

export interface LineItem {
  id: string;
  parentType: LineItemParentType;
  parentId: string;
  sku: string;
  qty: number;
  unitPriceCents: number;
  createdAt: number;
}

export type LineItemParent =
  | { type: 'order'; order: Order }
  | { type: 'subscription'; subscription: Subscription };
