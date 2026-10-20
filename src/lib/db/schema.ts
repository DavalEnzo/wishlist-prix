import { bigint, boolean, index, integer, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** AllKeyShop ids go beyond 32 bits (e.g. 201815201816); they stay below 2^53. */
const productId = (name: string) => bigint(name, { mode: 'number' });
import { DEFAULT_PREFS, type PriceData } from '../prices/types.ts';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** Lowercased. Null for accounts created with Discord only. */
  email: text('email').unique(),
  passwordHash: text('password_hash'),
  discordId: text('discord_id').unique(),
  discordName: text('discord_name'),
  discordAvatar: text('discord_avatar'),
  dmAlerts: boolean('dm_alerts').notNull().default(true),
  /** Last reason a Discord DM could not be delivered, shown in the settings. */
  dmError: text('dm_error'),
  country: text('country').notNull().default(DEFAULT_PREFS.country),
  excludeRegions: text('exclude_regions').array().notNull().$defaultFn(() => [...DEFAULT_PREFS.excludeRegions]),
  edition: text('edition').notNull().default(DEFAULT_PREFS.edition),
  keyshopAlerts: boolean('keyshop_alerts').notNull().default(DEFAULT_PREFS.keyshopAlerts),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the cookie token: a database leak does not reveal live sessions. */
    id: text('id').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const passwordResets = pgTable('password_resets', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/** The AllKeyShop catalog, refreshed daily by the worker. */
export const catalog = pgTable(
  'catalog',
  {
    id: productId('id').primaryKey(),
    name: text('name').notNull(),
    /** " word word " — see normName(). Searched with LIKE through a trigram index. */
    norm: text('norm').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('catalog_norm_trgm_idx').using('gin', t.norm.op('gin_trgm_ops'))],
);

/** One price snapshot per AllKeyShop product, shared by every user who follows it. */
export const prices = pgTable('prices', {
  productId: productId('product_id').primaryKey(),
  data: jsonb('data').$type<PriceData>(),
  checkedAt: timestamp('checked_at', { withTimezone: true }),
  error: text('error'),
  /** Set when someone adds the game: the worker checks it within a minute. */
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  /** Last attempt, successful or not: a failing product is not retried every minute. */
  attemptedAt: timestamp('attempted_at', { withTimezone: true }),
});

export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    pcProductId: productId('pc_product_id'),
    ps5ProductId: productId('ps5_product_id'),
    targetCents: integer('target_cents'),
    priority: smallint('priority').notNull().default(2),
    /** Edition keyword overriding the user's preference ("deluxe"). */
    edition: text('edition'),
    notes: text('notes').notNull().default(''),
    /** Price of the last alert sent, to alert again only on a further drop. */
    alertCents: integer('alert_cents'),
    alertAt: timestamp('alert_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('items_user_idx').on(t.userId)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    url: text('url'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

/** Small key/value store for the worker's bookkeeping (last catalog sync…). */
export const meta = pgTable('meta', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
