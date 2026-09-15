-- Rollback mc086: дропнуть unique-индекс и вернуть дубликаты невозможно
-- (данные удалены безвозвратно). Откат — только дроп индекса.
DROP INDEX IF EXISTS "Preference_userId_kind_ingredientId_key";
