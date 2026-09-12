// /fridge/rescue — «Спаси продукт» (MC-040, PRD §2.3.7).
//
// Server entrypoint: parses the URL-driven state machine (?step=,
// ?ingredient=, ?resultRef=) and hands plain values to RescueClient.
// searchParams makes the route dynamic, so no Suspense boundary is
// needed (the client component does not use useSearchParams).

import { RescueClient } from './RescueClient';

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function RescuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const sp = await searchParams;
  return (
    <RescueClient
      step={firstParam(sp['step']) ?? 'picker'}
      ingredient={firstParam(sp['ingredient'])}
      resultRef={firstParam(sp['resultRef'])}
    />
  );
}
