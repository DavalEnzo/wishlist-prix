import nodemailer from 'nodemailer';
import { config } from './config.ts';

export const mailEnabled = (): boolean => config.smtp !== null;

/** Password reset link by email. Requires SMTP_URL and MAIL_FROM. */
export async function sendResetEmail(to: string, name: string, link: string): Promise<void> {
  const smtp = config.smtp;
  if (!smtp) throw new Error('SMTP non configuré');
  const transport = nodemailer.createTransport(smtp.url);
  await transport.sendMail({
    from: smtp.from,
    to,
    subject: 'Réinitialiser ton mot de passe — Wishlist gaming',
    text: [
      `Bonjour ${name},`,
      '',
      'Pour choisir un nouveau mot de passe, ouvre ce lien (valable une heure) :',
      link,
      '',
      'Si tu n’as rien demandé, ignore ce message : ton mot de passe ne change pas.',
    ].join('\n'),
  });
}
