// /plan — недельный план питания (PRD §2.3.4). MC-013: empty state.
// Полный генератор + UI появится в MC-055.

import { Button, Card } from '@multichef/ui';
import { TabTitle } from '@/components/TabTitle';

export default function PlanPage(): React.ReactElement {
  return (
    <>
      <TabTitle sublabel="План на неделю">План</TabTitle>
      <Card>
        <h2 className="text-heading mb-2">Нет планов</h2>
        <p className="text-body mb-3">
          Сгенерируйте недельный план с учётом продуктов в холодильнике, аллергий и бюджета.
        </p>
        <Button variant="primary" disabled>
          Сгенерировать план (TODO: MC-055)
        </Button>
      </Card>
    </>
  );
}
