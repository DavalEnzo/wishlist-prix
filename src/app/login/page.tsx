import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/AuthForms.tsx';
import { config } from '@/lib/config.ts';
import { getCurrentUser } from '@/server/session.ts';

export const metadata: Metadata = { title: 'Connexion' };

const ERRORS: Record<string, string> = {
  discord_cancel: 'Connexion Discord annulée.',
  discord_failed: 'La connexion avec Discord a échoué. Réessaie.',
  discord_state: 'La connexion avec Discord a expiré. Réessaie.',
  discord_off: 'La connexion avec Discord n’est pas configurée sur ce site.',
  invite_required: 'Ce compte Discord n’a pas encore de compte ici : il faut le code d’invitation pour en créer un.',
  too_many: 'Trop de tentatives. Réessaie dans quelques minutes.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentUser()) redirect('/wishlist');
  const { error } = await searchParams;
  return (
    <main className="authpage">
      <div className="authcard">
        <h1>Connexion</h1>
        <p className="lead">Retrouve ta wishlist et les meilleurs prix du moment.</p>
        {error && ERRORS[error] && <p className="formerr" role="alert">{ERRORS[error]}</p>}
        <LoginForm discord={config.discord !== null} inviteRequired={Boolean(config.signupCode)} />
      </div>
    </main>
  );
}
