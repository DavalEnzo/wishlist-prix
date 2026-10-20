/** Settings read from the environment (see .env.example). */

const env = (name: string): string | undefined => {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
};

export const config = {
  /** Public address of the site, without trailing slash (https://wishlist.example.fr). */
  get appUrl(): string {
    return (env('APP_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
  },
  /** Cookies are marked Secure when the site is served over HTTPS. */
  get secureCookies(): boolean {
    return this.appUrl.startsWith('https://');
  },
  /** When set, creating an account (email or Discord) requires this code. */
  get signupCode(): string | undefined {
    return env('SIGNUP_CODE');
  },
  get discord(): { clientId: string; clientSecret: string } | null {
    const clientId = env('DISCORD_CLIENT_ID');
    const clientSecret = env('DISCORD_CLIENT_SECRET');
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  },
  get discordBotToken(): string | undefined {
    return env('DISCORD_BOT_TOKEN');
  },
  /** Invite to the Discord server where the bot is: members can receive its DMs. */
  get discordInviteUrl(): string | undefined {
    const url = env('DISCORD_INVITE_URL');
    return url && /^https:\/\//.test(url) ? url : undefined;
  },
  get smtp(): { url: string; from: string } | null {
    const url = env('SMTP_URL');
    const from = env('MAIL_FROM');
    return url && from ? { url, from } : null;
  },
  /** Behind a reverse proxy or tunnel, trust X-Forwarded-For for rate limiting. */
  get trustProxy(): boolean {
    return env('TRUST_PROXY') === 'true';
  },
};
