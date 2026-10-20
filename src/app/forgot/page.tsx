import type { Metadata } from 'next';
import { ForgotForm } from '@/components/AuthForms.tsx';
import { mailEnabled } from '@/lib/mail.ts';

export const metadata: Metadata = { title: 'Mot de passe oublié' };
export const dynamic = 'force-dynamic';

export default function ForgotPage() {
  return (
    <main className="authpage">
      <div className="authcard">
        <h1>Mot de passe oublié</h1>
        <p className="lead">
          {mailEnabled()
            ? 'Indique l’email de ton compte : tu recevras un lien pour choisir un nouveau mot de passe.'
            : 'L’envoi d’emails n’est pas configuré sur ce site. Demande à la personne qui le gère de te créer un lien de réinitialisation. Si ton compte est relié à Discord, tu peux aussi te connecter avec Discord.'}
        </p>
        {mailEnabled() && <ForgotForm />}
      </div>
    </main>
  );
}
