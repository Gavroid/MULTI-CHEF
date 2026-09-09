// /shopping — список покупок (PRD §2.3.5). MC-013: empty state.
// Полный UI + offline sync появится в MC-056.

import { Button, Card } from '@multichef/ui';
import { TabTitle } from '@/components/TabTitle';

export default function ShoppingPage(): React.ReactElement {
  return (
    <>
      <TabTitle sublabel="Что нужно купить">Покупки</TabTitle>
      <Card>
        <h2 className="text-heading mb-2">Список пуст</h2>
        <p className="text-body mb-3">
          Список покупок формируется автоматически из плана питания и недостающих продуктов.
          Чекбоксы работают офлайн.
        </p>
        <Button variant="secondary" disabled>
          Добавить позицию (TODO: MC-056)
        </Button>
      </Card>
    </>
  );
}
