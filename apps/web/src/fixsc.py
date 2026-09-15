# T48-B: ShoppingClient error — retry-кнопка
p = '/opt/multichef/apps/web/src/app/(app)/shopping/ShoppingClient.tsx'
s = open(p, encoding='utf-8').read()
old = '''      <Card data-testid="shopping-error">
        <p className="text-body">{error}</p>'''
new = '''      <Card data-testid="shopping-error">
        <p className="text-body">{error}</p>
        {/* T48-B (audit round 48): retry-кнопка вместо toast-only. */}
        <button
          type="button"
          className="mt-3 rounded-md bg-[var(--color-primary)] px-4 py-2 text-white"
          onClick={() => window.location.reload()}
        >
          Повторить
        </button>'''
assert old in s, 'anchor'
open(p, 'w', encoding='utf-8').write(s.replace(old, new))
print('ShoppingClient retry added')
