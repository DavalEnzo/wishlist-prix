import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/session.ts';

export default async function Home() {
  redirect((await getCurrentUser()) ? '/wishlist' : '/login');
}
