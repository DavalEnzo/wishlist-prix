import type { Metadata } from 'next';
import { ResetForm } from '@/components/AuthForms.tsx';

export const metadata: Metadata = { title: 'Nouveau mot de passe', referrer: 'no-referrer' };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="authpage">
      <div className="authcard">
        <h1>Nouveau mot de passe</h1>
        <p className="lead">Choisis ton nouveau mot de passe. Tes autres appareils seront déconnectés.</p>
        <ResetForm token={token} />
      </div>
    </main>
  );
}
