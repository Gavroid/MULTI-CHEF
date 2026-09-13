// /fridge/add — PRD §2.3.7 add-product entrypoint.
//
// Audit round-5: HeroButton (empty pantry) and RescueError linked to
// /fridge/add, but the route did not exist (404). The actual creation
// UX is the AddPantryItemDialog on /fridge — redirect there with a
// flag so FridgeClient opens the dialog automatically.

import { redirect } from 'next/navigation';

export default function FridgeAddPage(): never {
  redirect('/fridge?add=1');
}
