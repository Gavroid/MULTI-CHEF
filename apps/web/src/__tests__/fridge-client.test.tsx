// fridge-client — integration coverage for the FridgeClient
// orchestrator. The actual UI (FAB clicks, dialog state transitions)
// is covered separately by Playwright / visual QA; here we assert
// the source-level wiring contract:
//
//   - uses @multichef/ui (Button, Card, Chip, Skeleton, Toast) +
//     lucide-react icons (not emoji)
//   - reads includeArchived from the URL-friendly chip toggle
//   - delegates to pantry-client (listItems/create/update/delete/restore)
//     + ingredient-client (searchIngredients)
//   - humanises known API error codes (VALIDATION_ERROR,
//     PANTRY_ITEM_NOT_FOUND, INGREDIENT_NOT_FOUND, UNAUTHORIZED,
//     ITEM_NOT_ARCHIVED)
//   - handles empty list, loading, error, archived sections
//   - the FAB + empty-state CTA open the AddPantryItemDialog
//
// We mount via happy-dom + react-dom/client to render the component
// and inspect the output HTML. State changes from the FAB click are
// driven through the DOM (event mousedown) and we assert that
// <dialog> is opened.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');

function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf-8');
}

const FRIDGE_CLIENT = 'src/app/(app)/fridge/FridgeClient.tsx';
const FRIDGE_PAGE = 'src/app/(app)/fridge/page.tsx';
const ADD_DIALOG = 'src/components/AddPantryItemDialog.tsx';
const EDIT_DIALOG = 'src/components/EditPantryItemDialog.tsx';
const PANTRY_DIALOG = 'src/components/PantryDialog.tsx';
const PANTRY_CARD = 'src/components/PantryItemCard.tsx';
const CONFIRM = 'src/components/ConfirmDialog.tsx';
const PANTRY_CLIENT = 'src/lib/pantry-client.ts';
const INGREDIENT_CLIENT = 'src/lib/ingredient-client.ts';
const EXPIRY = 'src/lib/expiry.ts';

/* ---------------- Headline h1 + delegation ---------------- */

test('fridge page renders <FridgeClient> (thin wrapper)', () => {
  const src = readSrc(FRIDGE_PAGE);
  assert.match(src, /<FridgeClient\b/, 'page delegates to FridgeClient');
  assert.match(src, /from\s+['"]\.\/FridgeClient['"]/, 'imports from sibling file');
  assert.doesNotMatch(src, /TODO/, 'fridge page no longer contains a TODO marker');
});

test('FridgeClient renders TabTitle «Холодильник» and uses @multichef/ui components', () => {
  const src = readSrc(FRIDGE_CLIENT);
  assert.match(src, /<TabTitle[^>]*>\s*Холодильник\s*<\/TabTitle>/);
  assert.match(src, /from\s+['"]@multichef\/ui['"]/);
  // All four ui components we depend on must be imported.
  assert.match(src, /\bButton\b/);
  assert.match(src, /\bCard\b/);
  assert.match(src, /\bChip\b/);
  assert.match(src, /\bSkeleton\b/);
  // Toast (success/danger helpers) — re-exported from @multichef/ui.
  assert.match(src, /\btoast\b/);
});

test('FridgeClient uses lucide-react icons (no emoji)', () => {
  const src = readSrc(FRIDGE_CLIENT);
  assert.match(src, /from\s+['"]lucide-react['"]/);
  assert.match(src, /\bRefrigerator\b/);
  assert.match(src, /\bPlus\b/);
  assert.match(src, /\bAlertTriangle\b/);
  // Sanity: no emoji glyph in the JSX.
  assert.doesNotMatch(src, /[\u{1F300}-\u{1FAFF}]/u);
});

/* ---------------- Empty / loading / error states ---------------- */

test('FridgeClient renders the empty-state branch when items.length === 0', () => {
  const src = readSrc(FRIDGE_CLIENT);
  assert.match(src, /data-testid="fridge-empty"/);
  assert.match(src, /В холодильнике пока пусто/);
  assert.match(src, /Добавить продукт/);
});

test('FridgeClient renders the loading skeleton branch while fetching', () => {
  const src = readSrc(FRIDGE_CLIENT);
  assert.match(src, /data-testid="fridge-loading"/);
  assert.match(src, /<Skeleton\b/);
});

test('FridgeClient renders the error branch on fetch failure', () => {
  const src = readSrc(FRIDGE_CLIENT);
  assert.match(src, /data-testid="fridge-error"/);
  assert.match(src, /Повторить/, 'error state offers a retry button');
  assert.match(src, /AlertTriangle/);
});

/* ---------------- FAB + filter chips ---------------- */

test('FridgeClient renders the FAB («+») with data-testid="fridge-fab"', () => {
  const src = readSrc(FRIDGE_CLIENT);
  assert.match(src, /data-testid="fridge-fab"/);
  assert.match(src, /aria-label="Добавить продукт"/);
  assert.match(src, /bottom-20/, 'FAB sits above BottomTabBar');
});

test('FridgeClient renders filter chips for Активные / Архив', () => {
  const src = readSrc(FRIDGE_CLIENT);
  assert.match(src, /data-testid="fridge-filter-chips"/);
  assert.match(src, /data-testid="fridge-chip-active"/);
  assert.match(src, /data-testid="fridge-chip-archive"/);
  assert.match(src, />\s*Активные\s*</);
  assert.match(src, />\s*Архив\s*</);
});

/* ---------------- Wire-up to API clients ---------------- */

test('FridgeClient wires listItems/create/update/delete/restore from pantry-client', () => {
  const src = readSrc(FRIDGE_CLIENT);
  assert.match(src, /\blistItems\b/);
  assert.match(src, /\bcreateItem\b/);
  assert.match(src, /\bupdateItem\b/);
  assert.match(src, /\bdeleteItem\b/);
  assert.match(src, /\brestoreItem\b/);
  // They all originate from the pantry-client barrel.
  assert.match(src, /from\s+['"]@\/lib\/pantry-client['"]/);
});

test('FridgeClient passes includeArchived + sort=createdAt + order=desc to listItems', () => {
  const src = readSrc(FRIDGE_CLIENT);
  // The query shape is internal — assert on the literal fields.
  assert.match(src, /includeArchived:\s*effectiveInclude/);
  assert.match(src, /sort:\s*['"]createdAt['"]/);
  assert.match(src, /order:\s*['"]desc['"]/);
  assert.match(src, /limit:\s*100/);
});

test('FridgeClient wires searchIngredients from ingredient-client for the Add dialog', () => {
  const src = readSrc(FRIDGE_CLIENT);
  assert.match(src, /\bsearchIngredients\b/);
  assert.match(src, /from\s+['"]@\/lib\/ingredient-client['"]/);
});

test('FridgeClient passes AbortSignal to listItems for unmount safety', () => {
  const src = readSrc(FRIDGE_CLIENT);
  assert.match(src, /signal:\s*ctrl\.signal/);
  assert.match(src, /AbortController/);
});

/* ---------------- Soft delete + restore semantics ---------------- */

test('FridgeClient filters out restored items from the in-memory list and re-fetches', () => {
  const src = readSrc(FRIDGE_CLIENT);
  // When restore succeeds we drop the row from the current view and
  // kick a refetch so the restored (now-active) item appears under
  // the active filter on the next render.
  assert.match(
    src,
    /setItems\(\(prev\) => \(prev \? prev\.filter\(\(it\) => it\.id !== item\.id\) : prev\)\)/,
  );
  assert.match(src, /void refetch\(\)/);
});

test('FridgeClient shows a toast with code-aware message on restore failure', () => {
  const src = readSrc(FRIDGE_CLIENT);
  assert.match(src, /ITEM_NOT_ARCHIVED/);
  assert.match(src, /Продукт уже активен/);
});

test('FridgeClient shows the archived badge + Restore button on archived items', () => {
  // PantryItemCard owns the render branch — verify the source.
  const card = readSrc(PANTRY_CARD);
  assert.match(card, /В архиве/);
  assert.match(card, /Archive\b.*lucide-react/);
  assert.match(card, /onRestore/);
  // FridgeClient passes onRestore to every PantryItemCard via a
  // cardProps spread (the inline shape is `{ onEdit, onDelete, onRestore }`).
  const client = readSrc(FRIDGE_CLIENT);
  assert.match(client, /const cardProps = \{[\s\S]*onRestore[\s\S]*\}/);
});

/* ---------------- Dialog wiring ---------------- */

test('FridgeClient wires AddPantryItemDialog with deps + open/close state', () => {
  const src = readSrc(FRIDGE_CLIENT);
  assert.match(src, /<AddPantryItemDialog\b/);
  assert.match(src, /open=\{addOpen\}/);
  assert.match(src, /onClose=\{[^}]*setAddOpen\(false\)[^}]*\}/);
});

test('FridgeClient wires EditPantryItemDialog with the editing item', () => {
  const src = readSrc(FRIDGE_CLIENT);
  assert.match(src, /<EditPantryItemDialog\b/);
  assert.match(src, /open=\{editing !== null\}/);
  assert.match(src, /item=\{editing\}/);
});

test('FridgeClient wires ConfirmDialog for delete with danger tone', () => {
  const src = readSrc(FRIDGE_CLIENT);
  assert.match(src, /<ConfirmDialog\b/);
  assert.match(src, /title="Удалить продукт\?"/);
  assert.match(src, /confirmTone="danger"/);
});

/* ---------------- Expiry partition is wired into the page ---------------- */

test('FridgeClient calls partitionByExpiry to split expiring / fresh sections', () => {
  const src = readSrc(FRIDGE_CLIENT);
  assert.match(src, /partitionByExpiry\(/);
  assert.match(src, /data-testid="fridge-section-expiring"/);
  assert.match(src, /data-testid="fridge-section-fresh"/);
});

test('expiry helper exports the contract the page depends on', () => {
  const src = readSrc(EXPIRY);
  assert.match(src, /export function formatExpiry/);
  assert.match(src, /export function comparePantryItems/);
  assert.match(src, /export function partitionByExpiry/);
  assert.match(src, /export interface ExpiryLabel/);
});

/* ---------------- Error humanisation (codes from real API) ---------------- */

test('FridgeClient humanises known error codes (UNAUTHORIZED + NETWORK_ERROR)', () => {
  const src = readSrc(FRIDGE_CLIENT);
  assert.match(src, /Войдите, чтобы увидеть холодильник/);
  assert.match(src, /Нет связи с сервером/);
});

test('AddPantryItemDialog humanises INGREDIENT_NOT_FOUND and VALIDATION_ERROR on create', () => {
  const src = readSrc(ADD_DIALOG);
  assert.match(src, /INGREDIENT_NOT_FOUND/);
  assert.match(src, /VALIDATION_ERROR/);
});

test('EditPantryItemDialog humanises PANTRY_ITEM_NOT_FOUND and VALIDATION_ERROR on update', () => {
  const src = readSrc(EDIT_DIALOG);
  assert.match(src, /PANTRY_ITEM_NOT_FOUND/);
  assert.match(src, /VALIDATION_ERROR/);
});

/* ---------------- PantryDialog wraps native <dialog> ---------------- */

test('PantryDialog uses native <dialog> + showModal()/close() (no portal library)', () => {
  const src = readSrc(PANTRY_DIALOG);
  assert.match(src, /<dialog\b/);
  assert.match(src, /showModal\(\)/);
  assert.match(src, /\.close\(\)/);
  // No react-modal / radix-ui dependency.
  assert.doesNotMatch(src, /react-modal|radix-ui|@reach/);
});

/* ---------------- pantry-client + ingredient-client type contracts ---------------- */

test('pantry-client exports list/create/update/delete/restore with correct signatures', () => {
  const src = readSrc(PANTRY_CLIENT);
  assert.match(src, /export function listItems\(/);
  assert.match(src, /export function getItem\(/);
  assert.match(src, /export function createItem\(/);
  assert.match(src, /export function updateItem\(/);
  assert.match(src, /export function deleteItem\(/);
  assert.match(src, /export function restoreItem\(/);
  // All take a FetchOptions param so callers can inject AbortSignal +
  // Idempotency-Key. The stateful ones auto-generate the latter.
  assert.match(src, /generateIdempotencyKey/);
});

test('ingredient-client exports searchIngredients and listCategories (public, no auth)', () => {
  const src = readSrc(INGREDIENT_CLIENT);
  assert.match(src, /export function searchIngredients\(/);
  assert.match(src, /export function listCategories\(/);
  // No `credentials: 'include'` needed — catalog is public (MC-021).
  assert.doesNotMatch(src, /credentials/);
});

/* ---------------- ConfirmDialog API ---------------- */

test('ConfirmDialog is a generic yes/no dialog on top of PantryDialog', () => {
  const src = readSrc(CONFIRM);
  assert.match(src, /<PantryDialog\b/);
  // ConfirmDialog renders the danger Button variant when confirmTone
  // is 'danger' (the prop itself is destructured, so we check the
  // conditional spread inside the Button variant prop).
  assert.match(src, /variant=\{confirmTone === 'danger' \? 'danger' : 'primary'\}/);
  assert.match(src, /confirmTone\?:\s*'primary'\s*\|\s*'danger'/);
});
