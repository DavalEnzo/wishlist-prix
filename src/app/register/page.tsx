import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { RegisterForm } from '@/components/AuthForms.tsx';
import { config } from '@/lib/config.ts';
import { getCurrentUser } from '@/server/session.ts';

export const metadata: Metadata = { title: 'Créer un compte' };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect('/wishlist');
  return (
    <main className="authpage">
      <div className="authcard">
        <h1>Créer un compte</h1>
        <p className="lead">Ajoute tes jeux, fixe un prix cible, et reçois une alerte quand ça baisse.</p>
        <RegisterForm discord={config.discord !== null} inviteRequired={Boolean(config.signupCode)} />
      </div>
    </main>
  );
}
