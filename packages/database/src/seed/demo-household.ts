// MC-020 — Demo household (optional).
//
// Creates a "Демо семья" household with the seeded demo user
// (email = "demo@multichef.local") so QA / frontend-bot can exercise
// the full flow without manual seed data.
//
// We do NOT create the demo User here — that's out of scope for a
// catalog seed (and Argon2id-hashed passwords don't belong in a seed
// file). The User is created on first registration via /api/v1/auth/register.
// We just pre-allocate the Household + HouseholdMember rows so the
// dashboard renders correctly for the demo user.

import { randomBytes } from 'node:crypto';

export const DEMO_HOUSEHOLD = {
  id: randomBytes(13).toString('hex').toUpperCase().padEnd(26, '0').slice(0, 26),
  name: 'Демо семья',
  defaultPeopleCount: 2,
  currency: 'RUB',
} as const;

export const DEMO_HOUSEHOLD_OWNER_EMAIL = 'demo@multichef.local';
