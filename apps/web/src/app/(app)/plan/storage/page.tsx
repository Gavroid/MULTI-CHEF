// /plan/storage — «Хранение» (MC-062, PRD §2.3.13).
//
// Server wrapper over StorageClient (freezer/fridge containers and the
// defrost calendar).

import React from 'react';
import { StorageClient } from './StorageClient';

export default function StoragePage(): React.ReactElement {
  return <StorageClient />;
}
