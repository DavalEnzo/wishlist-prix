import type { Metadata } from 'next';
import { SettingsForms } from '@/components/SettingsForms.tsx';
import { config } from '@/lib/config.ts';
import { discordAvatarUrl } from '@/lib/discord.ts';
import { requireUser } from '@/server/session.ts';
import { logoutAction } from '../actions/auth.ts';

export const metadata: Metadata = { title: 'Réglages' };
export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, { error?: string; ok?: string }> = {
  discord_linked: { ok: 'Compte Discord relié. Tes alertes arriveront aussi en message privé.' },
  discord_taken: { error: 'Ce compte Discord est déjà relié à un autre compte du site.' },
  discord_cancel: { error: 'Liaison avec Discord annulée.' },
  discord_failed: { error: 'La liaison avec Discord a échoué. Réessaie.' },
  discord_state: { error: 'La liaison avec Discord a expiré. Réessaie.' },
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const message = MESSAGES[sp.ok ?? sp.error ?? ''];
  return (
    <main className="wrap">
      <div className="pagehead">
        <div>
          <h1>Réglages</h1>
          <p className="sub">Compte · alertes · règles de prix</p>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="btn">Se déconnecter</button>
        </form>
      </div>
      {message?.ok && <div className="banner ok">{message.ok}</div>}
      {message?.error && <div className="banner err">{message.error}</div>}
      <SettingsForms
        user={{
          name: user.name,
          email: user.email,
          hasPassword: Boolean(user.passwordHash),
          discordName: user.discordName,
          discordLinked: Boolean(user.discordId),
          discordAvatar: discordAvatarUrl(user.discordId, user.discordAvatar),
          dmAlerts: user.dmAlerts,
          dmError: user.dmError,
          country: user.country,
          excludeRegions: user.excludeRegions,
          edition: user.edition,
          keyshopAlerts: user.keyshopAlerts,
        }}
        discordEnabled={config.discord !== null}
        botEnabled={Boolean(config.discordBotToken)}
        discordInviteUrl={config.discordInviteUrl ?? null}
      />
    </main>
  );
}
