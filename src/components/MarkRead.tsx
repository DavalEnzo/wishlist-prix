'use client';

import { useEffect } from 'react';
import { markAllReadAction } from '@/app/actions/wishlist.ts';

/** Marks the notifications as read once the page is shown (they stay highlighted until the next visit). */
export function MarkRead() {
  useEffect(() => {
    const t = setTimeout(() => void markAllReadAction(), 1500);
    return () => clearTimeout(t);
  }, []);
  return null;
}
