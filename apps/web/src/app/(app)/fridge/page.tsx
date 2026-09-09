// /fridge — список продуктов пользователя (PRD §2.3.3). MC-013: empty
// state. Полный CRUD + сроки годности появятся в MC-023.

import { Button, Card } from '@multichef/ui';
import { TabTitle } from '@/components/TabTitle';

export default function FridgePage(): React.ReactElement {
  return (
    <>
      <TabTitle sublabel="Ваши продукты">Холодильник</TabTitle>
      <Card>
        <h2 className="text-heading mb-2">Пусто</h2>
        <p className="text-body mb-3">
          Добавьте продукты — мы подскажем, что из них приготовить, и предупредим за 2 дня до
          истечения срока.
        </p>
        <Button variant="secondary" disabled>
          Добавить продукт (TODO: MC-023)
        </Button>
      </Card>
    </>
  );
}
