// /shopping — «Покупки» tab (MC-013 stub replaced in MC-056).
//
// The interactive list view lives in ShoppingClient (client-side data
// via shopping-client with deps injection).

import { ShoppingClient } from './ShoppingClient';

export default function ShoppingPage(): React.ReactElement {
  return <ShoppingClient />;
}
