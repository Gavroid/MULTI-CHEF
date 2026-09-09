// MC-011 — Unit tests for the profile DTOs (zod schemas only).
// Run without RUN_DB_INTEGRATION. These exercise the validation
// rules from docs/api/conventions.md §6 + PRD §4.2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HouseholdPatchSchema,
  NutritionPutSchema,
  OnboardingSchema,
  PREFERENCE_KIND_VALUES,
  PreferenceCreateSchema,
  ProfilePatchSchema,
} from '../profile/profile.dto.js';

test('ProfilePatchSchema: accepts a single field', () => {
  const r = ProfilePatchSchema.safeParse({ locale: 'en' });
  assert.equal(r.success, true);
});

test('ProfilePatchSchema: rejects empty body (no fields)', () => {
  const r = ProfilePatchSchema.safeParse({});
  assert.equal(r.success, false);
});

test('ProfilePatchSchema: rejects unknown extra fields', () => {
  const r = ProfilePatchSchema.safeParse({ locale: 'en', isAdmin: true });
  assert.equal(r.success, false);
});

test('ProfilePatchSchema: lowercases email', () => {
  const r = ProfilePatchSchema.safeParse({ email: 'A@Example.com' });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.email, 'a@example.com');
});

test('NutritionPutSchema: rejects float (must be int for macros)', () => {
  const r = NutritionPutSchema.safeParse({ targetCalories: 2000.5 });
  assert.equal(r.success, false);
});

test('NutritionPutSchema: accepts a partial subset', () => {
  const r = NutritionPutSchema.safeParse({ mealsPerDay: 4 });
  assert.equal(r.success, true);
});

test('NutritionPutSchema: rejects invalid skillLevel', () => {
  const r = NutritionPutSchema.safeParse({ skillLevel: 'INTERMEDIATE' });
  assert.equal(r.success, false);
});

test('NutritionPutSchema: rejects unknown appliance', () => {
  const r = NutritionPutSchema.safeParse({ appliances: ['STOVE', 'TELEPORT'] });
  assert.equal(r.success, false);
});

test('PreferenceCreateSchema: requires either ingredientId or note', () => {
  const r1 = PreferenceCreateSchema.safeParse({ kind: 'LOVE' });
  assert.equal(r1.success, false);

  const r2 = PreferenceCreateSchema.safeParse({
    kind: 'LOVE',
    ingredientId: '01HMZ8X9R6K7P3WXY5T2N0V4J8',
  });
  assert.equal(r2.success, true);

  const r3 = PreferenceCreateSchema.safeParse({ kind: 'LOVE', note: 'prefers garlic' });
  assert.equal(r3.success, true);
});

test('PreferenceCreateSchema: rejects bad ULID', () => {
  const r = PreferenceCreateSchema.safeParse({
    kind: 'ALLERGY',
    ingredientId: 'not-a-ulid',
  });
  assert.equal(r.success, false);
});

test('PreferenceCreateSchema: accepts every kind', () => {
  for (const kind of PREFERENCE_KIND_VALUES) {
    const r = PreferenceCreateSchema.safeParse({ kind, note: 'test' });
    assert.equal(r.success, true, `kind=${kind} should be valid`);
  }
});

test('OnboardingSchema: accepts a happy-path body', () => {
  const r = OnboardingSchema.safeParse({
    householdSize: 4,
    budgetPerWeekKopecks: 12_500_00,
    allergies: ['01HMZ8X9R6K7P3WXY5T2N0V4J8'],
    likedIngredients: [],
    dislikedIngredients: [],
    appliances: ['STOVE', 'OVEN'],
    skillLevel: 'CONFIDENT',
    typicalCookTimeMin: 30,
  });
  assert.equal(r.success, true);
});

test('OnboardingSchema: money is int kopecks (no floats)', () => {
  const r = OnboardingSchema.safeParse({
    householdSize: 1,
    budgetPerWeekKopecks: 12_500.5,
    allergies: [],
    likedIngredients: [],
    dislikedIngredients: [],
    appliances: ['STOVE'],
    skillLevel: 'BEGINNER',
    typicalCookTimeMin: 15,
  });
  assert.equal(r.success, false);
});

test('OnboardingSchema: householdSize out of range', () => {
  const r = OnboardingSchema.safeParse({
    householdSize: 25,
    budgetPerWeekKopecks: 0,
    allergies: [],
    likedIngredients: [],
    dislikedIngredients: [],
    appliances: ['STOVE'],
    skillLevel: 'BEGINNER',
    typicalCookTimeMin: 15,
  });
  assert.equal(r.success, false);
});

test('OnboardingSchema: appliances array required (min 1)', () => {
  const r = OnboardingSchema.safeParse({
    householdSize: 1,
    budgetPerWeekKopecks: 0,
    allergies: [],
    likedIngredients: [],
    dislikedIngredients: [],
    appliances: [],
    skillLevel: 'BEGINNER',
    typicalCookTimeMin: 15,
  });
  assert.equal(r.success, false);
});

test('HouseholdPatchSchema: rejects empty body', () => {
  const r = HouseholdPatchSchema.safeParse({});
  assert.equal(r.success, false);
});

test('HouseholdPatchSchema: rejects unknown currency', () => {
  const r = HouseholdPatchSchema.safeParse({ currency: 'rub' });
  assert.equal(r.success, false);
});

test('HouseholdPatchSchema: accepts RUB', () => {
  const r = HouseholdPatchSchema.safeParse({ currency: 'RUB' });
  assert.equal(r.success, true);
});
