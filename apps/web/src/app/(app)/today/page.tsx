// /today — главный экран (PRD §2.3.2). MC-013: stub с приветственной
// карточкой. Полный контент с 3 типами карточек рекомендаций появится
// в MC-034.

import { Button, Card } from '@multichef/ui';
import { TabTitle } from '@/components/TabTitle';

export default function TodayPage(): React.ReactElement {
  return (
    <>
      <TabTitle sublabel="Главный экран">Сегодня</TabTitle>
      <Card variant="elevated">
        <h2 className="text-title mb-2">Добро пожаловать</h2>
        <p className="text-body mb-3">
          Здесь будут три карточки рецептов: «Из того, что есть», «Лучший вариант», «Выгодная
          цепочка».
        </p>
        <Button variant="primary" disabled>
          Найти рецепт (TODO: MC-034)
        </Button>
      </Card>
    </>
  );
}
